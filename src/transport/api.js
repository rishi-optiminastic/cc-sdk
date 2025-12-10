export class ApiTransport {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.queue = [];
    this.isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    
    if (typeof window !== 'undefined') {
      this.setupOnlineListener();
    }
  }

  setupOnlineListener() {
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.logger.log('Connection restored, flushing queue');
      this.flushQueue();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.logger.warn('Connection lost, events will be queued');
    });
  }

  /**
   * ✅ NEW: Convert payload to URL query parameters (like Google Analytics)
   */
  buildQueryString(payload) {
    const params = new URLSearchParams();
    
    // Flatten the payload into query parameters
    Object.entries(payload).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        return; // Skip null/undefined
      }
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        // Stringify nested objects (utm_params, resourceTypes, geolocation, etc.)
        params.append(key, JSON.stringify(value));
      } else if (Array.isArray(value)) {
        params.append(key, JSON.stringify(value));
      } else {
        params.append(key, String(value));
      }
    });
    
    return params.toString();
  }

  async send(payload) {
    if (!this.isOnline) {
      this.logger.warn('Offline, queueing event');
      this.queue.push(payload);
      return false;
    }

    const apiUrl = this.config.get('apiUrl');
    
    try {
      // ✅ Use sendBeacon for critical events (still uses POST with blob)
      if (this.shouldUseSendBeacon(payload.event)) {
        const success = this.sendViaBeacon(apiUrl, payload);
        if (success) {
          this.logger.log('Event sent via sendBeacon:', payload.event);
          return true;
        }
      }

      // ✅ Use GET request for all other events
      const response = await this.sendViaGet(apiUrl, payload);
      this.logger.log('Event sent via GET:', payload.event, 'Status:', response.status);
      return true;

    } catch (error) {
      this.logger.error('Failed to send event:', error);
      this.queue.push(payload);
      return false;
    }
  }

  async sendViaGet(url, payload) {
    // Remove trailing slash for query parameters
    let baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    
    // Build query string
    const queryString = this.buildQueryString(payload);
    const fullUrl = `${baseUrl}?${queryString}`;
    
    this.logger.log('📡 GET Request URL (first 200 chars):', fullUrl.substring(0, 200));
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'X-Tracker-Token': this.config.get('trackerToken')
      },
      keepalive: true,
      redirect: 'error'
    });

    if (response.status === 202 || response.status === 200) {
      return response;
    } else if (response.status === 500) {
      try {
        const errorData = await response.json();
        throw new Error(`API Error: ${errorData.message || 'Unknown error'}`);
      } catch (parseError) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } else {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
  }

  /**
   * sendBeacon for critical events (page unload) - still uses POST with blob
   */
  sendViaBeacon(url, payload) {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) {
      return false;
    }

    try {
      const blob = new Blob([JSON.stringify(payload)], { 
        type: 'application/json' 
      });
      return navigator.sendBeacon(url, blob);
    } catch (error) {
      this.logger.error('sendBeacon failed:', error);
      return false;
    }
  }

  shouldUseSendBeacon(eventType) {
    return ['session_end', 'page_unload'].includes(eventType);
  }

  async flushQueue() {
    if (this.queue.length === 0) return;

    this.logger.log(`Flushing ${this.queue.length} queued events`);
    const queue = [...this.queue];
    this.queue = [];

    for (const payload of queue) {
      const success = await this.send(payload);
      if (!success) {
        this.queue.push(payload);
      }
    }
  }

  getQueueSize() {
    return this.queue.length;
  }
}