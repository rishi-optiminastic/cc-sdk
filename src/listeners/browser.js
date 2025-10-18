

export class BrowserListeners {
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