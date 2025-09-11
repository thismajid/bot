import { KameleoLocalApiClient } from "@kameleo/local-api-client";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from "node:path";
import { logger } from "./utils/logger.js";
import axios from 'axios';
import FingerprintManager from "./FingerprintManager.js";
import FileBrowserManager from "./FileBrowserManager.js";
import { config } from "./utils/config.js";
import { 
    Constants,
    HumanBehavior,
    FakeAccountGenerator,
    ProxyManager,
    ProfileManager,
    AccountProcessor,
    PageHelpers
} from "./modules/index.js";

// ==================== Global Initialization ====================
const globalBrowserManager = new FileBrowserManager();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const client = new KameleoLocalApiClient({ 
    basePath: `http://localhost:${Constants.KAMELEO_PORT}` 
});

let fingerprintManager = null;

// ==================== Core Functions ====================
function initializeFingerprintManager(kameleoClient) {
    if (!fingerprintManager) {
        fingerprintManager = new FingerprintManager(kameleoClient);
    }
    return fingerprintManager;
}

async function selectBalancedFingerprint() {
    try {
        if (!fingerprintManager) {
            fingerprintManager = initializeFingerprintManager(client);
        }

        const fingerprint = await fingerprintManager.getNextFingerprint();
        return fingerprint;

    } catch (err) {
        console.log("❌ Error selecting balanced fingerprint:", err.message);
        console.log("🔄 Falling back to random selection...");
        
        const fingerprints = await client.fingerprint.searchFingerprints("desktop", "windows", "chrome", "139");
        const windowsFingerprints = fingerprints.filter(item => item.os.version === '11');
        return windowsFingerprints[Math.floor(Math.random() * windowsFingerprints.length)];
    }
}

// ==================== Profile Management ====================
async function createNewProfile(proxy = null, cookies = [], retryCount = 0) {
    const profileManager = new ProfileManager(client, globalBrowserManager);
    return await profileManager.createProfile(proxy, cookies, retryCount);
}

async function closeProfile(profileData) {
    const profileManager = new ProfileManager(client, globalBrowserManager);
    return await profileManager.closeProfile(profileData);
}

async function cleanupOldProfiles() {
    const profileManager = new ProfileManager(client, globalBrowserManager);
    return await profileManager.cleanupOldProfiles();
}

// ==================== Global Management ====================
async function initializeGlobalProfileManager() {
    try {
        console.log(`🚀 Initializing global profile manager for cluster ${globalBrowserManager.clusterId}`);

        if (globalBrowserManager.clusterId === '0' || !globalBrowserManager.clusterId) {
            console.log("🧹 Master cluster performing initial cleanup...");
            await globalBrowserManager.resetCounters();
            await cleanupOldProfiles();
        } else {
            await HumanBehavior.sleep(1000);
            await globalBrowserManager.cleanupDeadClusters();
        }

        const stats = await globalBrowserManager.getClusterStats();
        console.log(`✅ Global profile manager initialized for cluster ${globalBrowserManager.clusterId}`);
        console.log(`📊 Current global stats:`, stats);

    } catch (error) {
        console.error("❌ Global profile manager initialization error:", error.message);
    }
}

function startPeriodicCleanup(intervalMinutes = 10) {
    console.log(`🔄 Starting periodic cleanup every ${intervalMinutes} minutes (Cluster ${globalBrowserManager.clusterId})`);

    setInterval(async () => {
        console.log(`🕐 Running scheduled cleanup... (Cluster ${globalBrowserManager.clusterId})`);
        await cleanupOldProfiles();
    }, intervalMinutes * 60 * 1000);
}

async function showCurrentStats() {
    try {
        const stats = await globalBrowserManager.getClusterStats();
        console.log('📊 Current Global Browser Stats:');
        console.log(`   Total Active Browsers: ${stats.totalBrowsers}/${stats.maxBrowsers}`);
        console.log(`   Active Profiles: ${stats.profilesCount}`);
        console.log(`   Active Clusters: ${Object.keys(stats.clusters).length}`);

        for (const [clusterId, clusterInfo] of Object.entries(stats.clusters)) {
            const lastActivity = new Date(clusterInfo.lastActivity).toLocaleTimeString();
            console.log(`   - Cluster ${clusterId}: ${clusterInfo.count} browsers (Last activity: ${lastActivity})`);
        }

        return stats;
    } catch (error) {
        console.error('Error getting stats:', error.message);
        return null;
    }
}

async function manageFingerprintQueue(command) {
    if (!fingerprintManager) {
        fingerprintManager = initializeFingerprintManager(client);
    }

    const commands = {
        'stats': () => fingerprintManager.showStats(),
        'balance': () => fingerprintManager.checkBalance(),
        'reset': () => fingerprintManager.resetStats(),
        'init': () => fingerprintManager.initializeQueue()
    };

    if (commands[command]) {
        await commands[command]();
    } else {
        console.log("Available commands: stats, balance, reset, init");
    }
}

// ==================== Account Processing ====================
async function processFakeAccountFirst(context) {
    const processor = new AccountProcessor(client);
    return await processor.processFakeAccount(context);
}

async function processAccountInTab(context, accountLine, tabIndex, accountsCount) {
    const processor = new AccountProcessor(client);
    return await processor.processAccount(context, accountLine, tabIndex, accountsCount);
}

