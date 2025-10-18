import { getPageInfo } from '../utils/helpers.js';


export class PageViewTracker {
  constructor(config, state, eventTracker, logger) {
    this.config = config;
    this.state = state;
    this.eventTracker = eventTracker;
    this.logger = logger;
  }

  
  track(pagePath) {
    const pageInfo = getPageInfo();
    
    if (pagePath) {
      pageInfo.page_path = pagePath;
    }

    this.eventTracker.send('page_view', pageInfo);
    this.state.set('lastPath', pageInfo.page_path);
    this.logger.log('Page view tracked:', pageInfo.page_path);
  }
}