// ==================== Logger Class ====================
class Logger {
    constructor() {
        this.instanceId = process.env.INSTANCE_ID || 'unknown';
        this.logLevels = {
            DEBUG: 0,
            INFO: 1,
            WARN: 2,
            ERROR: 3
        };
        this.currentLevel = this._getCurrentLogLevel();
    }

    // ==================== Configuration ====================
    _getCurrentLogLevel() {
        const envLevel = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
        return this.logLevels[envLevel] || this.logLevels.INFO;
    }

    _shouldLog(level) {
        return this.logLevels[level.toUpperCase()] >= this.currentLevel;
    }

    // ==================== Message Formatting ====================
    formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${this.instanceId}] [${level.toUpperCase()}]`;

        if (data) {
            return `${prefix} ${message} ${this._formatData(data)}`;
        }
        return `${prefix} ${message}`;
    }

    _formatData(data) {
        try {
            if (typeof data === 'object') {
                return JSON.stringify(data, null, 2);
            }
            return String(data);
        } catch (error) {
            return '[Unserializable Data]';
        }
    }

    // ==================== Logging Methods ====================
    debug(message, data = null) {
        if (this._shouldLog('DEBUG')) {
            console.log(this.formatMessage('debug', message, data));
        }
    }

    info(message, data = null) {
        if (this._shouldLog('INFO')) {
            console.log(this.formatMessage('info', message, data));
        }
    }

    warn(message, data = null) {
        if (this._shouldLog('WARN')) {
            console.warn(this.formatMessage('warn', message, data));
        }
    }

    error(message, data = null) {
        if (this._shouldLog('ERROR')) {
            console.error(this.formatMessage('error', message, data));
        }
    }

    // ==================== Specialized Logging Methods ====================
    performance(operation, duration, data = null) {
        this.info(`⏱️ ${operation} completed in ${duration}ms`, data);
    }

    network(method, url, status, duration, data = null) {
        const message = `🌐 ${method} ${url} - ${status} (${duration}ms)`;
        if (status >= 400) {
            this.error(message, data);
        } else {
            this.info(message, data);
        }
    }

    cluster(clusterId, message, data = null) {
        this.info(`🔗 [Cluster ${clusterId}] ${message}`, data);
    }
}

// ==================== Export ====================
export const logger = new Logger();