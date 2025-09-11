import fs from "node:fs/promises";
import path from "path"
import { config } from "./utils/config.js";

const SHARED_STATE_FILE = 'shared_browser_state.json';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default class FileBrowserManager {
    constructor() {
        this.clusterId = process.env.pm_id || process.pid;
        this.instanceId = `cluster_${this.clusterId}_${Date.now()}`;
        this.lockFile = path.join(process.cwd(), 'browser_state.lock');
        this.maxLockAttempts = 50; // تعداد تلاش‌های بیشتر
        this.baseLockTimeout = 100; // timeout پایه کمتر
    }

    // ✅ بهبود lock mechanism با exponential backoff
    async acquireLock(timeout = 15000) {
        const startTime = Date.now();
        let attempt = 0;

        while (Date.now() - startTime < timeout) {
            try {
                await fs.writeFile(this.lockFile, this.instanceId, { flag: 'wx' });
                return true;
            } catch (error) {
                if (error.code !== 'EEXIST') {
                    throw error;
                }

                attempt++;

                // ✅ Exponential backoff با jitter
                const baseDelay = Math.min(this.baseLockTimeout * Math.pow(1.5, attempt), 1000);
                const jitter = Math.random() * 100; // تصادفی‌سازی برای جلوگیری از thundering herd
                const delay = baseDelay + jitter;

                // ✅ بررسی سن lock file
                try {
                    const lockStats = await fs.stat(this.lockFile);
                    const lockAge = Date.now() - lockStats.mtime.getTime();

                    // اگر lock بیش از 30 ثانیه قدیمی است، احتمالاً dead lock است
                    if (lockAge > 30000) {
                        console.log(`⚠️ Detected stale lock (${lockAge}ms old), attempting to break it...`);
                        try {
                            await fs.unlink(this.lockFile);
                            console.log(`🔓 Stale lock removed`);
                            continue; // تلاش مجدد بدون delay
                        } catch (unlinkError) {
                            // ممکن است کلاستر دیگری همزمان lock را حذف کرده باشد
                        }
                    }
                } catch (statError) {
                    // Lock file ممکن است وجود نداشته باشد
                }

                await sleep(delay);
            }
        }

        throw new Error(`Could not acquire lock after ${timeout}ms (${attempt} attempts)`);
    }

    async releaseLock() {
        try {
            const lockContent = await fs.readFile(this.lockFile, 'utf8');
            if (lockContent === this.instanceId) {
                await fs.unlink(this.lockFile);
            }
        } catch (error) {
            // Lock file might not exist or belong to another process
        }
    }

    // ✅ متد جدید برای عملیات بدون lock (فقط خواندن)
    async readStateWithoutLock() {
        try {
            const data = await fs.readFile(SHARED_STATE_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {
                browserCount: 0,
                profiles: {},
                lastUpdated: Date.now(),
                clusters: {}
            };
        }
    }

    async readState() {
        return this.readStateWithoutLock();
    }

    async writeState(state) {
        state.lastUpdated = Date.now();
        await fs.writeFile(SHARED_STATE_FILE, JSON.stringify(state, null, 2));
    }

    // ✅ بهبود increment با retry mechanism
    async incrementBrowserCount(retryCount = 0) {
        const maxRetries = 3;

        try {
            await this.acquireLock(5000 + (retryCount * 2000)); // timeout افزایشی

            try {
                const state = await this.readState();
                state.browserCount = (state.browserCount || 0) + 1;

                if (!state.clusters[this.clusterId]) {
                    state.clusters[this.clusterId] = { count: 0, lastActivity: Date.now() };
                }
                state.clusters[this.clusterId].count++;
                state.clusters[this.clusterId].lastActivity = Date.now();

                await this.writeState(state);
                console.log(`📈 Browser count increased to: ${state.browserCount} (Cluster ${this.clusterId}: ${state.clusters[this.clusterId].count})`);
                return state.browserCount;
            } finally {
                await this.releaseLock();
            }
        } catch (lockError) {
            if (retryCount < maxRetries) {
                console.log(`⚠️ Lock failed, retrying increment (${retryCount + 1}/${maxRetries})...`);
                await sleep(1000 * (retryCount + 1));
                return this.incrementBrowserCount(retryCount + 1);
            }

            // اگر lock نتوانست گرفته شود، حداقل شمارنده محلی را برگردانید
            console.error(`❌ Failed to acquire lock for increment after ${maxRetries} retries`);
            const state = await this.readStateWithoutLock();
            return (state.browserCount || 0) + 1; // تخمین
        }
    }

    // ✅ بهبود decrement با retry mechanism
    async decrementBrowserCount(retryCount = 0) {
        const maxRetries = 3;

        try {
            await this.acquireLock(5000 + (retryCount * 2000));

            try {
                const state = await this.readState();
                state.browserCount = Math.max(0, (state.browserCount || 0) - 1);

                if (state.clusters[this.clusterId]) {
                    state.clusters[this.clusterId].count = Math.max(0, state.clusters[this.clusterId].count - 1);
                    state.clusters[this.clusterId].lastActivity = Date.now();
                }

                await this.writeState(state);
                console.log(`📉 Browser count decreased to: ${state.browserCount} (Cluster ${this.clusterId}: ${state.clusters[this.clusterId]?.count || 0})`);
                return state.browserCount;
            } finally {
                await this.releaseLock();
            }
        } catch (lockError) {
            if (retryCount < maxRetries) {
                console.log(`⚠️ Lock failed, retrying decrement (${retryCount + 1}/${maxRetries})...`);
                await sleep(1000 * (retryCount + 1));
                return this.decrementBrowserCount(retryCount + 1);
            }

            console.error(`❌ Failed to acquire lock for decrement after ${maxRetries} retries`);
            const state = await this.readStateWithoutLock();
            return Math.max(0, (state.browserCount || 0) - 1); // تخمین
        }
    }

    async getCurrentBrowserCount() {
        const state = await this.readStateWithoutLock(); // بدون lock برای سرعت
        return state.browserCount || 0;
    }

    async canCreateNewBrowser() {
        const currentCount = await this.getCurrentBrowserCount();
        return currentCount < config.MAX_CONCURRENT_BROWSERS;
    }

    // ✅ بهبود waitForAvailableSlot
    async waitForAvailableSlot(maxWaitTime = 60000) {
        const startTime = Date.now();
        let consecutiveFailures = 0;

        while (Date.now() - startTime < maxWaitTime) {
            try {
                const canCreate = await this.canCreateNewBrowser();
                if (canCreate) {
                    consecutiveFailures = 0; // ریست کردن شمارنده خطا
                    return true;
                }

                const currentCount = await this.getCurrentBrowserCount();
                console.log(`⏳ Waiting for browser slot... (${currentCount}/${config.MAX_CONCURRENT_BROWSERS}) - Cluster ${this.clusterId}`);

                // تاخیر تطبیقی
                const waitTime = Math.min(2000 + (consecutiveFailures * 500), 10000);
                await sleep(waitTime);

            } catch (error) {
                consecutiveFailures++;
                console.log(`⚠️ Error checking browser availability (${consecutiveFailures}): ${error.message}`);

                if (consecutiveFailures > 5) {
                    console.log(`❌ Too many consecutive failures, assuming we can proceed`);
                    return true; // فرض کنیم که می‌توانیم ادامه دهیم
                }

                await sleep(1000 * consecutiveFailures);
            }
        }

        throw new Error(`Timeout waiting for available browser slot after ${maxWaitTime}ms`);
    }

    // ✅ register profile بدون lock اجباری
    async registerProfile(profileId, profileName) {
        try {
            await this.acquireLock(3000); // timeout کمتر

            try {
                const state = await this.readState();

                state.profiles[profileId] = {
                    id: profileId,
                    name: profileName,
                    clusterId: this.clusterId,
                    instanceId: this.instanceId,
                    createdAt: Date.now()
                };

                await this.writeState(state);
                console.log(`📝 Registered profile: ${profileName} (${profileId}) - Cluster ${this.clusterId}`);
            } finally {
                await this.releaseLock();
            }
        } catch (lockError) {
            // اگر register نتوانست انجام شود، مشکل خاصی نیست
            console.log(`⚠️ Could not register profile ${profileId}: ${lockError.message}`);
        }
    }

    // ✅ unregister profile بدون lock اجباری
    async unregisterProfile(profileId) {
        try {
            await this.acquireLock(3000);

            try {
                const state = await this.readState();

                if (state.profiles[profileId]) {
                    delete state.profiles[profileId];
                    await this.writeState(state);
                    console.log(`🗑️ Unregistered profile: ${profileId} - Cluster ${this.clusterId}`);
                }
            } finally {
                await this.releaseLock();
            }
        } catch (lockError) {
            console.log(`⚠️ Could not unregister profile ${profileId}: ${lockError.message}`);
        }
    }

    async getAllActiveProfiles() {
        const state = await this.readStateWithoutLock();
        return state.profiles || {};
    }

    async resetCounters() {
        try {
            await this.acquireLock(10000);

            try {
                const state = {
                    browserCount: 0,
                    profiles: {},
                    lastUpdated: Date.now(),
                    clusters: {}
                };
                await this.writeState(state);
                console.log('🔄 Browser counters reset');
            } finally {
                await this.releaseLock();
            }
        } catch (lockError) {
            console.error(`❌ Could not reset counters: ${lockError.message}`);
            // در صورت عدم موفقیت، فایل را مستقیم بازنویسی کنید
            try {
                const state = {
                    browserCount: 0,
                    profiles: {},
                    lastUpdated: Date.now(),
                    clusters: {}
                };
                await this.writeState(state);
                console.log('🔄 Browser counters force reset');
            } catch (forceError) {
                console.error(`❌ Force reset failed: ${forceError.message}`);
            }
        }
    }

    async getClusterStats() {
        const state = await this.readStateWithoutLock();
        return {
            totalBrowsers: state.browserCount || 0,
            maxBrowsers: config.MAX_CONCURRENT_BROWSERS,
            clusters: state.clusters || {},
            profilesCount: Object.keys(state.profiles || {}).length,
            lastUpdated: state.lastUpdated
        };
    }

    async cleanupDeadClusters(maxInactiveTime = 300000) {
        try {
            await this.acquireLock(8000);

            try {
                const state = await this.readState();
                const currentTime = Date.now();
                let cleanedCount = 0;

                for (const [clusterId, clusterInfo] of Object.entries(state.clusters || {})) {
                    if (currentTime - clusterInfo.lastActivity > maxInactiveTime) {
                        console.log(`🧹 Cleaning up dead cluster: ${clusterId}`);

                        state.browserCount = Math.max(0, state.browserCount - clusterInfo.count);
                        delete state.clusters[clusterId];

                        for (const [profileId, profileData] of Object.entries(state.profiles || {})) {
                            if (profileData.clusterId === clusterId) {
                                delete state.profiles[profileId];
                            }
                        }

                        cleanedCount++;
                    }
                }

                if (cleanedCount > 0) {
                    await this.writeState(state);
                    console.log(`✅ Cleaned up ${cleanedCount} dead clusters`);
                }

                return cleanedCount;
            } finally {
                await this.releaseLock();
            }
        } catch (lockError) {
            console.log(`⚠️ Could not cleanup dead clusters: ${lockError.message}`);
            return 0;
        }
    }
}
