const os = require('os')

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

const SERVER_IP = getServerIP();
const INSTANCE_COUNT = parseInt(process.env.INSTANCE_COUNT) || 10;
const SERVER_WS_URL = process.env.SERVER_WS_URL || "wss://blinto.sbs";

const instances = [];
for (let i = 1; i <= INSTANCE_COUNT; i++) {
    instances.push({
        name: `psn-instance-${SERVER_IP}-${i}`,
        script: "./main.js",
        watch: false,
        max_restarts: 10,
        min_uptime: "30s",
        restart_delay: 5000,
        env: {
            NODE_ENV: "production",
            SERVER_WS_URL: SERVER_WS_URL,
            INSTANCE_ID: `psn-instance-${SERVER_IP}-${i}`,
            BATCH_SIZE: 3,
            HEARTBEAT_INTERVAL: 3000
        }
    });
}

module.exports = {
    apps: [...instances]
}