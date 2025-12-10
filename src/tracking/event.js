import { getUTMParams, storeUTMParams, generateEventId } from "../utils/utm.js";
import { PerformanceMonitor } from "../utils/performance.js";
import { GeolocationManager } from "../utils/geolocation.js";

export class EventTracker {
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
