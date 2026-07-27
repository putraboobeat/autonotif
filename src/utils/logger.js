const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const COLORS = {
  ERROR: '\x1b[31m',
  WARN: '\x1b[33m',
  INFO: '\x1b[36m',
  DEBUG: '\x1b[90m',
  RESET: '\x1b[0m',
  BOLD: '\x1b[1m',
};

const ICONS = {
  ERROR: '❌',
  WARN: '⚠️ ',
  INFO: 'ℹ️ ',
  DEBUG: '🔍',
};

class Logger {
  constructor(module = 'APP') {
    this.module = module;
    this.level = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.INFO;
    this.logFile = path.join(LOG_DIR, `app-${this._dateStamp()}.log`);
  }

  _dateStamp() {
    return new Date().toISOString().split('T')[0];
  }

  _timestamp() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
  }

  _format(level, message, data) {
    const ts = this._timestamp();
    const prefix = `[${ts}] [${level}] [${this.module}]`;
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `${prefix} ${message}${dataStr}`;
  }

  _log(level, message, data) {
    if (LOG_LEVELS[level] > this.level) return;

    const formatted = this._format(level, message, data);

    // Console output with colors
    const color = COLORS[level] || COLORS.RESET;
    const icon = ICONS[level] || '';
    console.log(`${color}${icon} ${formatted}${COLORS.RESET}`);

    // File output (no colors)
    const fileLine = `${formatted}\n`;
    try {
      // Rotate log file if date changed
      const currentFile = path.join(LOG_DIR, `app-${this._dateStamp()}.log`);
      fs.appendFileSync(currentFile, fileLine);
    } catch (err) {
      // Silently fail on log write errors
    }
  }

  error(message, data) { this._log('ERROR', message, data); }
  warn(message, data) { this._log('WARN', message, data); }
  info(message, data) { this._log('INFO', message, data); }
  debug(message, data) { this._log('DEBUG', message, data); }
}

function createLogger(module) {
  return new Logger(module);
}

module.exports = { createLogger };
