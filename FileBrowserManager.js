import fs from "node:fs/promises";
import path from "path";
import { config } from "./utils/config.js";

// ==================== Constants ====================
const FILES = {
    SHARED_STATE: 'shared_browser_state.json',
    LOCK_FILE: 'browser_state.lock'
};

const LOCK_CONFIG = {
    MAX_ATTEMPTS: 50,
    BASE_TIMEOUT: 100,
    MAX_DELAY: 1000,
    STALE_LOCK_THRESHOLD: 30000, // 30 seconds
    DEFAULT_TIMEOUT: 15000
};

const RETRY_CONFIG = {
    MAX_RETRIES: 3,
    BASE_DELAY: 1000
};

// ==================== Utility Functions ====================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== FileBrowserManager Class ====================
export default class FileBrowserManager {
    constructor() {
        this.clusterId = process.env.pm_id || process.pid;
        this.instanceId = `cluster_${this.clusterId}_${Date.now()}`;
        this.lockFile = path.join(process.cwd(), FILES.LOCK_FILE);
    }

    // ==================== Lock Management ====================
    async acquireLock(timeout = LOCK_CONFIG.DEFAULT_TIMEOUT) {
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
                const delay = this._calculateLockDelay(attempt);
                
                if (await this._handleStaleLock()) {
                    continue; // Try again immediately after removing stale lock
                }

                await sleep(delay);
            }
        }

        throw new Error(`Could not acquire lock after ${timeout}ms (${attempt} attempts)`);
    }

    _calculateLockDelay(attempt) {
        const baseDelay = Math.min(
            LOCK_CONFIG.BASE_TIMEOUT * Math.pow(1.5, attempt), 
            LOCK_CONFIG.MAX_DELAY
        );
        const jitter = Math.random() * 100;
        return baseDelay + jitter;
    }

    async _handleStaleLock() {
        try {
            const lockStats = await fs.stat(this.lockFile);
            const lockAge = Date.now() - lockStats.mtime.getTime();

            if (lockAge > LOCK_CONFIG.STALE_LOCK_THRESHOLD) {
                console.log(`⚠️ Detected stale lock (${lockAge}ms old), attempting to break it...`);
                try {
                    await fs.unlink(this.lockFile);
                    console.log(`🔓 Stale lock removed`);
                    return true;
                } catch (unlinkError) {
                    // Another cluster might have removed it simultaneously
                }
            }
        } catch (statError) {
            // Lock file might not exist
        }
        return false;
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

    // ==================== State Management ====================
    async readStateWithoutLock() {
        try {
            const data = await fs.readFile(FILES.SHARED_STATE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return this._getDefaultState();
        }
    }

    async readState() {
        return this.readStateWithoutLock();
    }

    async writeState(state) {
        state.lastUpdated = Date.now();
        await fs.writeFile(FILES.SHARED_STATE, JSON.stringify(state, null, 2));
    }

    _getDefaultState() {
        return {
            browserCount: 0,
            profiles: {},
            lastUpdated: Date.now(),
            clusters: {}
        };
    }

    // ==================== Browser Count Management ====================
    async incrementBrowserCount(retryCount = 0) {
        try {
            await this.acquireLock(this._getLockTimeout(retryCount));

            try {
                const state = await this.readState();
                const newCount = this._incrementStateCounters(state);
                
                await this.writeState(state);
                this._logBrowserCountChange('increased', newCount, state.clusters[this.clusterId].count);
                
                return newCount;
            } finally {
                await this.releaseLock();
            }
        } catch (lockError) {
            return this._handleCounterOperationError('increment', retryCount, lockError);
        }
    }

    async decrementBrowserCount(retryCount = 0) {
        try {
            await this.acquireLock(this._getLockTimeout(retryCount));

            try {
                const state = await this.readState();
                const newCount = this._decrementStateCounters(state);
                
                await this.writeState(state);
                this._logBrowserCountChange('decreased', newCount, state.clusters[this.clusterId]?.count || 0);
                
                return newCount;
            } finally {
                await this.releaseLock();
            }
        } catch (lockError) {
            return this._handleCounterOperationError('decrement', retryCount, lockError);
        }
    }

    _incrementStateCounters(state) {
        state.browserCount = (state.browserCount || 0) + 1;

        if (!state.clusters[this.clusterId]) {
            state.clusters[this.clusterId] = { count: 0, lastActivity: Date.now() };
        }
        state.clusters[this.clusterId].count++;
        state.clusters[this.clusterId].lastActivity = Date.now();

        return state.browserCount;
    }

    _decrementStateCounters(state) {
        state.browserCount = Math.max(0, (state.browserCount || 0) - 1);

        if (state.clusters[this.clusterId]) {
            state.clusters[this.clusterId].count = Math.max(0, state.clusters[this.clusterId].count - 1);
            state.clusters[this.clusterId].lastActivity = Date.now();
        }

        return state.browserCount;
    }

    _getLockTimeout(retryCount) {
        return 5000 + (retryCount * 2000);
    }

    _logBrowserCountChange(action, totalCount, clusterCount) {
        console.log(`📈📉 Browser count ${action} to: ${totalCount} (Cluster ${this.clusterId}: ${clusterCount})`);
    }

    async _handleCounterOperationError(operation, retryCount, lockError) {
        if (retryCount < RETRY_CONFIG.MAX_RETRIES) {
            console.log(`⚠️ Lock failed, retrying ${operation} (${retryCount + 1}/${RETRY_CONFIG.MAX_RETRIES})...`);
            await sleep(RETRY_CONFIG.BASE_DELAY * (retryCount + 1));
            
            return operation === 'increment' 
                ? this.incrementBrowserCount(retryCount + 1)
                : this.decrementBrowserCount(retryCount + 1);
        }

        console.error(`❌ Failed to acquire lock for ${operation} after ${RETRY_CONFIG.MAX_RETRIES} retries`);
        const state = await this.readStateWithoutLock();
        
        return operation === 'increment'
            ? (state.browserCount || 0) + 1
            : Math.max(0, (state.browserCount || 0) - 1);
    }

    // ==================== Browser Management ====================
    async getCurrentBrowserCount() {
        const state = await this.readStateWithoutLock();
        return state.browserCount || 0;
    }

    async canCreateNewBrowser() {
        const currentCount = await this.getCurrentBrowserCount();
        return currentCount < config.MAX_CONCURRENT_BROWSERS;
    }

    async waitForAvailableSlot(maxWaitTime = 60000) {
        const startTime = Date.now();
        let consecutiveFailures = 0;

        while (Date.now() - startTime < maxWaitTime) {
            try {
                if (await this.canCreateNewBrowser()) {
                    consecutiveFailures = 0;
                    return true;
                }

                const currentCount = await this.getCurrentBrowserCount();
                console.log(`⏳ Waiting for browser slot... (${currentCount}/${config.MAX_CONCURRENT_BROWSERS}) - Cluster ${this.clusterId}`);

                const waitTime = this._calculateWaitTime(consecutiveFailures);
                await sleep(waitTime);

            } catch (error) {
                consecutiveFailures++;
                console.log(`⚠️ Error checking browser availability (${consecutiveFailures}): ${error.message}`);

                if (consecutiveFailures > 5) {
                    console.log(`❌ Too many consecutive failures, assuming we can proceed`);
                    return true;
                }

                await sleep(1000 * consecutiveFailures);
            }
        }

        throw new Error(`Timeout waiting for available browser slot after ${maxWaitTime}ms`);
    }

    _calculateWaitTime(consecutiveFailures) {
        return Math.min(2000 + (consecutiveFailures * 500), 10000);
    }

    // ==================== Profile Management ====================
    async registerProfile(profileId, profileName) {
        try {
            await this.acquireLock(3000);

            try {
                const state = await this.readState();
                state.profiles[profileId] = this._createProfileRecord(profileId, profileName);
                
                await this.writeState(state);
                console.log(`📝 Registered profile: ${profileName} (${profileId}) - Cluster ${this.clusterId}`);
            } finally {
                await this.releaseLock();
            }
        } catch (lockError) {
            console.log(`⚠️ Could not register profile ${profileId}: ${lockError.message}`);
        }
    }

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

    _createProfileRecord(profileId, profileName) {
        return {
            id: profileId,
            name: profileName,
            clusterId: this.clusterId,
            instanceId: this.instanceId,
            createdAt: Date.now()
        };
    }

    async getAllActiveProfiles() {
        const state = await this.readStateWithoutLock();
        return state.profiles || {};
    }

    // ==================== System Management ====================
    async resetCounters() {
        try {
            await this.acquireLock(10000);

            try {
                const state = this._getDefaultState();
                await this.writeState(state);
                console.log('🔄 Browser counters reset');
            } finally {
                await this.releaseLock();
            }
        } catch (lockError) {
            console.error(`❌ Could not reset counters: ${lockError.message}`);
            await this._forceResetCounters();
        }
    }

    async _forceResetCounters() {
        try {
            const state = this._getDefaultState();
            await this.writeState(state);
            console.log('🔄 Browser counters force reset');
        } catch (forceError) {
            console.error(`❌ Force reset failed: ${forceError.message}`);
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
                const cleanedCount = this._performClusterCleanup(state, maxInactiveTime);

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

    _performClusterCleanup(state, maxInactiveTime) {
        const currentTime = Date.now();
        let cleanedCount = 0;

        for (const [clusterId, clusterInfo] of Object.entries(state.clusters || {})) {
            if (currentTime - clusterInfo.lastActivity > maxInactiveTime) {
                console.log(`🧹 Cleaning up dead cluster: ${clusterId}`);

                state.browserCount = Math.max(0, state.browserCount - clusterInfo.count);
                delete state.clusters[clusterId];

                // Remove profiles belonging to dead cluster
                for (const [profileId, profileData] of Object.entries(state.profiles || {})) {
                    if (profileData.clusterId === clusterId) {
                        delete state.profiles[profileId];
                    }
                }

                cleanedCount++;
            }
        }

        return cleanedCount;
    }
}