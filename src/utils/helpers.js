
export function getTrackerFromURL() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('cc_tracker');
}


export function getBrowserMetadata() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {};
  }

  return {
    user_agent: navigator.userAgent,
    screen_resolution: `${window.screen.width}x${window.screen.height}`,
    viewport_size: `${window.innerWidth}x${window.innerHeight}`,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    referrer: document.referrer || 'direct',
    page_url: window.location.href,
    page_title: document.title
  };
}


export function getPageInfo() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {};
  }

  return {
    page_path: window.location.pathname,
    page_url: window.location.href,
    page_title: document.title,
    referrer: document.referrer
  };
}


export function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
