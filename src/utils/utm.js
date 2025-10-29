/**
 * Extract UTM parameters from URL or provide defaults
 * @returns {Object} UTM parameters object
 */
export function getUTMParams() {
  if (typeof window === 'undefined') {
    return getDefaultUTMParams();
  }

  const urlParams = new URLSearchParams(window.location.search);
  
  return {
    utm_campaign: urlParams.get('utm_campaign') || getSessionStorage('utm_campaign') || '',
    utm_source: urlParams.get('utm_source') || getSessionStorage('utm_source') || '',
    utm_medium: urlParams.get('utm_medium') || getSessionStorage('utm_medium') || '',
    utm_term: urlParams.get('utm_term') || getSessionStorage('utm_term') || '',
    utm_content: urlParams.get('utm_content') || getSessionStorage('utm_content') || ''
  };
}

/**
 * Store UTM parameters in session storage for persistence
 * @param {Object} utmParams UTM parameters
 */
export function storeUTMParams(utmParams) {
  if (typeof window === 'undefined') return;

  Object.entries(utmParams).forEach(([key, value]) => {
    if (value && value !== 'direct' && value !== 'none') {
      try {
        sessionStorage.setItem(key, value);
      } catch (e) {
        // Silent fail if sessionStorage is not available
      }
    }
  });
}

/**
 * Get UTM parameter from session storage
 * @param {string} key Parameter key
 * @returns {string|null} Parameter value
 */
function getSessionStorage(key) {
  if (typeof window === 'undefined') return null;
  
  try {
    return sessionStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

/**
 * Get default UTM parameters for server-side or fallback
 * @returns {Object} Default UTM parameters
 */
function getDefaultUTMParams() {
  return {
    utm_campaign: '',
    utm_source: '',
    utm_medium: '',
    utm_term: '',
    utm_content: ''
  };
}

/**
 * Generate unique event ID
 * @returns {string} Unique event ID
 */
export function generateEventId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  return 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}