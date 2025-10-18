
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
      
      this.logger.log('Web Worker initialized for event processing');
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
          const response = await fetch(config.apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Tracker-Token': config.trackerToken
            },
            body: JSON.stringify({ events: batch, batch: true }),
            keepalive: true
          });
          
          if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
          
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
        this.logger.log('Worker ready');
        break;
      
      case 'FLUSH_SUCCESS':
        this.logger.log(`Worker flushed ${count} events`);
        break;
      
      case 'FLUSH_ERROR':
        this.logger.error(`Worker flush failed: ${error}`);
        break;
      
      case 'QUEUE_SIZE':
        this.queueSize = size;
        break;
    }
  }

  
  setupOnlineListener() {
    window.addEventListener('online', () => {
      this.worker?.postMessage({ type: 'ONLINE' });
    });

    window.addEventListener('offline', () => {
      this.worker?.postMessage({ type: 'OFFLINE' });
    });
  }

  
  async send(payload) {
    if (!this.worker) {
     
      return this.sendDirect(payload);
    }
    
    this.worker.postMessage({
      type: 'TRACK_EVENT',
      payload
    });
    
    return true;
  }

  
  async sendDirect(payload) {
    try {
      const response = await fetch(this.config.get('apiUrl'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tracker-Token': this.config.get('trackerToken')
        },
        body: JSON.stringify(payload),
        keepalive: true
      });
      
      return response.ok;
    } catch (error) {
      this.logger.error('Direct send failed:', error);
      return false;
    }
  }

  
  async flushQueue() {
    this.worker?.postMessage({ type: 'FLUSH_QUEUE' });
  }

  
  getQueueSize() {
    if (!this.worker) return 0;
    
    this.worker.postMessage({ type: 'GET_QUEUE_SIZE' });
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