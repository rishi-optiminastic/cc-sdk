import { generateUUID } from '../utils/uuid.js';


export class Session {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.sessionId = null;
  }

  
  start() {
    this.sessionId = generateUUID();
    this.config.set('sessionId', this.sessionId);
    
   
    if (typeof window !== 'undefined') {
      window.__CC_SESSION_ID = this.sessionId;
      window.__CC_TRACKER_TOKEN = this.config.get('trackerToken');
    }
    
    this.logger.log('Session started:', this.sessionId);
    return this.sessionId;
  }

  
  getId() {
    return this.sessionId;
  }

  
  end() {
    this.logger.log('Session ended:', this.sessionId);
    this.sessionId = null;
    this.config.set('sessionId', null);
  }

  
  isActive() {
    return this.sessionId !== null;
  }
}