// ==================== Main Processing Logic ====================
async function processAccountBatch(accountBatch) {
    let profileData = null;
    let usedProxy = null;

    try {
        const proxyManager = new ProxyManager();
        const workingProxies = await proxyManager.loadWorkingProxies();
        usedProxy = await proxyManager.getNextWorkingProxy(workingProxies);

        if (!usedProxy) {
            console.log("❌ No working proxies available");
            return false;
        }

        const cookies = await proxyManager.loadCookies();
        profileData = await createNewProfile(usedProxy, cookies);

        if (!profileData) {
            console.log("❌ Failed to create profile");
            return false;
        }

        const { context } = profileData;

        // Process fake account first
        try {
            await processFakeAccountFirst(context);
        } catch (fakeErr) {
            console.log("🎭 Fake account error:", fakeErr.message);

            if (AccountProcessor.isCriticalError(fakeErr)) {
                console.log(`❌ Critical error detected, removing problematic proxy`);
                if (usedProxy) {
                    await proxyManager.removeUsedWorkingProxy(usedProxy);
                }
                throw new Error('PROFILE_RESTART_REQUIRED');
            }

            console.log("🎭 Continuing despite fake account error...");
        }

        // Process accounts in parallel
        console.log("🚀 Processing accounts in parallel...");
        const promises = accountBatch.map((accountLine, index) =>
            processAccountInTab(context, accountLine, index, accountBatch.length)
        );

        const results = await Promise.allSettled(promises);

        // Check first account result
        const firstAccountResult = results[0];
        let shouldStopProcessing = false;

        if (firstAccountResult.status === 'fulfilled') {
            const firstResult = firstAccountResult.value;
            console.log(`🔍 Checking first account result: ${firstResult.email} - Status: ${firstResult.status}`);

            if (firstResult.status === 'server-error') {
                console.log(`🚨 CRITICAL: First account encountered server error - stopping entire processing!`);
                shouldStopProcessing = true;

                await AccountProcessor.sendResultsToServer([firstResult]);
                
                if (usedProxy) {
                    console.log(`❌ Removing problematic proxy: ${usedProxy.host}:${usedProxy.port}`);
                    await proxyManager.removeUsedWorkingProxy(usedProxy);
                }

                await AccountProcessor.removeProcessedAccounts(1);
                return false;
            }
        } else {
            console.log(`🚨 CRITICAL: First account failed with error - stopping entire processing!`);
            shouldStopProcessing = true;

            const errorResult = {
                email: accountBatch[0].split(':')[0],
                status: 'server-error',
                error: firstAccountResult.reason,
                responseTime: 0,
                tabIndex: 0
            };

            await AccountProcessor.sendResultsToServer([errorResult]);
            
            if (usedProxy) {
                await proxyManager.removeUsedWorkingProxy(usedProxy);
            }

            await AccountProcessor.removeProcessedAccounts(1);
            return false;
        }

        // Process all results if first account was successful
        if (!shouldStopProcessing) {
            console.log(`✅ First account successful - processing all results...`);
            
            let proxyIssueDetected = false;
            let serverErrorCount = 0;
            const processedResults = [];

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    processedResults.push(result.value);
                    if (result.value.status === 'server-error') {
                        serverErrorCount++;
                    }
                } else {
                    processedResults.push({
                        email: accountBatch[index].split(':')[0],
                        status: 'error',
                        error: result.reason,
                        responseTime: 0,
                        tabIndex: index
                    });

                    if (result.reason && typeof result.reason === 'string') {
                        if (AccountProcessor.isProxyError(result.reason)) {
                            proxyIssueDetected = true;
                        }
                    }
                }
            });

            if (processedResults.length > 0) {
                await AccountProcessor.sendResultsToServer(processedResults);
            }

            // Handle proxy removal
            if ((serverErrorCount > accountBatch.length / 2) || proxyIssueDetected) {
                if (usedProxy) {
                    console.log(`❌ Proxy issues detected, removing: ${usedProxy.host}:${usedProxy.port}`);
                    await proxyManager.removeUsedWorkingProxy(usedProxy);
                }
            } else {
                if (usedProxy) {
                    console.log(`✅ Proxy used successfully, removing: ${usedProxy.host}:${usedProxy.port}`);
                    await proxyManager.removeUsedWorkingProxy(usedProxy);
                }
            }

            await AccountProcessor.removeProcessedAccounts(accountBatch.length);
            console.log(`✅ Batch completed successfully. Processed ${accountBatch.length} accounts.`);
        }

        return !shouldStopProcessing;

    } catch (error) {
        console.error("❌ Batch processing error:", error.message);
        return false;
    } finally {
        if (profileData) {
            await closeProfile(profileData);
        }
    }
}

// ==================== Main Loop ====================
async function main() {
    try {
        await initializeGlobalProfileManager();
        startPeriodicCleanup(10);

        console.log("🚀 Starting main processing loop...");

        while (true) {
            try {
                const accountBatch = await AccountProcessor.loadAccountBatch(Constants.CONCURRENT_TABS);
                
                if (accountBatch.length === 0) {
                    console.log("📭 No accounts to process. Waiting...");
                    await HumanBehavior.sleep(30000);
                    continue;
                }

                console.log(`📦 Processing batch of ${accountBatch.length} accounts`);
                const success = await processAccountBatch(accountBatch);

                if (!success) {
                    console.log("⚠️ Batch processing failed, waiting before retry...");
                    await HumanBehavior.sleep(10000);
                }

                // Small delay between batches
                await HumanBehavior.sleep(HumanBehavior.randomDelay(2000, 5000));

            } catch (error) {
                console.error("❌ Main loop error:", error.message);
                await HumanBehavior.sleep(15000);
            }
        }

    } catch (error) {
        console.error("❌ Fatal error in main:", error.message);
        process.exit(1);
    }
}

// ==================== Exports and Startup ====================
export {
    createNewProfile,
    closeProfile,
    cleanupOldProfiles,
    showCurrentStats,
    manageFingerprintQueue,
    processAccountBatch
};

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}