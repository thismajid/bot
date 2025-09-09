// utils/logger.js
class Logger {
    constructor() {
        this.instanceId = process.env.INSTANCE_ID || 'unknown';
    }

    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${this.instanceId}] [${level.toUpperCase()}]`;

        if (data) {
            return `${prefix} ${message} ${JSON.stringify(data)}`;
        }
        return `${prefix} ${message}`;
    }

    info(message, data = null) {
        console.log(this.formatMessage('info', message, data));
    }

    warn(message, data = null) {
        console.warn(this.formatMessage('warn', message, data));
    }

    error(message, data = null) {
        console.error(this.formatMessage('error', message, data));
    }

    debug(message, data = null) {
        if (process.env.NODE_ENV !== 'production') {
            console.log(this.formatMessage('debug', message, data));
        }
    }
}

export const logger = new Logger();