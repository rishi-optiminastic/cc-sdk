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
        // Get base URL from data attribute
        let apiUrl =
          script.getAttribute("data-api-url") ||
          "http://127.0.0.1:8000/api/v1/events/";

        // Ensure trailing slash
        if (!apiUrl.endsWith("/")) {
          apiUrl += "/";
        }

        scriptConfig = {
          trackerToken:
            script.getAttribute("data-token") ||
            script.getAttribute("data-tracker-token"),
          apiUrl: apiUrl,
          debug: script.getAttribute("data-debug") === "true",
          domain: script.getAttribute("data-domain") || window.location.origin, // Default to current domain
          useWorker: script.getAttribute("data-use-worker") !== "false",
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
      return;
    }

    try {
      // Fix: Use correct endpoint path
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

      if (data.success) {
        this.conversionRules = data.conversion_rules || [];
        this.config.set("conversionRules", this.conversionRules);
        this.logger.log("✅ Fetched conversion rules:", this.conversionRules);

        // Apply rules after fetching
        if (this.eventTracker && this.conversionRules.length > 0) {
          this.eventTracker.applyConversionRules();
        }
      } else {
        this.logger.warn("Failed to fetch conversion rules:", data.error);
      }
    } catch (error) {
      this.logger.error("Error fetching conversion rules:", error);
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

    // Validate domain before initialization
    const currentDomain = window.location.origin; // Get the current domain (protocol + hostname + port)
    const configuredDomain = scriptConfig.domain;

    if (configuredDomain && configuredDomain !== currentDomain) {
      console.error(
        `CarbonCut: Invalid domain. Configured domain (${configuredDomain}) does not match the current domain (${currentDomain}).`
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

    if (this.config.get("respectDoNotTrack") && navigator.doNotTrack === "1") {
      this.logger.warn("Do Not Track is enabled, tracking disabled");
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
    this.eventTracker.send("session_start", getBrowserMetadata());
    this.pingTracker.start();
    this.browserListeners.setup();
    this.state.set("isInitialized", true);

    this.logger.log("CarbonCut SDK v2 initialized successfully", {
      sessionId: this.session.getId(),
      trackerToken: this.config.get("trackerToken"),
      workerEnabled: useWorker,
      apiVersion: "v2",
    });

    // ✅ FETCH AND APPLY CONVERSION RULES AFTER INITIALIZATION
    await this.fetchConversionRules();

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

  getSessionInfo() {
    return {
      sessionId: this.session?.getId() || null,
      trackerToken: this.config.get("trackerToken"),
      timeSpent: this.state.get("timeSpent"),
      isInitialized: this.state.get("isInitialized"),
      queueSize: this.transport?.getQueueSize() || 0,
      apiVersion: "v2",
      utmParams: this.eventTracker?.utmParams || null,
      conversionRules: this.conversionRules, // Add conversion rules to session info
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
