import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

// ==================== Constants ====================
const FILES = {
    QUEUE: "fingerprint_queue.json",
    STATS: "fingerprint_stats.json"
};

const FINGERPRINT_CONFIG = {
    OS_VERSION: '10',
    DEVICE_TYPE: 'desktop',
    OS_TYPE: 'windows',
    BROWSER: 'chrome'
};

// ==================== FingerprintManager Class ====================
export default class FingerprintManager {
    constructor(kameleoClient) {
        this.client = kameleoClient;
        this.queue = [];
        this.currentIndex = 0;
        this.stats = {};
    }

    // ==================== State Management ====================
    async loadState() {
        try {
            await Promise.all([
                this._loadQueue(),
                this._loadStats()
            ]);

            console.log(`📊 Loaded ${this.queue.length} fingerprints, current index: ${this.currentIndex}`);
            
        } catch (err) {
            console.log("Error loading fingerprint state:", err.message);
            await this.initializeQueue();
        }
    }

    async _loadQueue() {
        if (fsSync.existsSync(FILES.QUEUE)) {
            const queueData = await fs.readFile(FILES.QUEUE, "utf8");
            const parsed = JSON.parse(queueData);
            this.queue = parsed.queue || [];
            this.currentIndex = parsed.currentIndex || 0;
        }
    }

    async _loadStats() {
        if (fsSync.existsSync(FILES.STATS)) {
            const statsData = await fs.readFile(FILES.STATS, "utf8");
            this.stats = JSON.parse(statsData);
        }
    }

    async saveState() {
        try {
            const queueData = {
                queue: this.queue,
                currentIndex: this.currentIndex,
                lastUpdated: new Date().toISOString()
            };

            await Promise.all([
                fs.writeFile(FILES.QUEUE, JSON.stringify(queueData, null, 2), "utf8"),
                fs.writeFile(FILES.STATS, JSON.stringify(this.stats, null, 2), "utf8")
            ]);

        } catch (err) {
            console.log("Error saving fingerprint state:", err.message);
        }
    }

    // ==================== Queue Initialization ====================
    async initializeQueue() {
        try {
            console.log("🔄 Initializing fingerprint queue...");
            
            const fingerprints = await this._fetchFingerprints();
            const filteredFingerprints = this._filterFingerprints(fingerprints);
            
            this.queue = this._shuffleArray([...filteredFingerprints]);
            this.currentIndex = 0;
            this.stats = {};

            this._initializeStats();
            await this.saveState();
            
            console.log(`✅ Initialized queue with ${this.queue.length} fingerprints`);

        } catch (err) {
            console.log("Error initializing fingerprint queue:", err.message);
            throw err;
        }
    }

    async _fetchFingerprints() {
        return await this.client.fingerprint.searchFingerprints(
            FINGERPRINT_CONFIG.DEVICE_TYPE,
            FINGERPRINT_CONFIG.OS_TYPE,
            FINGERPRINT_CONFIG.BROWSER
        );
    }

    _filterFingerprints(fingerprints) {
        return fingerprints.filter(item => item.os.version === FINGERPRINT_CONFIG.OS_VERSION);
    }

    _initializeStats() {
        this.queue.forEach(fp => {
            this.stats[fp.id] = {
                usageCount: 0,
                lastUsed: null,
                fingerprintInfo: {
                    userAgent: fp.userAgent,
                    screen: fp.screen,
                    language: fp.language
                }
            };
        });
    }

    // ==================== Utility Methods ====================
    _shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // ==================== Main Queue Operations ====================
    async getNextFingerprint() {
        try {
            await this.loadState();

            if (this.queue.length === 0) {
                await this.initializeQueue();
            }

            this._handleQueueRotation();
            
            const selectedFingerprint = this.queue[this.currentIndex];
            this._updateFingerprintStats(selectedFingerprint);
            
            this.currentIndex++;
            await this.saveState();

            this._logFingerprintSelection(selectedFingerprint);
            return selectedFingerprint;

        } catch (err) {
            console.log("Error getting next fingerprint:", err.message);
            throw err;
        }
    }

