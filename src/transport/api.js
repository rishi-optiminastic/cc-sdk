
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

     
      await this.sendViaFetch(apiUrl, payload);
      this.logger.log('Event sent via fetch:', payload.event);
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
    this.logger.log('Sending via fetch to:', url, payload);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tracker-Token': this.config.get('trackerToken')
      },
      body: JSON.stringify(payload),
      keepalive: true
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
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