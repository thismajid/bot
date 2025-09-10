import { manageFingerprintQueue } from './bot.js';

const command = process.argv[2];

if (!command) {
    console.log("Usage: node fingerprint-manager.js <command>");
    console.log("Commands:");
    console.log("  stats   - Show usage statistics");
    console.log("  balance - Check usage balance");
    console.log("  reset   - Reset all statistics");
    console.log("  init    - Reinitialize queue");
    process.exit(1);
}

manageFingerprintQueue(command).then(() => {
    console.log("✅ Command completed");
    process.exit(0);
}).catch(err => {
    console.error("❌ Error:", err.message);
    process.exit(1);
});