
export class EventTracker {
  constructor(config, session, transport, logger) {
    this.config = config;
    this.session = session;
    this.transport = transport;
    this.logger = logger;
    this.sentEvents = new Map();
  }

  
  send(event, data = {}) {
    if (!this.session.isActive()) {
      this.logger.error('Cannot send event without active session');
      return;
    }

    const payload = {
      event,
      session_id: this.session.getId(),
      tracker_token: this.config.get('trackerToken'),
      timestamp: new Date().toISOString(),
      ...data
    };

   
    const eventKey = `${event}_${payload.timestamp}_${JSON.stringify(data)}`;
    
   
    if (this.sentEvents.has(eventKey)) {
      this.logger.warn('Duplicate event prevented:', event);
      return;
    }

   
    this.sentEvents.set(eventKey, Date.now());
    
   
    setTimeout(() => {
      this.sentEvents.delete(eventKey);
    }, 2000);

   
    this.transport.send(payload);
  }

  
  trackCustomEvent(eventName, data = {}) {
    this.send('custom_event', {
      event_name: eventName,
      event_data: data,
      page_url: typeof window !== 'undefined' ? window.location.href : null
    });
    
    this.logger.log('Custom event tracked:', eventName);
  }
}