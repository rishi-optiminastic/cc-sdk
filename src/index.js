import { Config } from "./core/config.js";
import { State } from "./core/state.js";
import { Session } from "./core/session.js";
import { Logger } from "./utils/logger.js";
import { ApiTransport } from "./transport/api.js";
import { ApiWorkerTransport } from "./transport/api-worker.js";
import { EventTracker } from "./tracking/event.js";
import { PingTracker } from "./tracking/ping.js";
import { PageViewTracker } from "./tracking/pageview.js";
import { BrowserListeners } from "./listeners/browser.js";
import { getBrowserMetadata, isBrowser } from "./utils/helpers.js";

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

export default carbonCut;
