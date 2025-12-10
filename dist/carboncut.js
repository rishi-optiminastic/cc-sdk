var CarbonCut = (function () {
  'use strict';

  function getTrackerFromURL() {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('cc_tracker');
  }


  function getBrowserMetadata() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return {};
    }

    return {
      user_agent: navigator.userAgent,
      screen_resolution: `${window.screen.width}x${window.screen.height}`,
      viewport_size: `${window.innerWidth}x${window.innerHeight}`,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      referrer: document.referrer || 'direct',
      page_url: window.location.href,
      page_title: document.title
    };
  }


  function getPageInfo() {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return {};
    }

    return {
      page_path: window.location.pathname,
      page_url: window.location.href,
      page_title: document.title,
      referrer: document.referrer
    };
  }


  function isBrowser() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  }

  class Config {
    constructor() {
      this.defaults = {
        trackerToken: null,
        // Ensure trailing slash is always present
        apiUrl: 'http://127.0.0.1:8000/api/v1/events/', 
        sessionId: null,
        pingInterval: 15000,
        debug: false,
        autoTrack: true, 
        respectDoNotTrack: true, 
        maxRetries: 3,
        retryDelay: 1000,
        domain: null,
        //   Geolocation options
        enableGeolocation: false, 
        requestLocation: false, 
        geolocationTimeout: 10000, 
        geolocationHighAccuracy: false,
        autoRequestLocation: true,
        //   NEW: Automatically prompt for location on SDK load
        promptForLocationOnLoad: true, 
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

  class State {
    constructor() {
      this.state = {
        isInitialized: false,
        timeSpent: 0,
        lastPath: null,
        retryCount: 0
      };
    }

    
    get(key) {
      return this.state[key];
    }

    
    set(key, value) {
      this.state[key] = value;
    }

    
    incrementTimeSpent(seconds) {
      this.state.timeSpent += seconds;
    }

    
    reset() {
      this.state = {
        isInitialized: false,
        timeSpent: 0,
        lastPath: null,
        retryCount: 0
      };
    }

    
    getAll() {
      return { ...this.state };
    }
  }

  function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    
   
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  class Session {
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

  class Logger {
    constructor(debug = false) {
      this.debug = debug;
      this.prefix = 'CarbonCut:';
    }

    setDebug(debug) {
      this.debug = debug;
    }

    log(...args) {
      if (this.debug) {
        console.log(this.prefix, ...args);
      }
    }

    warn(...args) {
      if (this.debug) {
        console.warn(this.prefix, ...args);
      }
    }

    error(...args) {
      console.error(this.prefix, ...args);
    }

    info(...args) {
      if (this.debug) {
        console.info(this.prefix, ...args);
      }
    }
  }

  class ApiTransport {
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

  class ApiWorkerTransport {
    constructor(config, logger) {
      this.config = config;
      this.logger = logger;
      this.worker = null;
      this.isSupported = this.checkWorkerSupport();
      this.queueSize = 0;
      
      if (this.isSupported) {
        this.initWorker();
      } else {
        this.logger.warn('Web Workers not supported, falling back to main thread');
      }
    }

    checkWorkerSupport() {
      return typeof Worker !== 'undefined';
    }

    initWorker() {
      try {
        const workerCode = this.getWorkerCode();
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        
        this.worker = new Worker(workerUrl);
        
        this.worker.addEventListener('message', (event) => {
          this.handleWorkerMessage(event.data);
        });
        
        this.worker.addEventListener('error', (error) => {
          this.logger.error('Worker error:', error);
        });
        
        this.worker.postMessage({
          type: 'INIT',
          payload: {
            apiUrl: this.config.get('apiUrl'),
            trackerToken: this.config.get('trackerToken'),
            batchSize: 10,
            batchInterval: 5000
          }
        });
        
        this.setupOnlineListener();
        
        this.logger.log('Web Worker initialized for v2 event processing');
      } catch (error) {
        this.logger.error('Failed to initialize worker:', error);
        this.worker = null;
      }
    }

    getWorkerCode() {
      return `
      let config = null;
      let eventQueue = [];
      let flushTimer = null;
      let isOnline = true;

      // ✅ Add query string builder
      function buildQueryString(payload) {
        const params = new URLSearchParams();
        
        Object.entries(payload).forEach(([key, value]) => {
          if (value === null || value === undefined) return;
          
          if (typeof value === 'object' && !Array.isArray(value)) {
            params.append(key, JSON.stringify(value));
          } else if (Array.isArray(value)) {
            params.append(key, JSON.stringify(value));
          } else {
            params.append(key, String(value));
          }
        });
        
        return params.toString();
      }

      self.addEventListener('message', async (event) => {
        const { type, payload } = event.data;

        switch (type) {
          case 'INIT':
            config = payload;
            if (config.batchInterval) {
              flushTimer = setInterval(() => {
                if (eventQueue.length > 0) {
                  flushQueue();
                }
              }, config.batchInterval);
            }
            self.postMessage({ type: 'INIT_SUCCESS' });
            break;
          
          case 'TRACK_EVENT':
            eventQueue.push({ ...payload, queuedAt: Date.now() });
            if (eventQueue.length >= (config.batchSize || 10)) {
              flushQueue();
            }
            break;
          
          case 'FLUSH_QUEUE':
            await flushQueue();
            break;
          
          case 'ONLINE':
            isOnline = true;
            await flushQueue();
            break;
          
          case 'OFFLINE':
            isOnline = false;
            break;
          
          case 'GET_QUEUE_SIZE':
            self.postMessage({ type: 'QUEUE_SIZE', size: eventQueue.length });
            break;
        }
      });

      async function flushQueue() {
        if (eventQueue.length === 0 || !isOnline) return;
        
        const batch = [...eventQueue];
        eventQueue = [];
        
        try {
          // ✅ Send individual events via GET
          for (const event of batch) {
            let baseUrl = config.apiUrl.endsWith('/') 
              ? config.apiUrl.slice(0, -1) 
              : config.apiUrl;
            
            const queryString = buildQueryString(event);
            const fullUrl = \`\${baseUrl}?\${queryString}\`;
            
            const response = await fetch(fullUrl, {
              method: 'GET',
              headers: {
                'X-Tracker-Token': config.trackerToken
              },
              keepalive: true,
              redirect: 'error'
            });
            
            if (response.status !== 202 && response.status !== 200) {
              throw new Error(\`HTTP \${response.status}\`);
            }
          }
          
          self.postMessage({ type: 'FLUSH_SUCCESS', count: batch.length });
        } catch (error) {
          eventQueue.push(...batch);
          self.postMessage({ type: 'FLUSH_ERROR', error: error.message, count: batch.length });
        }
      }
    `;
    }

    handleWorkerMessage(data) {
      const { type, count, error, size } = data;
      
      switch (type) {
        case 'INIT_SUCCESS':
          this.logger.log('Worker ready for v2 API (GET requests)');
          break;
        
        case 'FLUSH_SUCCESS':
          this.logger.log(`Worker flushed ${count} events successfully via GET`);
          this.queueSize = Math.max(0, this.queueSize - count);
          break;
        
        case 'FLUSH_ERROR':
          this.logger.error(`Worker flush failed for ${count} events:`, error);
          break;
        
        case 'QUEUE_SIZE':
          this.queueSize = size;
          break;
      }
    }

    setupOnlineListener() {
      if (typeof window === 'undefined') return;

      window.addEventListener('online', () => {
        this.logger.log('Connection restored, notifying worker');
        this.worker?.postMessage({ type: 'ONLINE' });
      });

      window.addEventListener('offline', () => {
        this.logger.warn('Connection lost, notifying worker');
        this.worker?.postMessage({ type: 'OFFLINE' });
      });
    }

    send(payload) {
      if (!this.worker) {
        this.logger.error('Worker not initialized');
        return false;
      }

      this.worker.postMessage({
        type: 'TRACK_EVENT',
        payload
      });
      
      this.queueSize++;
      return true;
    }

    flush() {
      if (!this.worker) return;
      
      this.worker.postMessage({ type: 'FLUSH_QUEUE' });
    }

    getQueueSize() {
      return this.queueSize;
    }

    terminate() {
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
        this.logger.log('Worker terminated');
      }
    }
  }

  /**
   * Extract UTM parameters from URL or provide defaults
   * @returns {Object} UTM parameters object
   */
  function getUTMParams() {
    if (typeof window === 'undefined') {
      return getDefaultUTMParams();
    }

    const urlParams = new URLSearchParams(window.location.search);
    
    return {
      utm_campaign: urlParams.get('utm_campaign') || getSessionStorage('utm_campaign') || '',
      utm_source: urlParams.get('utm_source') || getSessionStorage('utm_source') || '',
      utm_medium: urlParams.get('utm_medium') || getSessionStorage('utm_medium') || '',
      utm_term: urlParams.get('utm_term') || getSessionStorage('utm_term') || '',
      utm_content: urlParams.get('utm_content') || getSessionStorage('utm_content') || ''
    };
  }

  /**
   * Store UTM parameters in session storage for persistence
   * @param {Object} utmParams UTM parameters
   */
  function storeUTMParams(utmParams) {
    if (typeof window === 'undefined') return;

    Object.entries(utmParams).forEach(([key, value]) => {
      if (value && value !== 'direct' && value !== 'none') {
        try {
          sessionStorage.setItem(key, value);
        } catch (e) {
          // Silent fail if sessionStorage is not available
        }
      }
    });
  }

  /**
   * Get UTM parameter from session storage
   * @param {string} key Parameter key
   * @returns {string|null} Parameter value
   */
  function getSessionStorage(key) {
    if (typeof window === 'undefined') return null;
    
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  /**
   * Get default UTM parameters for server-side or fallback
   * @returns {Object} Default UTM parameters
   */
  function getDefaultUTMParams() {
    return {
      utm_campaign: '',
      utm_source: '',
      utm_medium: '',
      utm_term: '',
      utm_content: ''
    };
  }

  /**
   * Generate unique event ID
   * @returns {string} Unique event ID
   */
  function generateEventId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    
    return 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Calculate bytes transferred for navigation and resources
   */
  class PerformanceMonitor {
    constructor(logger) {
      this.logger = logger;
      this.lastCheckTime = Date.now();
      this.pendingRequests = new Map(); //  Track pending tracking requests
    }

    /**
     * Get page load bytes from Navigation Timing API
     */
    getPageViewBytes() {
      if (typeof window === 'undefined' || !window.performance) {
        return null;
      }

      try {
        const navigation = performance.getEntriesByType('navigation')[0];
        
        if (navigation) {
          return {
            encodedBodySize: navigation.encodedBodySize || 0,
            decodedBodySize: navigation.decodedBodySize || 0,
            transferSize: navigation.transferSize || 0,
            bytes: navigation.transferSize || 0
          };
        }
      } catch (error) {
        this.logger.error('Error getting page view bytes:', error);
      }

      return null;
    }

    /**
     *  NEW: Get the most recent tracking request bytes
     */
    getLatestTrackingRequestBytes() {
      if (typeof window === 'undefined' || !window.performance) {
        return 0;
      }

      try {
        const entries = performance.getEntriesByType('resource');
        
        // Find the most recent request to /events/
        const trackingRequests = entries
          .filter(e => e.name.includes('/events') || e.name.includes('/api/v1'))
          .sort((a, b) => b.startTime - a.startTime); // Sort by most recent
        
        if (trackingRequests.length > 0) {
          const latest = trackingRequests[0];
          const bytes = latest.transferSize || this.estimateGetRequestSize(latest.name);
          
          this.logger.log('📊 Latest tracking request bytes:', {
            url: latest.name.substring(0, 100) + '...',
            transferSize: latest.transferSize,
            encodedBodySize: latest.encodedBodySize,
            estimatedBytes: bytes
          });
          
          return bytes;
        }
      } catch (error) {
        this.logger.error('Error getting latest tracking request bytes:', error);
      }

      return 0;
    }

    /**
     *  NEW: Estimate GET request size from URL length
     */
    estimateGetRequestSize(url) {
      // GET request size = URL length + HTTP headers (~500-800 bytes)
      const urlBytes = new Blob([url]).size;
      const estimatedHeaders = 600; // Average HTTP GET headers
      return urlBytes + estimatedHeaders;
    }

    /**
     * Get bytes for specific fetch/XHR request
     */
    getRequestBytes(url) {
      if (typeof window === 'undefined' || !window.performance) {
        return null;
      }

      try {
        const entries = performance.getEntriesByType('resource');
        const entry = entries.find(e => e.name.includes(url));

        if (entry) {
          return {
            encodedBodySize: entry.encodedBodySize || 0,
            decodedBodySize: entry.decodedBodySize || 0,
            transferSize: entry.transferSize || 0,
            bytes: entry.transferSize || 0
          };
        }
      } catch (error) {
        this.logger.error('Error getting request bytes:', error);
      }

      return null;
    }

    /**
     *  UPDATED: Get resources loaded since a specific timestamp
     */
    getResourcesBytesSince(timestamp) {
      if (typeof window === 'undefined' || !window.performance) {
        return { total: 0, count: 0, byType: {} };
      }

      try {
        const entries = performance.getEntriesByType('resource');
        const recentEntries = entries.filter(entry => {
          const entryTime = performance.timeOrigin + entry.startTime;
          return entryTime >= timestamp;
        });

        const byType = {};
        let total = 0;

        recentEntries.forEach(entry => {
          const type = entry.initiatorType || 'other';
          const bytes = entry.transferSize || this.estimateGetRequestSize(entry.name);

          byType[type] = (byType[type] || 0) + bytes;
          total += bytes;
        });

        return { 
          total, 
          count: recentEntries.length,
          byType 
        };
      } catch (error) {
        this.logger.error('Error getting resources since timestamp:', error);
        return { total: 0, count: 0, byType: {} };
      }
    }

    /**
     * Get all resource bytes since page load
     */
    getAllResourceBytes() {
      if (typeof window === 'undefined' || !window.performance) {
        return { total: 0, byType: {} };
      }

      try {
        const entries = performance.getEntriesByType('resource');
        
        const byType = {};
        let total = 0;

        entries.forEach(entry => {
          const type = entry.initiatorType || 'other';
          const bytes = entry.transferSize || 0;

          byType[type] = (byType[type] || 0) + bytes;
          total += bytes;
        });

        return { total, byType };
      } catch (error) {
        this.logger.error('Error getting resource bytes:', error);
        return { total: 0, byType: {} };
      }
    }

    /**
     * Monitor fetch/XHR bytes for tracking requests
     */
    observeTrackingBytes(callback) {
      if (typeof PerformanceObserver === 'undefined') {
        this.logger.warn('PerformanceObserver not supported');
        return null;
      }

      try {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            if (entry.name.includes('/events') || entry.name.includes('api/v1')) {
              const bytes = entry.transferSize || this.estimateGetRequestSize(entry.name);
              
              callback({
                url: entry.name,
                bytes: bytes,
                transferSize: entry.transferSize,
                duration: entry.duration,
                type: entry.initiatorType
              });
            }
          });
        });

        observer.observe({ entryTypes: ['resource'] });
        return observer;
      } catch (error) {
        this.logger.error('Error setting up PerformanceObserver:', error);
        return null;
      }
    }

    /**
     *  UPDATED: Get tracking request by event ID
     */
    getRequestByEventId(eventId) {
      if (typeof window === 'undefined' || !window.performance) {
        return null;
      }

      try {
        const entries = performance.getEntriesByType('resource');
        // Find most recent tracking request
        const trackingEntries = entries.filter(e => 
          e.name.includes('/events') || e.name.includes('api/v1')
        );
        
        if (trackingEntries.length > 0) {
          const latest = trackingEntries[trackingEntries.length - 1];
          const bytes = latest.transferSize || this.estimateGetRequestSize(latest.name);
          
          return {
            bytes: bytes,
            encoded: latest.encodedBodySize || 0,
            decoded: latest.decodedBodySize || 0,
            transferSize: latest.transferSize
          };
        }
      } catch (error) {
        this.logger.error('Error getting request by event ID:', error);
      }

      return null;
    }
  }

  /**
   * Geolocation utility with caching and error handling
   */
  class GeolocationManager {
    constructor(logger) {
      this.logger = logger;
      this.cacheKey = 'cc_geolocation_cache';
      this.cacheExpiry = 60 * 60 * 1000; // 1 hour in milliseconds
      this.cachedLocation = null;
      this.isRequesting = false;
      
      //   Always log initialization (even without debug)
      console.log('CarbonCut: 📍 GeolocationManager initialized', {
        cacheKey: this.cacheKey,
        cacheExpiry: `${this.cacheExpiry / 1000 / 60} minutes`
      });
    }

    /**
     * Get cached location from localStorage
     */
    getCachedLocation() {
      if (typeof localStorage === 'undefined') {
        this.logger.warn('📍 localStorage not available');
        return null;
      }

      try {
        const cached = localStorage.getItem(this.cacheKey);
        
        if (!cached) {
          this.logger.log('📍 No cached location found');
          return null;
        }

        const { location, timestamp } = JSON.parse(cached);
        const now = Date.now();
        const cacheAge = Math.floor((now - timestamp) / 1000 / 60); // minutes

        //  Log cache details
        this.logger.log('📍 Cached location found:', {
          location,
          cachedAt: new Date(timestamp).toISOString(),
          ageMinutes: cacheAge,
          expiresInMinutes: Math.floor((this.cacheExpiry - (now - timestamp)) / 1000 / 60)
        });

        // Check if cache is still valid (1 hour)
        if (now - timestamp < this.cacheExpiry) {
          this.logger.log('Using cached geolocation (still valid)');
          return location;
        } else {
          this.logger.log('Geolocation cache expired, removing');
          localStorage.removeItem(this.cacheKey);
          return null;
        }
      } catch (error) {
        this.logger.error('❌ Error reading cached location:', error);
        return null;
      }
    }

    /**
     * Save location to cache
     */
    cacheLocation(location) {
      if (typeof localStorage === 'undefined') {
        this.logger.warn('📍 localStorage not available, cannot cache');
        return;
      }

      try {
        const cacheData = {
          location,
          timestamp: Date.now()
        };
        
        localStorage.setItem(this.cacheKey, JSON.stringify(cacheData));
        
        //   Log caching details
        this.logger.log('💾 Geolocation cached successfully:', {
          location,
          cachedAt: new Date(cacheData.timestamp).toISOString(),
          expiresAt: new Date(cacheData.timestamp + this.cacheExpiry).toISOString()
        });
      } catch (error) {
        this.logger.error('❌ Error caching location:', error);
      }
    }

    /**
     * Get current location with caching
     * @param {Object} options Geolocation options
     * @returns {Promise<Object|null>} Location data or null
     */
    async getCurrentLocation(options = {}) {
      //   Always log location requests
      console.log('CarbonCut: 📍 Requesting geolocation with options:', options);
      
      // Check cache first
      const cached = this.getCachedLocation();
      if (cached) {
        //   Always log cached location usage
        console.log('CarbonCut:   Using cached location:', {
          latitude: cached.latitude.toFixed(6),
          longitude: cached.longitude.toFixed(6),
          accuracy: `${Math.round(cached.accuracy)}m`
        });
        return cached;
      }

      // Prevent multiple simultaneous requests
      if (this.isRequesting) {
        console.warn('CarbonCut: ⚠️ Geolocation request already in progress');
        return null;
      }

      // Check if geolocation is supported
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        console.warn('CarbonCut: ❌ Geolocation is not supported by this browser');
        return null;
      }

      this.isRequesting = true;
      console.log('CarbonCut: 🌍 Requesting fresh geolocation from browser...');

      const defaultOptions = {
        enableHighAccuracy: false,
        timeout: 10000, // 10 seconds
        maximumAge: 0,
        ...options
      };

      try {
        const startTime = Date.now();
        
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            defaultOptions
          );
        });

        const requestDuration = Date.now() - startTime;

        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          heading: position.coords.heading,
          speed: position.coords.speed
        };

        //   Always log successful location retrieval
        console.log('CarbonCut:   Geolocation obtained successfully:', {
          latitude: location.latitude.toFixed(6),
          longitude: location.longitude.toFixed(6),
          accuracy: `${Math.round(location.accuracy)}m`,
          requestDuration: `${requestDuration}ms`,
          timestamp: new Date(position.timestamp).toISOString()
        });

        // Cache the location
        this.cacheLocation(location);
        this.cachedLocation = location;
        this.isRequesting = false;

        return location;

      } catch (error) {
        const requestDuration = Date.now() - startTime;
        this.isRequesting = false;

        //   Always log errors
        const errorInfo = {
          errorCode: error.code,
          errorMessage: error.message,
          requestDuration: `${requestDuration}ms`,
          timestamp: new Date().toISOString()
        };

        // Handle different error types
        switch (error.code) {
          case error.PERMISSION_DENIED:
            console.warn('CarbonCut: ❌ Geolocation permission denied by user', errorInfo);
            break;
          case error.POSITION_UNAVAILABLE:
            console.warn('CarbonCut: ❌ Geolocation position unavailable', errorInfo);
            break;
          case error.TIMEOUT:
            console.warn('CarbonCut: ⏱️ Geolocation request timed out', errorInfo);
            break;
          default:
            console.error('CarbonCut: ❌ Geolocation error:', error, errorInfo);
        }

        return null;
      }
    }

    /**
     * Clear cached location
     */
    clearCache() {
      if (typeof localStorage === 'undefined') {
        this.logger.warn('📍 localStorage not available');
        return;
      }

      try {
        const hadCache = localStorage.getItem(this.cacheKey) !== null;
        
        localStorage.removeItem(this.cacheKey);
        this.cachedLocation = null;
        
        //   Log cache clearing
        this.logger.log('🗑️ Geolocation cache cleared', {
          hadCache,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.logger.error('❌ Error clearing location cache:', error);
      }
    }

    /**
     * Check if geolocation permission is granted
     * @returns {Promise<boolean>} Permission status
     */
    async checkPermission() {
      if (typeof navigator === 'undefined' || !navigator.permissions) {
        this.logger.warn('❌ Permissions API not available');
        return false;
      }

      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        
        //   Log permission status
        this.logger.log('🔐 Geolocation permission status:', {
          state: result.state,
          timestamp: new Date().toISOString()
        });
        
        return result.state === 'granted';
      } catch (error) {
        this.logger.error('❌ Error checking geolocation permission:', error);
        return false;
      }
    }

    /**
     *   NEW: Get current cache status
     */
    getCacheStatus() {
      if (typeof localStorage === 'undefined') {
        return { hasCache: false, reason: 'localStorage not available' };
      }

      try {
        const cached = localStorage.getItem(this.cacheKey);
        
        if (!cached) {
          return { 
            hasCache: false, 
            reason: 'No cache found' 
          };
        }

        const { location, timestamp } = JSON.parse(cached);
        const now = Date.now();
        const ageMinutes = Math.floor((now - timestamp) / 1000 / 60);
        const isValid = (now - timestamp) < this.cacheExpiry;

        const status = {
          hasCache: true,
          isValid,
          location,
          cachedAt: new Date(timestamp).toISOString(),
          ageMinutes,
          expiresInMinutes: isValid ? Math.floor((this.cacheExpiry - (now - timestamp)) / 1000 / 60) : 0
        };

        this.logger.log('📊 Cache status:', status);
        return status;
      } catch (error) {
        this.logger.error('❌ Error getting cache status:', error);
        return { hasCache: false, reason: 'Error reading cache', error: error.message };
      }
    }
  }

  class EventTracker {
    constructor(config, session, transport, logger) {
      this.config = config;
      this.session = session;
      this.transport = transport;
      this.logger = logger;
      this.sentEvents = new Map();
      this.utmParams = null;
      this.conversionRulesApplied = false;

      // Add performance monitor
      this.performanceMonitor = new PerformanceMonitor(logger);
      
      //   Add geolocation manager
      this.geolocationManager = new GeolocationManager(logger);
      
      this.bytesTracked = {
        pageView: 0,
        clicks: 0,
        conversions: 0,
        total: 0
      };

      // Track last event timestamp for calculating request bytes
      this.lastEventTime = Date.now();

      // Initialize and store UTM parameters
      this.initializeUTMParams();
      this.setupPerformanceTracking();
    }

    /**
     * Initialize UTM parameters from URL
     */
    initializeUTMParams() {
      this.utmParams = getUTMParams();
      storeUTMParams(this.utmParams);
      this.logger.log("UTM parameters initialized:", this.utmParams);
    }

    /**
     * Setup performance tracking for API requests
     */
    setupPerformanceTracking() {
      this.performanceObserver = this.performanceMonitor.observeTrackingBytes(
        (data) => {
          this.logger.log("📊 Tracking request bytes:", data);

          // Aggregate bytes by event type
          if (data.url.includes("page_view")) {
            this.bytesTracked.pageView += data.bytes;
          } else if (data.url.includes("click")) {
            this.bytesTracked.clicks += data.bytes;
          } else if (data.url.includes("conversion")) {
            this.bytesTracked.conversions += data.bytes;
          }
          
          this.bytesTracked.total += data.bytes;
        }
      );
    }

    /**
     * Get bytes for the tracking request itself
     */
    async getTrackingRequestBytes(eventId) {
      // Wait a bit for the request to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const requestBytes = this.performanceMonitor.getRequestByEventId(eventId);
      return requestBytes?.bytes || 0;
    }

    /**
     * Calculate estimated request size
     */
    estimateRequestSize(payload) {
      const jsonString = JSON.stringify(payload);
      const bodyBytes = new Blob([jsonString]).size;
      
      // Estimate HTTP headers (~800-1000 bytes)
      const estimatedHeaders = 850;
      
      return {
        bodyBytes,
        estimatedTotal: bodyBytes + estimatedHeaders,
        actualJson: jsonString
      };
    }

    /**
     * Get geolocation data if enabled
     */
    async getGeolocationData() {
      const enableGeolocation = this.config.get('enableGeolocation');
      const requestLocation = this.config.get('requestLocation');

      //   Log geolocation configuration
      this.logger.log('📍 Geolocation configuration:', {
        enableGeolocation,
        requestLocation,
        timeout: this.config.get('geolocationTimeout'),
        highAccuracy: this.config.get('geolocationHighAccuracy')
      });

      if (!enableGeolocation && !requestLocation) {
        this.logger.log('📍 Geolocation disabled, skipping');
        return null;
      }

      //   Check cache status before requesting
      const cacheStatus = this.geolocationManager.getCacheStatus();
      this.logger.log('📍 Cache status before request:', cacheStatus);

      try {
        const location = await this.geolocationManager.getCurrentLocation({
          enableHighAccuracy: this.config.get('geolocationHighAccuracy'),
          timeout: this.config.get('geolocationTimeout')
        });

        if (location) {
          //   Log successful geolocation retrieval
          this.logger.log('Geolocation data ready for event:', {
            latitude: location.latitude.toFixed(6),
            longitude: location.longitude.toFixed(6),
            accuracy: `${Math.round(location.accuracy)}m`,
            fromCache: cacheStatus.isValid,
            timestamp: new Date(location.timestamp).toISOString()
          });
        } else {
          this.logger.warn('⚠️ Geolocation returned null');
        }

        return location;
      } catch (error) {
        this.logger.error('❌ Failed to get geolocation:', error);
        return null;
      }
    }

    /**
     * Send event with byte tracking
     * @param {string} event Event type
     * @param {Object} data Additional event data
     */
    async send(event, data = {}) {
      if (!this.session.isActive()) {
        this.logger.error("Cannot send event without active session");
        return;
      }

      const eventTypeMapping = {
        session_start: "session_start",  
        page_view: "page_view",
        ping: "page_view",
        custom_event: "click",
        session_end: "conversion",
        button_click: "click",
        form_submit: "conversion",
        conversion: "conversion",
      };

      const mappedEventType = eventTypeMapping[event] || "click";
      const eventId = generateEventId();

      // Get performance data based on event type
      let performanceData = {};
      
      if (event === "session_start") {
        // Initial page load - use Navigation Timing API
        const pageBytes = this.performanceMonitor.getPageViewBytes();
        if (pageBytes) {
          performanceData = {
            bytesPerPageView: pageBytes.transferSize,
            encodedSize: pageBytes.encodedBodySize,
            decodedSize: pageBytes.decodedBodySize,
            resourceType: 'navigation'
          };
        }
      } else {
        // For all other events, get resources + tracking request bytes
        const resourceBytes = this.performanceMonitor.getResourcesBytesSince(this.lastEventTime);
        
        performanceData = {
          resourceCount: resourceBytes.count,
          resourceTypes: resourceBytes.byType,
          resourceType: 'dynamic'
        };

        // Add event-specific byte fields
        if (event === "page_view" || event === "ping") {
          performanceData.bytesPerPageView = resourceBytes.total;
        } else if (event === "button_click" || mappedEventType === "click") {
          performanceData.bytesPerClick = resourceBytes.total;
        } else if (mappedEventType === "conversion") {
          performanceData.bytesPerConversion = resourceBytes.total;
        }
      }

      //   NEW: Get geolocation data (only for session_start and conversions by default)
      let geolocationData = null;
      if (event === "session_start" || event === "conversion") {
        geolocationData = await this.getGeolocationData();
      }

      // Build v2 payload format
      const payload = {
        event: mappedEventType,
        session_id: this.session.getId(),
        timestamp: new Date().toISOString(),
        tracker_token: this.config.get("trackerToken"),
        utm_params: this.utmParams,
        event_id: eventId,
        user_id: data.user_id || this.session.getId(),
        page_url:
          typeof window !== "undefined"
            ? window.location.href
            : data.page_url || "",
        referrer:
          typeof document !== "undefined"
            ? document.referrer
            : data.referrer || "",
        ...performanceData,
        ...(geolocationData && { 
          geolocation: geolocationData,
          latitude: geolocationData.latitude,
          longitude: geolocationData.longitude,
          location_accuracy: geolocationData.accuracy
        }),
        ...data,
      };

      // Add estimated tracking request size
      const requestSize = this.estimateRequestSize(payload);
      payload.trackingRequestBytes = requestSize.estimatedTotal;
      payload.trackingRequestBody = requestSize.bodyBytes;

      // Prevent duplicate events
      const eventKey = `${event}_${payload.timestamp}_${JSON.stringify(data)}`;

      if (this.sentEvents.has(eventKey)) {
        this.logger.warn("Duplicate event prevented:", event);
        return;
      }

      this.sentEvents.set(eventKey, Date.now());

      // Clean up old entries after 2 seconds
      setTimeout(() => {
        this.sentEvents.delete(eventKey);
      }, 2000);

      this.logger.log("📤 Sending event with performance data:", {
        event: mappedEventType,
        bytes: performanceData,
        requestSize: requestSize.estimatedTotal,
        hasGeolocation: !!geolocationData
      });
      
      this.transport.send(payload);

      // Update last event time AFTER sending
      setTimeout(() => {
        this.lastEventTime = Date.now();
        
        // Update byte tracking after request completes
        const latestBytes = this.performanceMonitor.getLatestTrackingRequestBytes();
        if (latestBytes > 0) {
          this.logger.log(`Captured ${latestBytes} bytes for ${event} event`);
        }
      }, 100);

      // CHECK URL CONVERSIONS ON EVERY PAGE VIEW
      if (event === "page_view" || event === "session_start") {
        this.checkUrlConversions();
      }
    }

    /**
     * Track custom event with v2 format
     * @param {string} eventName Custom event name
     * @param {Object} data Event data
     */
    trackCustomEvent(eventName, data = {}) {
      this.send("custom_event", {
        event_name: eventName,
        event_data: data,
        custom_event_type: eventName,
        ...data,
      });

      this.logger.log("Custom event tracked:", eventName);
    }

    /**
     * Update UTM parameters (e.g., for SPA navigation)
     */
    refreshUTMParams() {
      this.utmParams = getUTMParams();
      storeUTMParams(this.utmParams);
      this.logger.log("UTM parameters refreshed:", this.utmParams);
    }
    applyConversionRules() {
      const rules = this.config.get("conversionRules") || [];

      if (!rules.length) {
        this.logger.warn(
          "No conversion rules found. Skipping conversion tracking."
        );
        return;
      }

      this.logger.log(`📋 Applying ${rules.length} conversion rules`);

      // Apply click-based rules (set up event listeners)
      rules.forEach((rule) => {
        if (rule.type === "click") {
          this.trackClickConversion(rule);
        }
      });

      // Check URL-based rules immediately
      this.checkUrlConversions();

      this.conversionRulesApplied = true;
    }

    //  NEW METHOD: Check URL conversions (called on every page view)
    checkUrlConversions() {
      const rules = this.config.get("conversionRules") || [];
      const urlRules = rules.filter((r) => r.type === "url");

      if (urlRules.length === 0) return;

      const currentUrl = window.location.href;
      const currentPath = window.location.pathname;

      this.logger.log("🔍 Checking URL conversions for:", currentPath);

      urlRules.forEach((rule) => {
        let matched = false;
        const pattern = rule.pattern;

        switch (rule.match_type) {
          case "contains":
            matched =
              currentUrl.includes(pattern) || currentPath.includes(pattern);
            break;
          case "exact":
            matched = currentUrl === pattern || currentPath === pattern;
            break;
          case "starts_with":
            matched =
              currentUrl.startsWith(pattern) || currentPath.startsWith(pattern);
            break;
          case "ends_with":
            matched =
              currentUrl.endsWith(pattern) || currentPath.endsWith(pattern);
            break;
          case "regex":
            try {
              const regex = new RegExp(pattern);
              matched = regex.test(currentUrl) || regex.test(currentPath);
            } catch (e) {
              this.logger.error("Invalid regex pattern:", pattern, e);
            }
            break;
        }

        if (matched) {
          this.logger.log("🎯 URL conversion matched:", rule);
          this.send("conversion", {
            conversion_type: "url",
            conversion_label: rule.name,
            conversion_url: currentUrl,
            conversion_rule_id: rule.id,
            match_type: rule.match_type,
            pattern: pattern,
          });
        }
      });
    }

    trackUrlConversion(rule) {
      // This is now handled by checkUrlConversions()
      this.logger.warn(
        "trackUrlConversion is deprecated, use checkUrlConversions instead"
      );
    }

    trackClickConversion(rule) {
      this.logger.log("Setting up click conversion listener for:", rule.selector);

      document.addEventListener("click", (event) => {
        const target = event.target.closest(rule.selector);

        if (target) {
          this.logger.log("🎯 Click conversion matched:", rule);
          this.send("conversion", {
            conversion_type: "click",
            conversion_label: rule.name,
            conversion_selector: rule.selector,
            conversion_element: target.tagName,
            conversion_rule_id: rule.id,
            element_text: target.innerText?.substring(0, 100),
          });
        }
      });
    }

    /**
     * Get aggregated bytes by event type
     */
    getBytesTracked() {
      return {
        ...this.bytesTracked,
        total: Object.values(this.bytesTracked).reduce((a, b) => a + b, 0),
      };
    }

    /**
     *   NEW: Manually request location (useful for opt-in consent)
     */
    async requestUserLocation() {
      this.logger.log('📍 Manual location request initiated');
      
      // Log current permission status
      const hasPermission = await this.geolocationManager.checkPermission();
      this.logger.log('📍 Current permission status:', hasPermission ? 'granted' : 'not granted');
      
      const location = await this.geolocationManager.getCurrentLocation();
      
      if (location) {
        this.logger.log('  Manual location request successful:', {
          latitude: location.latitude.toFixed(6),
          longitude: location.longitude.toFixed(6),
          accuracy: `${Math.round(location.accuracy)}m`
        });
        return location;
      } else {
        this.logger.warn('❌ Manual location request failed');
        return null;
      }
    }

    /**
     *   NEW: Clear location cache
     */
    clearLocationCache() {
      this.logger.log('🗑️ Clearing location cache...');
      this.geolocationManager.clearCache();
    }
  }

  class PingTracker {
    constructor(config, state, eventTracker, logger) {
      this.config = config;
      this.state = state;
      this.eventTracker = eventTracker;
      this.logger = logger;
      this.timer = null;
    }

    
    start() {
      this.stop();

      const interval = this.config.get('pingInterval');
      
      this.timer = setInterval(() => {
        const seconds = interval / 1000;
        this.state.incrementTimeSpent(seconds);
        this.ping();
      }, interval);

      this.logger.log(`Ping timer started. Interval: ${interval / 1000}s`);
    }

    
    stop() {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
        this.logger.log('Ping timer stopped');
      }
    }

    
    ping() {
      this.eventTracker.send('ping', {
        time_spent_seconds: this.state.get('timeSpent'),
        page_url: typeof window !== 'undefined' ? window.location.href : null,
        is_visible: typeof document !== 'undefined' ? !document.hidden : true
      });
    }

    
    trigger() {
      this.ping();
    }

    
    isRunning() {
      return this.timer !== null;
    }
  }

  class PageViewTracker {
    constructor(config, state, eventTracker, logger) {
      this.config = config;
      this.state = state;
      this.eventTracker = eventTracker;
      this.logger = logger;
    }

    
    track(pagePath) {
      const pageInfo = getPageInfo();
      
      if (pagePath) {
        pageInfo.page_path = pagePath;
      }

      this.eventTracker.send('page_view', pageInfo);
      this.state.set('lastPath', pageInfo.page_path);
      this.logger.log('Page view tracked:', pageInfo.page_path);
    }
  }

  class BrowserListeners {
    constructor(config, state, session, eventTracker, pingTracker, pageViewTracker, logger) {
      this.config = config;
      this.state = state;
      this.session = session;
      this.eventTracker = eventTracker;
      this.pingTracker = pingTracker;
      this.pageViewTracker = pageViewTracker;
      this.logger = logger;
    }

    setup() {
      if (typeof window === 'undefined') return;

      this.setupUnloadListener();
      this.setupVisibilityListener();
      
      this.setupClickTracking();
      
      if (this.config.get('autoTrack')) {
        this.setupNavigationListeners();
      }
    }

    setupUnloadListener() {
      window.addEventListener('beforeunload', () => {
        this.pingTracker.stop();
        this.eventTracker.send('session_end', {
          total_time_spent_seconds: this.state.get('timeSpent'),
          page_url: window.location.href
        });
        this.session.end();
      });
    }

    setupVisibilityListener() {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.pingTracker.stop();
          this.logger.log('Page hidden, ping timer paused');
        } else {
          this.pingTracker.start();
          this.logger.log('Page visible, ping timer resumed');
        }
      });
    }

    setupClickTracking() {
      document.addEventListener('click', (e) => {
        const target = e.target;
        
        const elementInfo = {
          tag: target.tagName.toLowerCase(),
          id: target.id || null,
          class: target.className || null,
          text: target.innerText?.substring(0, 100) || null,
          href: target.href || null
        };

        if (target.tagName === 'BUTTON' || target.closest('button')) {
          this.eventTracker.send('button_click', {
            ...elementInfo,
            button_type: target.type || 'button'
          });
          this.logger.log('Button click tracked:', elementInfo);
        }
        
        else if (target.tagName === 'A' || target.closest('a')) {
          this.eventTracker.send('custom_event', {
            event_name: 'link_click',
            ...elementInfo,
            external: target.hostname !== window.location.hostname
          });
          this.logger.log('Link click tracked:', elementInfo);
        }
        
        else if (target.tagName === 'INPUT' && target.type === 'submit') {
          this.eventTracker.send('form_submit', {
            ...elementInfo,
            form_id: target.form?.id || null,
            form_name: target.form?.name || null
          });
          this.logger.log('Form submit tracked:', elementInfo);
        }
      }, true);

      this.logger.log('Automatic click tracking enabled');
    }

    setupNavigationListeners() {
      this.state.set('lastPath', window.location.pathname);

      const checkPathChange = () => {
        const currentPath = window.location.pathname;
        const lastPath = this.state.get('lastPath');
        
        if (currentPath !== lastPath) {
          this.pageViewTracker.track(currentPath);
        }
      };

      window.addEventListener('popstate', checkPathChange);

      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      history.pushState = function() {
        originalPushState.apply(this, arguments);
        checkPathChange();
      };

      history.replaceState = function() {
        originalReplaceState.apply(this, arguments);
        checkPathChange();
      };

      this.logger.log('SPA navigation tracking enabled');
    }
  }

  class CarbonCutSDK {
    constructor() {
      this.logger = new Logger(false);
      this.config = new Config();
      this.state = new State();
      this.session = null;
      this.transport = null;
      this.eventTracker = null;
      this.pingTracker = null;
      this.pageViewTracker = null;
      this.browserListeners = null;
      this.autoInitAttempted = false;
      this.conversionRules = [];
    }

    /**
     * Normalize domain by removing trailing slashes and converting to lowercase
     * @param {string} domain Domain to normalize
     * @returns {string} Normalized domain
     */
    normalizeDomain(domain) {
      if (!domain) return '';
      return domain.toLowerCase().replace(/\/+$/, ''); // Remove trailing slashes
    }

    getScriptConfig() {
      if (typeof document === "undefined") return null;

      const scripts = document.getElementsByTagName("script");
      let scriptConfig = null;

      for (let script of scripts) {
        const src = script.getAttribute("src");

        if (
          src &&
          (src.includes("carboncut.min.js") || src.includes("carboncut.js"))
        ) {
          let apiUrl =
            script.getAttribute("data-api-url") ||
            "http://127.0.0.1:8000/api/v1/events/";

          if (!apiUrl.endsWith("/")) {
            apiUrl += "/";
          }

          scriptConfig = {
            trackerToken:
              script.getAttribute("data-token") ||
              script.getAttribute("data-tracker-token"),
            apiUrl: apiUrl,
            debug: script.getAttribute("data-debug") === "true",
            domain: script.getAttribute("data-domain") || window.location.origin,
            useWorker: script.getAttribute("data-use-worker") !== "false",
            //   Geolocation options from script tag
            enableGeolocation: script.getAttribute("data-enable-geolocation") === "true",
            requestLocation: script.getAttribute("data-request-location") === "true",
            //   Read new prompt option from script tag
            promptForLocationOnLoad: script.getAttribute("data-prompt-for-location-on-load") !== "false",
          };
          break;
        }
      }

      return scriptConfig;
    }

    async fetchConversionRules() {
      const apiUrl = this.config.get("apiUrl");
      const trackerToken = this.config.get("trackerToken");

      if (!trackerToken) {
        this.logger.error(
          "Tracker token is missing. Cannot fetch conversion rules."
        );
        return false;
      }

      try {
        const configUrl = `${apiUrl.replace(
        "/events/",
        "/keys/config"
      )}?api_key=${trackerToken}`;

        this.logger.log("Fetching conversion rules from:", configUrl);

        const response = await fetch(configUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to fetch conversion rules: ${response.status} ${response.statusText}`
          );
        }

        const data = await response.json();

        if (!data.success) {
          this.logger.error("Invalid API key:", trackerToken);
          return false;
        }

        // Validate domain from API response
        const currentDomain = this.normalizeDomain(window.location.origin);
        const configuredDomain = this.normalizeDomain(data.domain);

        this.logger.log("🔍 Domain validation:");
        this.logger.log("   - Current domain:", currentDomain);
        this.logger.log("   - Configured domain:", configuredDomain);

        // Allow wildcard (*) to match any domain
        if (configuredDomain && configuredDomain !== '*' && configuredDomain !== currentDomain) {
          this.logger.error(
            `❌ Invalid domain. Configured domain (${configuredDomain}) does not match the current domain (${currentDomain}).`
          );
          return false;
        }

        if (configuredDomain === '*') {
          this.logger.log("Wildcard domain (*) - allowing all domains");
        } else {
          this.logger.log("Domain validation passed");
        }

        this.conversionRules = data.conversion_rules || [];
        this.config.set("conversionRules", this.conversionRules);
        this.logger.log("Fetched conversion rules:", this.conversionRules);

        if (this.eventTracker && this.conversionRules.length > 0) {
          this.eventTracker.applyConversionRules();
        }

        return true;
      } catch (error) {
        this.logger.error("Error fetching conversion rules:", error);
        return false;
      }
    }

    autoInit() {
      if (this.autoInitAttempted || this.isInitializing) {
        this.logger.warn("Auto-init already attempted or in progress");
        return;
      }

      this.autoInitAttempted = true;
      this.isInitializing = true;

      const scriptConfig = this.getScriptConfig();

      if (!scriptConfig || !scriptConfig.trackerToken) {
        console.error(
          "CarbonCut: No tracker token found. Add data-token attribute to script tag."
        );
        this.isInitializing = false;
        return;
      }

      this.init(scriptConfig);
      this.isInitializing = false;
    }

    async init(options = {}) {
      if (!isBrowser()) {
        this.logger.error(
          "CarbonCut SDK can only be initialized in a browser environment"
        );
        return false;
      }

      if (this.state.get("isInitialized")) {
        this.logger.warn("CarbonCut is already initialized");
        return false;
      }

      if (!this.config.init(options)) {
        return false;
      }

      this.logger.setDebug(this.config.get("debug"));

      if (
        this.config.get("respectDoNotTrack") &&
        navigator.doNotTrack === "1"
      ) {
        this.logger.warn("Do Not Track is enabled, tracking disabled");
        return false;
      }

      // Validate API key and domain
      const isValidApiKey = await this.fetchConversionRules();
      if (!isValidApiKey) {
        this.logger.error("Initialization aborted due to invalid API key or domain.");
        return false;
      }

      this.session = new Session(this.config, this.logger);

      const useWorker = this.config.get("useWorker") !== false;

      if (useWorker && typeof Worker !== "undefined") {
        this.transport = new ApiWorkerTransport(this.config, this.logger);
        this.logger.log("Using Web Worker for v2 event processing");
      } else {
        this.transport = new ApiTransport(this.config, this.logger);
        this.logger.log("Using main thread for v2 event processing");
      }

      this.eventTracker = new EventTracker(
        this.config,
        this.session,
        this.transport,
        this.logger
      );
      this.pingTracker = new PingTracker(
        this.config,
        this.state,
        this.eventTracker,
        this.logger
      );
      this.pageViewTracker = new PageViewTracker(
        this.config,
        this.state,
        this.eventTracker,
        this.logger
      );
      this.browserListeners = new BrowserListeners(
        this.config,
        this.state,
        this.session,
        this.eventTracker,
        this.pingTracker,
        this.pageViewTracker,
        this.logger
      );

      this.session.start();
      this.pingTracker.start();
      this.browserListeners.setup();
      this.state.set("isInitialized", true);

      this.logger.log("CarbonCut SDK v2 initialized successfully", {
        sessionId: this.session.getId(),
        trackerToken: this.config.get("trackerToken"),
        workerEnabled: useWorker,
        apiVersion: "v2",
      });

      //   UPDATED: Request location BEFORE sending session_start
      if (this.config.get("promptForLocationOnLoad")) {
        this.logger.log("📍 SDK: `promptForLocationOnLoad` is true, requesting location...");
        
        // Set enableGeolocation to true so data is included in events
        this.config.set("enableGeolocation", true);
        
        try {
          const location = await Promise.race([
            this.eventTracker.requestUserLocation(),
            new Promise(resolve => setTimeout(() => resolve(null), 5000)) 
          ]);
          
          if (location) {
            this.logger.log("  SDK: Initial geolocation obtained on load:", {
              latitude: location.latitude.toFixed(6),
              longitude: location.longitude.toFixed(6),
              accuracy: `${Math.round(location.accuracy)}m`
            });
          } else {
            this.logger.warn("⚠️ SDK: Geolocation timeout or denied, proceeding without location");
          }
        } catch (error) {
          this.logger.error("❌ SDK: Error getting location:", error);
        }
      }

      //   Send session_start AFTER geolocation attempt
      await this.eventTracker.send("session_start", getBrowserMetadata());

      return true;
    }

    trackEvent(eventName, data = {}) {
      if (!this.state.get("isInitialized")) {
        this.logger.error("SDK not initialized. Call init() first");
        return;
      }

      this.eventTracker.trackCustomEvent(eventName, data);
    }

    trackPageView(pagePath) {
      if (!this.state.get("isInitialized")) {
        this.logger.error("SDK not initialized. Call init() first");
        return;
      }

      this.pageViewTracker.track(pagePath);
    }

    ping() {
      if (!this.state.get("isInitialized")) {
        this.logger.error("SDK not initialized. Call init() first");
        return;
      }

      this.pingTracker.trigger();
    }

    /**
     *   NEW: Request user location manually (for consent-based flows)
     */
    async requestLocation() {
      if (!this.state.get("isInitialized")) {
        this.logger.error("SDK not initialized. Call init() first");
        return null;
      }

      this.logger.log("📍 SDK: Manually requesting user location");
      
      //   Log geolocation config
      this.logger.log('📍 SDK: Current geolocation settings:', {
        enabled: this.config.get('enableGeolocation'),
        requestLocation: this.config.get('requestLocation'),
        timeout: this.config.get('geolocationTimeout'),
        highAccuracy: this.config.get('geolocationHighAccuracy')
      });
      
      const location = await this.eventTracker.requestUserLocation();
      
      if (location) {
        this.logger.log('  SDK: Location obtained successfully');
      } else {
        this.logger.warn('⚠️ SDK: Failed to obtain location');
      }
      
      return location;
    }

    /**
     *   UPDATED: Enable geolocation tracking and request location immediately
     */
    async enableGeolocation() {
      this.config.set("enableGeolocation", true);
      this.logger.log("  SDK: Geolocation tracking enabled");
      
      //   Automatically request location when enabled
      if (this.state.get("isInitialized") && this.eventTracker) {
        this.logger.log("📍 SDK: Auto-requesting location after enabling geolocation");
        const location = await this.eventTracker.requestUserLocation();
        
        if (location) {
          this.logger.log("  SDK: Geolocation obtained and cached:", {
            latitude: location.latitude.toFixed(6),
            longitude: location.longitude.toFixed(6),
            accuracy: `${Math.round(location.accuracy)}m`
          });
        }
        
        return location;
      }
      
      return null;
    }

    /**
     *   NEW: Disable geolocation tracking
     */
    disableGeolocation() {
      this.config.set("enableGeolocation", false);
      this.eventTracker?.clearLocationCache();
      this.logger.log("🚫 SDK: Geolocation tracking disabled");
    }

    /**
     *   NEW: Get geolocation status
     */
    getGeolocationStatus() {
      if (!this.eventTracker?.geolocationManager) {
        return { enabled: false, reason: 'SDK not initialized' };
      }

      const status = {
        enabled: this.config.get('enableGeolocation'),
        requestLocation: this.config.get('requestLocation'),
        cacheStatus: this.eventTracker.geolocationManager.getCacheStatus(),
        config: {
          timeout: this.config.get('geolocationTimeout'),
          highAccuracy: this.config.get('geolocationHighAccuracy')
        }
      };

      this.logger.log('📍 Geolocation status:', status);
      return status;
    }

    getSessionInfo() {
      return {
        sessionId: this.session?.getId() || null,
        trackerToken: this.config.get("trackerToken"),
        timeSpent: this.state.get("timeSpent"),
        isInitialized: this.state.get("isInitialized"),
        queueSize: this.transport?.getQueueSize() || 0,
        apiVersion: "v2",
        utmParams: this.eventTracker?.utmParams || null,
        conversionRules: this.conversionRules,
        //   NEW: Geolocation status
        geolocationEnabled: this.config.get("enableGeolocation"),
      };
    }

    enableDebug() {
      this.logger.setDebug(true);
      this.config.set("debug", true);
    }

    disableDebug() {
      this.logger.setDebug(false);
      this.config.set("debug", false);
    }

    destroy() {
      this.pingTracker?.stop();
      this.transport?.terminate?.();
      this.session?.end();
      this.state.reset();
      this.logger.log("SDK destroyed");
    }
  }

  const carbonCut = new CarbonCutSDK();

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          carbonCut.autoInit();
        },
        { once: true }
      );
    } else {
      carbonCut.autoInit();
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = carbonCut;
  }

  if (typeof window !== "undefined") {
    window.CarbonCut = carbonCut;
  }

  return carbonCut;

})();
//# sourceMappingURL=carboncut.js.map
