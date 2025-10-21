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

  async send(payload) {
    if (!this.isOnline) {
      this.logger.warn('Offline, queueing event');
      this.queue.push(payload);
      return false;
    }

    const apiUrl = this.config.get('apiUrl');
    
    try {
      if (this.shouldUseSendBeacon(payload.event)) {
        const success = this.sendViaBeacon(apiUrl, payload);
        if (success) {
          this.logger.log('Event sent via sendBeacon:', payload.event);
          return true;
        }
      }

      const response = await this.sendViaFetch(apiUrl, payload);
      this.logger.log('Event sent via fetch:', payload.event, 'Status:', response.status);
      return true;

    } catch (error) {
      this.logger.error('Failed to send event:', error);
      this.queue.push(payload);
      return false;
    }
  }

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

  async sendViaFetch(url, payload) {
    if (!url.endsWith('/')) {
      url = url + '/';
    }
    
    this.logger.log('Sending payload to:', url, payload);
    
    const response = await fetch(url, {
      method: 'POST',  // Explicitly set POST
      headers: {
        'Content-Type': 'application/json',
        'X-Tracker-Token': this.config.get('trackerToken')
      },
      body: JSON.stringify(payload),
      keepalive: true,
      redirect: 'error'  // Don't follow redirects that might change method
    });

    // Handle responses
    if (response.status === 202 || response.status === 200) {
      return response;
    } else if (response.status === 500) {
      // Parse error details
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