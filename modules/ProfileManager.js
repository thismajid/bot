import { chromium } from "playwright";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Constants from "./Constants.js";
import HumanBehavior from "./HumanBehavior.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==================== Utility Functions ====================
function resolvePwBridgePath() {
    if (process.env.PW_BRIDGE_PATH) return process.env.PW_BRIDGE_PATH;
    
    const paths = {
        win32: `${process.env.LOCALAPPDATA}\\Programs\\Kameleo\\pw-bridge.exe`,
        darwin: "/Applications/Kameleo.app/Contents/Resources/CLI/pw-bridge",
        default: "/opt/kameleo/pw-bridge"
    };
    
    return paths[process.platform] || paths.default;
}

// ==================== ProfileManager Class ====================
export default class ProfileManager {
    constructor(client, globalBrowserManager) {
        this.client = client;
        this.globalBrowserManager = globalBrowserManager;
        this.maxRetries = Constants.MAX_RETRIES + 1;
    }

    // ==================== Profile Creation ====================
    async createProfile(proxy = null, cookies = [], retryCount = 0) {
        try {
            await this._checkGlobalLimits();
            console.log("Creating new profile...");

            const fingerprint = await this._getFingerprint();
            const profileName = this._generateProfileName();
            const createProfileRequest = this._buildProfileRequest(fingerprint, profileName, proxy);

            const profile = await this.client.profile.createProfile(createProfileRequest);
            await this._validateBrowserLimit(profile);
            await this.globalBrowserManager.registerProfile(profile.id, profileName);

            const context = await this._connectToProfile(profile);
            await this._testConnection(context);

            const stats = await this.globalBrowserManager.getClusterStats();
            console.log(`✅ Profile created successfully. Global stats:`, {
                active: stats.totalBrowsers,
                max: stats.maxBrowsers,
                cluster: this.globalBrowserManager.clusterId
            });

            return this._createProfileData(profile, profileName, context, proxy, fingerprint);

        } catch (err) {
            console.error("Error creating profile:", err.message);
            return await this._handleProfileCreationError(err, proxy, cookies, retryCount);
        }
    }

    async _checkGlobalLimits() {
        const canCreate = await this.globalBrowserManager.canCreateNewBrowser();
        if (!canCreate) {
            console.log(`⏳ Global browser limit reached, waiting... (Cluster: ${this.globalBrowserManager.clusterId})`);
            await this.globalBrowserManager.waitForAvailableSlot();
        }
    }

    async _getFingerprint() {
        // This would use the selectBalancedFingerprint function from the main file
        // For now, we'll assume it's passed or use a simple fallback
        const fingerprints = await this.client.fingerprint.searchFingerprints("desktop", "windows", "chrome", "139");
        const windowsFingerprints = fingerprints.filter(item => item.os.version === '11');
        return windowsFingerprints[Math.floor(Math.random() * windowsFingerprints.length)];
    }

    _generateProfileName() {
        return `Profile_${Date.now()}_${Math.random().toString(36).substr(2, 5)}_C${this.globalBrowserManager.clusterId}`;
    }

    _buildProfileRequest(fingerprint, profileName, proxy) {
        const createProfileRequest = {
            fingerprintId: fingerprint.id,
            name: profileName,
            webRtc: { value: "block" },
            screen: { value: 'manual', extra: '1280x720' },
            fonts: 'off'
        };

        if (proxy) {
            createProfileRequest.proxy = {
                value: 'http',
                extra: {
                    host: proxy.host,
                    port: proxy.port
                }
            };

            if (proxy.username && proxy.password) {
                createProfileRequest.proxy.extra.id = proxy.username;
                createProfileRequest.proxy.extra.secret = proxy.password;
            }

            console.log(`Setting proxy: ${proxy.host}:${proxy.port}`);
        }

        return createProfileRequest;
    }

    async _validateBrowserLimit(profile) {
        const newCount = await this.globalBrowserManager.incrementBrowserCount();
        if (newCount > Constants.MAX_CONCURRENT_BROWSERS) {
            await this.globalBrowserManager.decrementBrowserCount();
            await this.client.profile.deleteProfile(profile.id);
            throw new Error("Global browser limit exceeded during creation");
        }
    }

