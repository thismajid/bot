// utils/config.js
import os from "os";

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

export const config = {
    // شناسه instance
    INSTANCE_ID: process.env.INSTANCE_ID || `psn-instance-${SERVER_IP}-${Math.random().toString(36).substr(2, 4)}`,

    // آدرس سرور WebSocket
    SERVER_WS_URL: process.env.SERVER_WS_URL || "wss://blinto.sbs",

    // تنظیمات پردازش
    BATCH_SIZE: parseInt(process.env.BATCH_SIZE) || 3,
    MAX_CONCURRENCY: parseInt(process.env.MAX_CONCURRENCY) || 1,

    // تنظیمات heartbeat
    HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL) || 30000, // 30 ثانیه

    // تنظیمات timeout
    PROCESSING_TIMEOUT: parseInt(process.env.PROCESSING_TIMEOUT) || 300000, // 5 دقیقه

    // محیط اجرا
    NODE_ENV: process.env.NODE_ENV || 'production',

    // اطلاعات سرور
    SERVER_IP: SERVER_IP,
    HOSTNAME: os.hostname()
};