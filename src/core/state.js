
export class State {
  constructor() {
    this.state = {
      isInitialized: false,
      timeSpent: 0,
      lastPath: null,
      retryCount: 0
    };
  }

  
  get(key) {
    return this.state[key];
  }

  
  set(key, value) {
    this.state[key] = value;
  }

  
  incrementTimeSpent(seconds) {
    this.state.timeSpent += seconds;
  }

  
  reset() {
    this.state = {
      isInitialized: false,
      timeSpent: 0,
      lastPath: null,
      retryCount: 0
    };
  }

  
  getAll() {
    return { ...this.state };
  }
}