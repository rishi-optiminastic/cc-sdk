
export class PingTracker {
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