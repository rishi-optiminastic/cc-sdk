import { getUTMParams, storeUTMParams, generateEventId } from '../utils/utm.js';

export class EventTracker {
  constructor(config, session, transport, logger) {
    this.config = config;
    this.session = session;
    this.transport = transport;
    this.logger = logger;
    this.sentEvents = new Map();
    this.utmParams = null;
    
    // Initialize and store UTM parameters
    this.initializeUTMParams();
  }

  /**
   * Initialize UTM parameters from URL
   */
  initializeUTMParams() {
    this.utmParams = getUTMParams();
    storeUTMParams(this.utmParams);
    this.logger.log('UTM parameters initialized:', this.utmParams);
  }

  /**
   * Send event with new v2 format
   * @param {string} event Event type
   * @param {Object} data Additional event data
   */
  send(event, data = {}) {
    if (!this.session.isActive()) {
      this.logger.error('Cannot send event without active session');
      return;
    }

    // Map event types to v2 format
    const eventTypeMapping = {
      'session_start': 'page_view',
      'page_view': 'page_view', 
      'ping': 'page_view',
      'custom_event': 'click',
      'session_end': 'conversion',
      'button_click': 'click',
      'form_submit': 'conversion'
    };

    const mappedEventType = eventTypeMapping[event] || 'click';
    const eventId = generateEventId();

    // Build v2 payload format
    const payload = {
      event: mappedEventType, // Maps to event_type in backend
      session_id: this.session.getId(),
      timestamp: new Date().toISOString(), // Maps to event_time in backend
      tracker_token: this.config.get('trackerToken'), // Maps to api_key in backend
      utm_params: this.utmParams, // MANDATORY for campaign resolution
      event_id: eventId,
      user_id: data.user_id || this.session.getId(), // Use session as fallback
      page_url: typeof window !== 'undefined' ? window.location.href : data.page_url || '',
      referrer: typeof document !== 'undefined' ? document.referrer : data.referrer || '',
      ...data // Additional event-specific data
    };

    // Prevent duplicate events
    const eventKey = `${event}_${payload.timestamp}_${JSON.stringify(data)}`;
    
    if (this.sentEvents.has(eventKey)) {
      this.logger.warn('Duplicate event prevented:', event);
      return;
    }

    this.sentEvents.set(eventKey, Date.now());
    
    // Clean up old entries after 2 seconds
    setTimeout(() => {
      this.sentEvents.delete(eventKey);
    }, 2000);

    this.logger.log('Sending v2 event:', payload);
    this.transport.send(payload);
  }

  /**
   * Track custom event with v2 format
   * @param {string} eventName Custom event name
   * @param {Object} data Event data
   */
  trackCustomEvent(eventName, data = {}) {
    this.send('custom_event', {
      event_name: eventName,
      event_data: data,
      custom_event_type: eventName,
      ...data
    });
    
    this.logger.log('Custom event tracked:', eventName);
  }

  /**
   * Update UTM parameters (e.g., for SPA navigation)
   */
  refreshUTMParams() {
    this.utmParams = getUTMParams();
    storeUTMParams(this.utmParams);
    this.logger.log('UTM parameters refreshed:', this.utmParams);
  }
}