    async _connectToProfile(profile) {
        const ws = `ws://localhost:${Constants.KAMELEO_PORT}/playwright/${profile.id}`;
        const pwBridgePath = resolvePwBridgePath();

        console.log("Connecting to profile with Playwright...");

        return await chromium.launchPersistentContext("", {
            executablePath: pwBridgePath,
            args: ['--window-size=1920,1080', `-target ${ws}`],
            viewport: { width: 1920, height: 1080 },
            timeout: Constants.PROFILE_CREATE_TIMEOUT,
            headless: true,
            chromiumSandbox: false,
            devtools: false
        });
    }

    async _testConnection(context) {
        console.log("Testing profile connection...");
        const testPage = await context.newPage();
        await testPage.goto('about:blank', { timeout: 10000 });
        await testPage.close();
    }

    _createProfileData(profile, profileName, context, proxy, fingerprint) {
        return {
            profile: { id: profile.id, name: profileName },
            context,
            proxy: proxy,
            fingerprintId: fingerprint.id,
            globalManager: this.globalBrowserManager
        };
    }

    // ==================== Error Handling ====================
    async _handleProfileCreationError(err, proxy, cookies, retryCount) {
        await this.globalBrowserManager.decrementBrowserCount();
        await this._cleanupFailedProfile(err);

        if (this._shouldRetryForBrowserLimit(err, retryCount)) {
            return this._retryForBrowserLimit(proxy, cookies, retryCount);
        }

        if (this._shouldRetryForTimeout(err, retryCount)) {
            return this._retryForTimeout(proxy, cookies, retryCount);
        }

        if (this._shouldRetryForProxy(err, proxy, retryCount)) {
            return this._retryForProxy(cookies, retryCount);
        }

        throw err;
    }

    async _cleanupFailedProfile(err) {
        try {
            if (err.profile?.id) {
                await this.client.profile.deleteProfile(err.profile.id);
                await this.globalBrowserManager.unregisterProfile(err.profile.id);
            }
        } catch (cleanupErr) {
            console.log("Cleanup error:", cleanupErr.message);
        }
    }

    _shouldRetryForBrowserLimit(err, retryCount) {
        return (err.message.includes('Concurrent browsers limit exceeded') ||
                err.message.includes('HTTP 402') ||
                err.message.includes('Global browser limit exceeded')) &&
               retryCount < this.maxRetries;
    }

    async _retryForBrowserLimit(proxy, cookies, retryCount) {
        console.log(`❌ Browser limit exceeded globally, waiting...`);
        console.log(`🔄 Retrying after global cleanup (${retryCount + 1}/${this.maxRetries})...`);
        await HumanBehavior.sleep(5000 * (retryCount + 1));
        return this.createProfile(proxy, cookies, retryCount + 1);
    }

    _shouldRetryForTimeout(err, retryCount) {
        return err.message.includes('Timeout') && 
               err.message.includes('exceeded') && 
               retryCount < this.maxRetries;
    }

    async _retryForTimeout(proxy, cookies, retryCount) {
        console.log(`❌ Profile creation timeout occurred`);
        console.log(`🔄 Retrying profile creation (${retryCount + 1}/${this.maxRetries})...`);
        await HumanBehavior.sleep(2500 * (retryCount + 1));
        return this.createProfile(proxy, cookies, retryCount + 1);
    }

    _shouldRetryForProxy(err, proxy, retryCount) {
        return proxy && 
               (err.message.includes('Failed to determine external IP address') ||
                err.message.includes('HTTP 503') ||
                err.message.includes('connection')) &&
               retryCount < this.maxRetries;
    }

    async _retryForProxy(cookies, retryCount) {
        console.log(`🔄 Retrying with new proxy (${retryCount + 1}/${this.maxRetries})...`);
        await HumanBehavior.sleep(1500);
        // Note: This would need ProxyManager instance
        // const workingProxies = await ProxyManager.loadWorkingProxies();
        // const selectedProxy = await ProxyManager.getNextWorkingProxy(workingProxies);
        return this.createProfile(null, cookies, retryCount + 1); // Simplified for now
    }

