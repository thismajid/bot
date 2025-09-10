import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

const FINGERPRINT_QUEUE_FILE = "fingerprint_queue.json";
const FINGERPRINT_STATS_FILE = "fingerprint_stats.json";

// ساختار داده برای مدیریت صف فینگرپرینت‌ها
export default class FingerprintManager {
    constructor(kameleoClient) {
        this.client = kameleoClient; // اضافه کردن client به کلاس
        this.queue = [];
        this.currentIndex = 0;
        this.stats = {};
    }

    // بارگذاری وضعیت از فایل
    async loadState() {
        try {
            // بارگذاری صف
            if (fsSync.existsSync(FINGERPRINT_QUEUE_FILE)) {
                const queueData = await fs.readFile(FINGERPRINT_QUEUE_FILE, "utf8");
                const parsed = JSON.parse(queueData);
                this.queue = parsed.queue || [];
                this.currentIndex = parsed.currentIndex || 0;
            }

            // بارگذاری آمار
            if (fsSync.existsSync(FINGERPRINT_STATS_FILE)) {
                const statsData = await fs.readFile(FINGERPRINT_STATS_FILE, "utf8");
                this.stats = JSON.parse(statsData);
            }

            console.log(`📊 Loaded ${this.queue.length} fingerprints, current index: ${this.currentIndex}`);
            
        } catch (err) {
            console.log("Error loading fingerprint state:", err.message);
            await this.initializeQueue();
        }
    }

    // ذخیره وضعیت در فایل
    async saveState() {
        try {
            const queueData = {
                queue: this.queue,
                currentIndex: this.currentIndex,
                lastUpdated: new Date().toISOString()
            };

            await fs.writeFile(FINGERPRINT_QUEUE_FILE, JSON.stringify(queueData, null, 2), "utf8");
            await fs.writeFile(FINGERPRINT_STATS_FILE, JSON.stringify(this.stats, null, 2), "utf8");

        } catch (err) {
            console.log("Error saving fingerprint state:", err.message);
        }
    }

    // مقداردهی اولیه صف با فینگرپرینت‌های جدید
    async initializeQueue() {
        try {
            console.log("🔄 Initializing fingerprint queue...");
            
            // استفاده از this.client به جای client
            const fingerprints = await this.client.fingerprint.searchFingerprints("desktop", "windows", "chrome");
            const windowsFingerprints = fingerprints.filter(item => item.os.version === '10');
            
            // مخلوط کردن فینگرپرینت‌ها برای توزیع بهتر
            this.queue = this.shuffleArray([...windowsFingerprints]);
            this.currentIndex = 0;
            this.stats = {};

            // مقداردهی آمار
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

            await this.saveState();
            console.log(`✅ Initialized queue with ${this.queue.length} fingerprints`);

        } catch (err) {
            console.log("Error initializing fingerprint queue:", err.message);
            throw err;
        }
    }

    // مخلوط کردن آرایه (Fisher-Yates shuffle)
    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    // گرفتن فینگرپرینت بعدی از صف
    async getNextFingerprint() {
        try {
            await this.loadState();

            if (this.queue.length === 0) {
                await this.initializeQueue();
            }

            // اگر به انتهای صف رسیدیم، از اول شروع کن
            if (this.currentIndex >= this.queue.length) {
                console.log("🔄 Reached end of queue, restarting from beginning...");
                this.currentIndex = 0;
                
                // مخلوط کردن مجدد برای تنوع بیشتر
                this.queue = this.shuffleArray(this.queue);
                console.log("🔀 Queue reshuffled for next round");
            }

            const selectedFingerprint = this.queue[this.currentIndex];
            
            // به‌روزرسانی آمار
            this.stats[selectedFingerprint.id].usageCount++;
            this.stats[selectedFingerprint.id].lastUsed = new Date().toISOString();

            // حرکت به فینگرپرینت بعدی
            this.currentIndex++;

            await this.saveState();

            console.log(`🎯 Selected fingerprint ${this.currentIndex}/${this.queue.length}: ${selectedFingerprint.id}`);
            console.log(`📊 Usage count: ${this.stats[selectedFingerprint.id].usageCount}`);

            return selectedFingerprint;

        } catch (err) {
            console.log("Error getting next fingerprint:", err.message);
            throw err;
        }
    }

    // نمایش آمار استفاده
    async showStats() {
        await this.loadState();
        
        console.log("\n📊 Fingerprint Usage Statistics:");
        console.log("=".repeat(50));

        const sortedStats = Object.entries(this.stats)
            .sort(([,a], [,b]) => b.usageCount - a.usageCount);

        sortedStats.forEach(([fingerprintId, stats], index) => {
            const lastUsed = stats.lastUsed ? 
                new Date(stats.lastUsed).toLocaleString('fa-IR') : 
                'Never';
            
            console.log(`${index + 1}. ID: ${fingerprintId.substring(0, 8)}... | Uses: ${stats.usageCount} | Last: ${lastUsed}`);
        });

        const totalUsage = sortedStats.reduce((sum, [,stats]) => sum + stats.usageCount, 0);
        const avgUsage = totalUsage / sortedStats.length;
        
        console.log("=".repeat(50));
        console.log(`Total fingerprints: ${sortedStats.length}`);
        console.log(`Total usage: ${totalUsage}`);
        console.log(`Average usage per fingerprint: ${avgUsage.toFixed(2)}`);
        console.log(`Current queue position: ${this.currentIndex}/${this.queue.length}`);
    }

    // ریست کردن آمار (اختیاری)
    async resetStats() {
        try {
            Object.keys(this.stats).forEach(fpId => {
                this.stats[fpId].usageCount = 0;
                this.stats[fpId].lastUsed = null;
            });

            this.currentIndex = 0;
            this.queue = this.shuffleArray(this.queue);

            await this.saveState();
            console.log("✅ Fingerprint stats reset successfully");

        } catch (err) {
            console.log("Error resetting stats:", err.message);
        }
    }

    // بررسی تعادل استفاده
    async checkBalance() {
        await this.loadState();
        
        const usageCounts = Object.values(this.stats).map(s => s.usageCount);
        const minUsage = Math.min(...usageCounts);
        const maxUsage = Math.max(...usageCounts);
        const difference = maxUsage - minUsage;

        console.log(`⚖️ Usage balance: Min=${minUsage}, Max=${maxUsage}, Difference=${difference}`);
        
        if (difference <= 1) {
            console.log("✅ Perfect balance achieved!");
        } else if (difference <= 3) {
            console.log("✅ Good balance");
        } else {
            console.log("⚠️ Imbalanced usage detected");
        }

        return { minUsage, maxUsage, difference, isBalanced: difference <= 1 };
    }
}