    _handleQueueRotation() {
        if (this.currentIndex >= this.queue.length) {
            console.log("🔄 Reached end of queue, restarting from beginning...");
            this.currentIndex = 0;
            
            this.queue = this._shuffleArray(this.queue);
            console.log("🔀 Queue reshuffled for next round");
        }
    }

    _updateFingerprintStats(fingerprint) {
        this.stats[fingerprint.id].usageCount++;
        this.stats[fingerprint.id].lastUsed = new Date().toISOString();
    }

    _logFingerprintSelection(fingerprint) {
        console.log(`🎯 Selected fingerprint ${this.currentIndex}/${this.queue.length}: ${fingerprint.id}`);
        console.log(`📊 Usage count: ${this.stats[fingerprint.id].usageCount}`);
    }

    // ==================== Statistics and Management ====================
    async showStats() {
        await this.loadState();
        
        console.log("\n📊 Fingerprint Usage Statistics:");
        console.log("=".repeat(50));

        const sortedStats = this._getSortedStats();
        this._displayStatsTable(sortedStats);
        this._displayStatsSummary(sortedStats);
    }

    _getSortedStats() {
        return Object.entries(this.stats)
            .sort(([,a], [,b]) => b.usageCount - a.usageCount);
    }

    _displayStatsTable(sortedStats) {
        sortedStats.forEach(([fingerprintId, stats], index) => {
            const lastUsed = stats.lastUsed ? 
                new Date(stats.lastUsed).toLocaleString('fa-IR') : 
                'Never';
            
            console.log(`${index + 1}. ID: ${fingerprintId.substring(0, 8)}... | Uses: ${stats.usageCount} | Last: ${lastUsed}`);
        });
    }

    _displayStatsSummary(sortedStats) {
        const totalUsage = sortedStats.reduce((sum, [,stats]) => sum + stats.usageCount, 0);
        const avgUsage = totalUsage / sortedStats.length;
        
        console.log("=".repeat(50));
        console.log(`Total fingerprints: ${sortedStats.length}`);
        console.log(`Total usage: ${totalUsage}`);
        console.log(`Average usage per fingerprint: ${avgUsage.toFixed(2)}`);
        console.log(`Current queue position: ${this.currentIndex}/${this.queue.length}`);
    }

    async resetStats() {
        try {
            this._resetAllStats();
            this.currentIndex = 0;
            this.queue = this._shuffleArray(this.queue);

            await this.saveState();
            console.log("✅ Fingerprint stats reset successfully");

        } catch (err) {
            console.log("Error resetting stats:", err.message);
        }
    }

    _resetAllStats() {
        Object.keys(this.stats).forEach(fpId => {
            this.stats[fpId].usageCount = 0;
            this.stats[fpId].lastUsed = null;
        });
    }

    async checkBalance() {
        await this.loadState();
        
        const balanceInfo = this._calculateBalance();
        this._displayBalanceInfo(balanceInfo);
        
        return balanceInfo;
    }

    _calculateBalance() {
        const usageCounts = Object.values(this.stats).map(s => s.usageCount);
        const minUsage = Math.min(...usageCounts);
        const maxUsage = Math.max(...usageCounts);
        const difference = maxUsage - minUsage;

        return { 
            minUsage, 
            maxUsage, 
            difference, 
            isBalanced: difference <= 1 
        };
    }

    _displayBalanceInfo({ minUsage, maxUsage, difference, isBalanced }) {
        console.log(`⚖️ Usage balance: Min=${minUsage}, Max=${maxUsage}, Difference=${difference}`);
        
        if (isBalanced) {
            console.log("✅ Perfect balance achieved!");
        } else if (difference <= 3) {
            console.log("✅ Good balance");
        } else {
            console.log("⚠️ Imbalanced usage detected");
        }
    }
}