    // ==================== Profile Closure ====================
    async closeProfile(profileData) {
        try {
            if (profileData.context) {
                await profileData.context.close();
            }

            if (profileData.profile?.id) {
                await this.client.profile.deleteProfile(profileData.profile.id);
                await this.globalBrowserManager.unregisterProfile(profileData.profile.id);
            }

            const newCount = await this.globalBrowserManager.decrementBrowserCount();
            console.log(`Browser closed. Global active browsers: ${newCount}/${Constants.MAX_CONCURRENT_BROWSERS} (Cluster ${this.globalBrowserManager.clusterId})`);

        } catch (error) {
            console.error("Error closing profile:", error.message);
            await this.globalBrowserManager.decrementBrowserCount();
        }
    }

    // ==================== Cleanup Management ====================
    async cleanupOldProfiles() {
        try {
            console.log("🧹 Global cleanup: checking old profiles across all clusters...");

            const profiles = await this.client.profile.listProfiles();
            const activeProfiles = await this.globalBrowserManager.getAllActiveProfiles();
            const currentTime = Date.now();
            const fiveMinutesInMs = 5 * 60 * 1000;

            let deletedCount = 0;
            let stoppedCount = 0;

            for (const profile of profiles) {
                try {
                    const profileAge = this._calculateProfileAge(profile, activeProfiles, currentTime);
                    
                    if (profileAge > fiveMinutesInMs) {
                        const result = await this._cleanupSingleProfile(profile, activeProfiles, profileAge);
                        stoppedCount += result.stopped;
                        deletedCount += result.deleted;
                    } else {
                        this._logFreshProfile(profile, profileAge, fiveMinutesInMs);
                    }

                    await HumanBehavior.sleep(500);
                } catch (err) {
                    console.log(`❌ Error processing profile ${profile.id}:`, err.message);
                }
            }

            const cleanedClusters = await this.globalBrowserManager.cleanupDeadClusters();
            const stats = await this.globalBrowserManager.getClusterStats();
            
            console.log(`✅ Global cleanup completed: ${stoppedCount} stopped, ${deletedCount} deleted, ${cleanedClusters} dead clusters cleaned`);
            console.log(`📊 Global stats:`, stats);

            return {
                stopped: stoppedCount,
                deleted: deletedCount,
                total: profiles.length,
                cleanedClusters: cleanedClusters
            };

        } catch (error) {
            console.error("❌ Global cleanup error:", error.message);
            return {
                stopped: 0,
                deleted: 0,
                total: 0,
                cleanedClusters: 0,
                error: error.message
            };
        }
    }

    _calculateProfileAge(profile, activeProfiles, currentTime) {
        const registeredProfile = activeProfiles[profile.id];
        
        if (registeredProfile) {
            return currentTime - registeredProfile.createdAt;
        }

        const timestampMatch = profile.name.match(/Profile_(\d+)_/);
        if (timestampMatch) {
            return currentTime - parseInt(timestampMatch[1]);
        }

        return 5 * 60 * 1000 + 1; // Assume it's old
    }

    async _cleanupSingleProfile(profile, activeProfiles, profileAge) {
        const ageInMinutes = Math.round(profileAge / 60000);
        const ownerCluster = activeProfiles[profile.id]?.clusterId || 'unknown';
        
        console.log(`🕒 Profile ${profile.name} is ${ageInMinutes} minutes old (Owner: Cluster ${ownerCluster}), cleaning up...`);

        let stopped = 0;
        let deleted = 0;

        // Stop profile
        try {
            await this.client.profile.stopProfile(profile.id);
            stopped = 1;
            console.log(`⏹️ Stopped profile: ${profile.name}`);
            await HumanBehavior.sleep(1000);
        } catch (stopErr) {
            console.log(`⚠️ Could not stop profile ${profile.name}:`, stopErr.message);
        }

        // Delete profile
        try {
            await this.client.profile.deleteProfile(profile.id);
            await this.globalBrowserManager.unregisterProfile(profile.id);
            await this.globalBrowserManager.decrementBrowserCount();

            deleted = 1;
            console.log(`🗑️ Deleted profile: ${profile.name}`);
        } catch (deleteErr) {
            console.log(`❌ Failed to delete profile ${profile.name}:`, deleteErr.message);
        }

        return { stopped, deleted };
    }

    _logFreshProfile(profile, profileAge, fiveMinutesInMs) {
        const remainingMinutes = Math.round((fiveMinutesInMs - profileAge) / 60000);
        console.log(`✅ Profile ${profile.name} is still fresh (${remainingMinutes} minutes remaining)`);
    }
}