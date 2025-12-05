/**
 * Geolocation utility with caching and error handling
 */
export class GeolocationManager {
  constructor(logger) {
    this.logger = logger;
    this.cacheKey = 'cc_geolocation_cache';
    this.cacheExpiry = 60 * 60 * 1000; // 1 hour in milliseconds
    this.cachedLocation = null;
    this.isRequesting = false;
    
    //   Always log initialization (even without debug)
    console.log('CarbonCut: 📍 GeolocationManager initialized', {
      cacheKey: this.cacheKey,
      cacheExpiry: `${this.cacheExpiry / 1000 / 60} minutes`
    });
  }

  /**
   * Get cached location from localStorage
   */
  getCachedLocation() {
    if (typeof localStorage === 'undefined') {
      this.logger.warn('📍 localStorage not available');
      return null;
    }

    try {
      const cached = localStorage.getItem(this.cacheKey);
      
      if (!cached) {
        this.logger.log('📍 No cached location found');
        return null;
      }

      const { location, timestamp } = JSON.parse(cached);
      const now = Date.now();
      const cacheAge = Math.floor((now - timestamp) / 1000 / 60); // minutes

      //  Log cache details
      this.logger.log('📍 Cached location found:', {
        location,
        cachedAt: new Date(timestamp).toISOString(),
        ageMinutes: cacheAge,
        expiresInMinutes: Math.floor((this.cacheExpiry - (now - timestamp)) / 1000 / 60)
      });

      // Check if cache is still valid (1 hour)
      if (now - timestamp < this.cacheExpiry) {
        this.logger.log('Using cached geolocation (still valid)');
        return location;
      } else {
        this.logger.log('Geolocation cache expired, removing');
        localStorage.removeItem(this.cacheKey);
        return null;
      }
    } catch (error) {
      this.logger.error('❌ Error reading cached location:', error);
      return null;
    }
  }

  /**
   * Save location to cache
   */
  cacheLocation(location) {
    if (typeof localStorage === 'undefined') {
      this.logger.warn('📍 localStorage not available, cannot cache');
      return;
    }

    try {
      const cacheData = {
        location,
        timestamp: Date.now()
      };
      
      localStorage.setItem(this.cacheKey, JSON.stringify(cacheData));
      
      //   Log caching details
      this.logger.log('💾 Geolocation cached successfully:', {
        location,
        cachedAt: new Date(cacheData.timestamp).toISOString(),
        expiresAt: new Date(cacheData.timestamp + this.cacheExpiry).toISOString()
      });
    } catch (error) {
      this.logger.error('❌ Error caching location:', error);
    }
  }

  /**
   * Get current location with caching
   * @param {Object} options Geolocation options
   * @returns {Promise<Object|null>} Location data or null
   */
  async getCurrentLocation(options = {}) {
    //   Always log location requests
    console.log('CarbonCut: 📍 Requesting geolocation with options:', options);
    
    // Check cache first
    const cached = this.getCachedLocation();
    if (cached) {
      //   Always log cached location usage
      console.log('CarbonCut:   Using cached location:', {
        latitude: cached.latitude.toFixed(6),
        longitude: cached.longitude.toFixed(6),
        accuracy: `${Math.round(cached.accuracy)}m`
      });
      return cached;
    }

    // Prevent multiple simultaneous requests
    if (this.isRequesting) {
      console.warn('CarbonCut: ⚠️ Geolocation request already in progress');
      return null;
    }

    // Check if geolocation is supported
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      console.warn('CarbonCut: ❌ Geolocation is not supported by this browser');
      return null;
    }

    this.isRequesting = true;
    console.log('CarbonCut: 🌍 Requesting fresh geolocation from browser...');

    const defaultOptions = {
      enableHighAccuracy: false,
      timeout: 10000, // 10 seconds
      maximumAge: 0,
      ...options
    };

