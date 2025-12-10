export class ApiWorkerTransport {
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