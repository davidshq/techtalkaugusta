const axios = require('axios');

class EventbriteManager {
    constructor() {
        console.log('Environment variables available:', {
            EVENTBRITE_TOKEN: process.env.EVENTBRITE_TOKEN ? 'Present' : 'Missing',
            NODE_ENV: process.env.NODE_ENV,
            PWD: process.env.PWD
        });

        this.apiToken = process.env.EVENTBRITE_TOKEN;
        this.baseUrl = 'https://www.eventbriteapi.com/v3';

        if (!this.apiToken) {
            console.error('Eventbrite API token is missing. Please check your .env file and environment variables.');
            throw new Error('Eventbrite API token is not configured');
        }

        console.log('Initializing Eventbrite Manager with:', {
            tokenPrefix: this.apiToken.substring(0, 5) + '...',
            baseUrl: this.baseUrl
        });
    }

    async getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
        };
    }

    // Extract numeric ID from event URL or ID string
    extractEventId(eventId) {
        console.log('Extracting event ID from:', eventId);
        
        // If it's already just a number, return it
        if (/^\d+$/.test(eventId)) {
            console.log('Event ID is already numeric:', eventId);
            return eventId;
        }

        // Try to extract ID from URL or slug
        const matches = eventId.match(/(?:events\/.*-)?(\d+)(?:-tickets)?$/);
        if (matches && matches[1]) {
            console.log('Extracted numeric ID:', matches[1]);
            return matches[1];
        }

        throw new Error('Invalid Eventbrite event ID format');
    }

    async getEvent(eventId) {
        try {
            const numericId = this.extractEventId(eventId);
            console.log('Fetching event with ID:', numericId);
            console.log('Using API token:', this.apiToken.substring(0, 5) + '...');

            const headers = await this.getHeaders();
            console.log('Request headers:', headers);

            const url = `${this.baseUrl}/events/${numericId}/`;
            console.log('Making request to:', url);

            const response = await axios.get(url, { 
                headers,
                validateStatus: null // Allow any status code for better error handling
            });

            console.log('Response status:', response.status);
            console.log('Response headers:', response.headers);
            
            if (response.status !== 200) {
                console.error('Error response data:', response.data);
                
                if (response.status === 400) {
                    throw new Error(`Bad request: ${response.data.error_description || 'Unknown error'}`);
                } else if (response.status === 401) {
                    throw new Error('Invalid or expired Eventbrite API token. Please check your configuration.');
                } else if (response.status === 403) {
                    throw new Error('Permission denied. Please verify your API token has the correct permissions.');
                } else if (response.status === 404) {
                    throw new Error('Event not found. Please verify the event ID and ensure you have access to it.');
                } else {
                    throw new Error(`API Error (${response.status}): ${response.data.error_description || 'Unknown error'}`);
                }
            }

            return response.data;
        } catch (error) {
            console.error('Failed to fetch Eventbrite event:', error.response?.data || error.message);
            throw error;
        }
    }

    async linkExistingEvent(eventId) {
        try {
            console.log('Attempting to link Eventbrite event:', eventId);
            
            const event = await this.getEvent(eventId);
            console.log('Successfully fetched event data:', {
                id: event.id,
                name: event.name?.text,
                start: event.start,
                end: event.end,
                timezone: event.start?.timezone
            });
            
            if (!event.start?.utc || !event.end?.utc) {
                throw new Error('Event start or end time is missing');
            }

            // Convert Eventbrite UTC dates to local time (America/New_York)
            const startDate = new Date(event.start.utc);
            const endDate = new Date(event.end.utc);
            
            // Format date as YYYY-MM-DD
            const formattedDate = startDate.toISOString().split('T')[0];
            
            // Format time as HH:MM AM/PM - HH:MM AM/PM
            const formatTimeString = (date) => {
                return date.toLocaleTimeString('en-US', { 
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                    timeZone: 'America/New_York'
                });
            };
            
            const timeStr = `${formatTimeString(startDate)} - ${formatTimeString(endDate)}`;
            
            // Extract venue information safely
            const location = event.venue 
                ? `${event.venue.name}${event.venue.address ? `, ${event.venue.address.localized_address_display}` : ''}`
                : (event.online_event ? 'Online' : 'TBA');
            
            const meetupData = {
                title: event.name.text,
                description: event.description?.text || '',
                date: formattedDate,
                time: timeStr,
                location: location,
                topic: event.name.text.split('-')[1]?.trim() || 'Tech Talk Augusta Meetup',
                speaker: 'TBA',
                eventbriteId: event.id,
                eventbriteUrl: event.url,
                capacity: event.capacity,
                isFree: event.is_free
            };

            console.log('Converted to meetup data:', meetupData);
            return meetupData;
        } catch (error) {
            console.error('Failed to link Eventbrite event:', error);
            throw new Error(`Failed to link Eventbrite event: ${error.message}`);
        }
    }

    async getCurrentUser() {
        try {
            console.log('Fetching current user information');
            const url = `${this.baseUrl}/users/me/`;
            
            const response = await axios.get(url, {
                headers: await this.getHeaders(),
                validateStatus: null
            });

            if (response.status === 401) {
                throw new Error('Invalid or expired API token. Please check your token.');
            }

            if (response.status !== 200) {
                throw new Error(
                    'Failed to fetch user information: ' +
                    (response.data.error_description || 'Unknown error')
                );
            }

            return response.data;
        } catch (error) {
            console.error('Failed to fetch user information:', error);
            throw error;
        }
    }

    async testConnection() {
        try {
            // Test 1: Check API token
            const configStatus = [];
            if (this.apiToken) {
                configStatus.push('✅ API Token is set');
            } else {
                configStatus.push('❌ API Token is missing');
            }

            // Test 2: Get user information
            const user = await this.getCurrentUser();
            configStatus.push('✅ Successfully connected to Eventbrite API');
            configStatus.push('✅ Successfully authenticated with your account');

            return {
                status: configStatus,
                user: {
                    id: user.id,
                    email: user.emails[0].email,
                    name: user.name
                }
            };
        } catch (error) {
            console.error('Connection test failed:', error);
            throw error;
        }
    }

    async syncWithDiscord(meetupData) {
        try {
            console.log('Syncing Discord meetup with Eventbrite:', meetupData);

            // Convert meetup time to start and end times
            const [startTime, endTime] = meetupData.time.split(' - ').map(t => t.trim());
            const startDate = new Date(`${meetupData.date} ${startTime}`);
            const endDate = new Date(`${meetupData.date} ${endTime}`);

            // Create event data payload
            const eventData = {
                event: {
                    name: {
                        html: meetupData.title
                    },
                    description: {
                        html: meetupData.description
                    },
                    start: {
                        timezone: 'America/New_York',
                        utc: startDate.toISOString()
                    },
                    end: {
                        timezone: 'America/New_York',
                        utc: endDate.toISOString()
                    },
                    currency: 'USD',
                    online_event: meetupData.location.toLowerCase().includes('online'),
                    listed: true,
                    shareable: true,
                    capacity: 100,
                    is_free: true
                }
            };

            // If it's not an online event, add venue information
            if (!eventData.event.online_event) {
                eventData.event.venue = {
                    name: meetupData.location
                };
            }

            // Get organization ID first
            const user = await this.getCurrentUser();
            const organizationId = user.organizations[0]?.id;
            
            if (!organizationId) {
                throw new Error('No organization found for the current user');
            }

            // Create the event
            const response = await axios.post(
                `${this.baseUrl}/organizations/${organizationId}/events/`,
                eventData,
                { headers: await this.getHeaders() }
            );

            if (response.status !== 200) {
                throw new Error(`Failed to create Eventbrite event: ${response.data.error_description || 'Unknown error'}`);
            }

            // Return the event ID and URL
            return {
                eventbriteId: response.data.id,
                eventbriteUrl: response.data.url
            };
        } catch (error) {
            console.error('Failed to sync with Eventbrite:', error);
            throw new Error(`Failed to sync with Eventbrite: ${error.message}`);
        }
    }
}

module.exports = new EventbriteManager();