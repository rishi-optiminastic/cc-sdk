/**
 * Calculate bytes transferred for navigation and resources
 */
export class PerformanceMonitor {
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