import { getUTMParams, storeUTMParams, generateEventId } from '../utils/utm.js';

export class EventTracker {
  constructor(config, session, transport, logger) {
    this.config = config;
    this.session = session;
    this.transport = transport;
    this.logger = logger;
    this.sentEvents = new Map();
    this.utmParams = null;
    this.conversionRulesApplied = false;
    
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
      'form_submit': 'conversion',
      'conversion': 'conversion' // ✅ Add explicit conversion mapping
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

    // ✅ CHECK URL CONVERSIONS ON EVERY PAGE VIEW
    if (event === 'page_view' || event === 'session_start') {
      this.checkUrlConversions();
    }
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
  applyConversionRules() {
    const rules = this.config.get('conversionRules') || [];
    
    if (!rules.length) {
      this.logger.warn('No conversion rules found. Skipping conversion tracking.');
      return;
    }

    this.logger.log(`📋 Applying ${rules.length} conversion rules`);

    // Apply click-based rules (set up event listeners)
    rules.forEach((rule) => {
      if (rule.type === 'click') {
        this.trackClickConversion(rule);
      }
    });

    // Check URL-based rules immediately
    this.checkUrlConversions();

    this.conversionRulesApplied = true;
  }

  // ✅ NEW METHOD: Check URL conversions (called on every page view)
  checkUrlConversions() {
    const rules = this.config.get('conversionRules') || [];
    const urlRules = rules.filter(r => r.type === 'url');

    if (urlRules.length === 0) return;

    const currentUrl = window.location.href;
    const currentPath = window.location.pathname;

    this.logger.log('🔍 Checking URL conversions for:', currentPath);

    urlRules.forEach((rule) => {
      let matched = false;
      const pattern = rule.pattern;

      switch (rule.match_type) {
        case 'contains':
          matched = currentUrl.includes(pattern) || currentPath.includes(pattern);
          break;
        case 'exact':
          matched = currentUrl === pattern || currentPath === pattern;
          break;
        case 'starts_with':
          matched = currentUrl.startsWith(pattern) || currentPath.startsWith(pattern);
          break;
        case 'ends_with':
          matched = currentUrl.endsWith(pattern) || currentPath.endsWith(pattern);
          break;
        case 'regex':
          try {
            const regex = new RegExp(pattern);
            matched = regex.test(currentUrl) || regex.test(currentPath);
          } catch (e) {
            this.logger.error('Invalid regex pattern:', pattern, e);
          }
          break;
      }

      if (matched) {
        this.logger.log('🎯 URL conversion matched:', rule);
        this.send('conversion', {
          conversion_type: 'url',
          conversion_label: rule.name,
          conversion_url: currentUrl,
          conversion_rule_id: rule.id,
          match_type: rule.match_type,
          pattern: pattern
        });
      }
    });
  }

  trackUrlConversion(rule) {
    // This is now handled by checkUrlConversions()
    this.logger.warn('trackUrlConversion is deprecated, use checkUrlConversions instead');
  }

  trackClickConversion(rule) {
    this.logger.log('Setting up click conversion listener for:', rule.selector);
    
    document.addEventListener('click', (event) => {
      const target = event.target.closest(rule.selector);
      
      if (target) {
        this.logger.log('🎯 Click conversion matched:', rule);
        this.send('conversion', {
          conversion_type: 'click',
          conversion_label: rule.name,
          conversion_selector: rule.selector,
          conversion_element: target.tagName,
          conversion_rule_id: rule.id,
          element_text: target.innerText?.substring(0, 100)
        });
      }
    });
  }
}