import os from "os";

// ==================== Network Utilities ====================
function getServerIP() {
    const nets = os.networkInterfaces();
    
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === "IPv4" && !net.internal) {
                return net.address.replace(/\./g, "-");
            }
        }
    }
    return "unknown";
}

function generateInstanceId() {
    const serverIP = getServerIP();
    const randomSuffix = Math.random().toString(36).substr(2, 4);
    return `psn-instance-${serverIP}-${randomSuffix}`;
}

// ==================== Environment Helpers ====================
function getEnvNumber(key, defaultValue) {
    const value = process.env[key];
    return value ? parseInt(value, 10) : defaultValue;
}

function getEnvString(key, defaultValue) {
    return process.env[key] || defaultValue;
}

function getEnvBoolean(key, defaultValue) {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true';
}

// ==================== Configuration Object ====================
const SERVER_IP = getServerIP();

export const config = {
    // ==================== Instance Configuration ====================
    INSTANCE_ID: getEnvString('INSTANCE_ID', generateInstanceId()),
    SERVER_IP: SERVER_IP,
    HOSTNAME: os.hostname(),
    NODE_ENV: getEnvString('NODE_ENV', 'production'),

    // ==================== Server Configuration ====================
    SERVER_WS_URL: getEnvString('SERVER_WS_URL', "wss://blinto.sbs"),

    // ==================== Processing Configuration ====================
    BATCH_SIZE: getEnvNumber('BATCH_SIZE', 3),
    MAX_CONCURRENCY: getEnvNumber('MAX_CONCURRENCY', 1),
    MAX_CONCURRENT_BROWSERS: getEnvNumber('MAX_CONCURRENT_BROWSERS', 10),

    // ==================== Timing Configuration ====================
    HEARTBEAT_INTERVAL: getEnvNumber('HEARTBEAT_INTERVAL', 30000), // 30 seconds
    PROCESSING_TIMEOUT: getEnvNumber('PROCESSING_TIMEOUT', 300000), // 5 minutes
    
    // ==================== Feature Flags ====================
    ENABLE_DEBUG_MODE: getEnvBoolean('ENABLE_DEBUG_MODE', false),
    ENABLE_PERFORMANCE_LOGGING: getEnvBoolean('ENABLE_PERFORMANCE_LOGGING', true),
    ENABLE_CLUSTER_CLEANUP: getEnvBoolean('ENABLE_CLUSTER_CLEANUP', true),

    // ==================== Validation ====================
    validate() {
        const errors = [];

        if (this.BATCH_SIZE <= 0) {
            errors.push('BATCH_SIZE must be greater than 0');
        }

        if (this.MAX_CONCURRENT_BROWSERS <= 0) {
            errors.push('MAX_CONCURRENT_BROWSERS must be greater than 0');
        }

        if (this.HEARTBEAT_INTERVAL < 1000) {
            errors.push('HEARTBEAT_INTERVAL must be at least 1000ms');
        }

        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }

        return true;
    },

    // ==================== Display Configuration ====================
    display() {
        console.log('📋 Configuration:');
        console.log(`   Instance ID: ${this.INSTANCE_ID}`);
        console.log(`   Server IP: ${this.SERVER_IP}`);
        console.log(`   Hostname: ${this.HOSTNAME}`);
        console.log(`   Environment: ${this.NODE_ENV}`);
        console.log(`   Max Browsers: ${this.MAX_CONCURRENT_BROWSERS}`);
        console.log(`   Batch Size: ${this.BATCH_SIZE}`);
        console.log(`   WebSocket URL: ${this.SERVER_WS_URL}`);
    }
};

// Validate configuration on import
config.validate();