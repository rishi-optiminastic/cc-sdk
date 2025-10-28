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