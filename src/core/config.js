import { getTrackerFromURL } from '../utils/helpers.js';


export class Config {
  constructor() {
    this.defaults = {
      trackerToken: null,
      apiUrl: 'http://127.0.0.1:8000/api/v1/events/',
      sessionId: null,
      pingInterval: 15000,
      debug: false,
      autoTrack: true, 
      respectDoNotTrack: true, 
      maxRetries: 3,
      retryDelay: 1000,
      domain: null,
    };
    
    this.config = { ...this.defaults };
  }

  
  init(options = {}) {
    this.config = {
      ...this.defaults,
      ...options,
      trackerToken: options.trackerToken || getTrackerFromURL()
    };

    return this.validate();
  }

  
  validate() {
    if (!this.config.trackerToken) {
      console.error('CarbonCut: No tracker token provided. Add data-token="YOUR_TOKEN" to script tag.');
      return false;
    }

    if (!this.config.apiUrl) {
      console.error('CarbonCut: API URL is required');
      return false;
    }

    return true;
  }

  
  get(key) {
    return this.config[key];
  }

  
  set(key, value) {
    this.config[key] = value;
  }

  
  getAll() {
    return { ...this.config };
  }
}