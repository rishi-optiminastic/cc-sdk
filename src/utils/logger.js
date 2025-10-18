
export class Logger {
  constructor(debug = false) {
    this.debug = debug;
    this.prefix = 'CarbonCut:';
  }

  setDebug(debug) {
    this.debug = debug;
  }

  log(...args) {
    if (this.debug) {
      console.log(this.prefix, ...args);
    }
  }

  warn(...args) {
    if (this.debug) {
      console.warn(this.prefix, ...args);
    }
  }

  error(...args) {
    console.error(this.prefix, ...args);
  }

  info(...args) {
    if (this.debug) {
      console.info(this.prefix, ...args);
    }
  }
}