    try {
      const startTime = Date.now();
      
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          defaultOptions
        );
      });

      const requestDuration = Date.now() - startTime;

      const location = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
        altitude: position.coords.altitude,
        altitudeAccuracy: position.coords.altitudeAccuracy,
        heading: position.coords.heading,
        speed: position.coords.speed
      };

      //   Always log successful location retrieval
      console.log('CarbonCut:   Geolocation obtained successfully:', {
        latitude: location.latitude.toFixed(6),
        longitude: location.longitude.toFixed(6),
        accuracy: `${Math.round(location.accuracy)}m`,
        requestDuration: `${requestDuration}ms`,
        timestamp: new Date(position.timestamp).toISOString()
      });

      // Cache the location
      this.cacheLocation(location);
      this.cachedLocation = location;
      this.isRequesting = false;

      return location;

    } catch (error) {
      const requestDuration = Date.now() - startTime;
      this.isRequesting = false;

      //   Always log errors
      const errorInfo = {
        errorCode: error.code,
        errorMessage: error.message,
        requestDuration: `${requestDuration}ms`,
        timestamp: new Date().toISOString()
      };

      // Handle different error types
      switch (error.code) {
        case error.PERMISSION_DENIED:
          console.warn('CarbonCut: ❌ Geolocation permission denied by user', errorInfo);
          break;
        case error.POSITION_UNAVAILABLE:
          console.warn('CarbonCut: ❌ Geolocation position unavailable', errorInfo);
          break;
        case error.TIMEOUT:
          console.warn('CarbonCut: ⏱️ Geolocation request timed out', errorInfo);
          break;
        default:
          console.error('CarbonCut: ❌ Geolocation error:', error, errorInfo);
      }

      return null;
    }
  }

  /**
   * Clear cached location
   */
  clearCache() {
    if (typeof localStorage === 'undefined') {
      this.logger.warn('📍 localStorage not available');
      return;
    }

    try {
      const hadCache = localStorage.getItem(this.cacheKey) !== null;
      
      localStorage.removeItem(this.cacheKey);
      this.cachedLocation = null;
      
      //   Log cache clearing
      this.logger.log('🗑️ Geolocation cache cleared', {
        hadCache,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error('❌ Error clearing location cache:', error);
    }
  }

  /**
   * Check if geolocation permission is granted
   * @returns {Promise<boolean>} Permission status
   */
  async checkPermission() {
    if (typeof navigator === 'undefined' || !navigator.permissions) {
      this.logger.warn('❌ Permissions API not available');
      return false;
    }

    try {
      const result = await navigator.permissions.query({ name: 'geolocation' });
      
      //   Log permission status
      this.logger.log('🔐 Geolocation permission status:', {
        state: result.state,
        timestamp: new Date().toISOString()
      });
      
      return result.state === 'granted';
    } catch (error) {
      this.logger.error('❌ Error checking geolocation permission:', error);
      return false;
    }
  }

  /**
   *   NEW: Get current cache status
   */
  getCacheStatus() {
    if (typeof localStorage === 'undefined') {
      return { hasCache: false, reason: 'localStorage not available' };
    }

    try {
      const cached = localStorage.getItem(this.cacheKey);
      
      if (!cached) {
        return { 
          hasCache: false, 
          reason: 'No cache found' 
        };
      }

      const { location, timestamp } = JSON.parse(cached);
      const now = Date.now();
      const ageMinutes = Math.floor((now - timestamp) / 1000 / 60);
      const isValid = (now - timestamp) < this.cacheExpiry;

      const status = {
        hasCache: true,
        isValid,
        location,
        cachedAt: new Date(timestamp).toISOString(),
        ageMinutes,
        expiresInMinutes: isValid ? Math.floor((this.cacheExpiry - (now - timestamp)) / 1000 / 60) : 0
      };

      this.logger.log('📊 Cache status:', status);
      return status;
    } catch (error) {
      this.logger.error('❌ Error getting cache status:', error);
      return { hasCache: false, reason: 'Error reading cache', error: error.message };
    }
  }
}