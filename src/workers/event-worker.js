

let config = null;
let eventQueue = [];
let flushTimer = null;
let isOnline = true;

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      handleInit(payload);
      break;
    
    case 'TRACK_EVENT':
      handleTrackEvent(payload);
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
      self.postMessage({
        type: 'QUEUE_SIZE',
        size: eventQueue.length
      });
      break;
  }
});


function handleInit(payload) {
  config = payload;
  
 
  if (config.batchInterval) {
    flushTimer = setInterval(() => {
      if (eventQueue.length > 0) {
        flushQueue();
      }
    }, config.batchInterval);
  }
  
  self.postMessage({
    type: 'INIT_SUCCESS',
    message: 'Worker initialized'
  });
}


function handleTrackEvent(payload) {
  eventQueue.push({
    ...payload,
    queuedAt: Date.now()
  });
  
 
  if (eventQueue.length >= (config.batchSize || 10)) {
    flushQueue();
  }
}


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
      body: JSON.stringify({
        events: batch,
        batch: true
      }),
      keepalive: true
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    self.postMessage({
      type: 'FLUSH_SUCCESS',
      count: batch.length
    });
    
  } catch (error) {
   
    eventQueue.push(...batch);
    
    self.postMessage({
      type: 'FLUSH_ERROR',
      error: error.message,
      count: batch.length
    });
  }
}


function calculateMetrics(events) {
 
  return {
    totalEvents: events.length,
    eventTypes: events.reduce((acc, e) => {
      acc[e.event] = (acc[e.event] || 0) + 1;
      return acc;
    }, {}),
    timeRange: {
      start: Math.min(...events.map(e => e.timestamp)),
      end: Math.max(...events.map(e => e.timestamp))
    }
  };
}