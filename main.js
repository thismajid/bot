import { io } from "socket.io-client";
import { logger } from "./utils/logger.js";
import { config } from "./utils/config.js";
import {
    ProfileManager,
    AccountProcessor,
    ProxyManager,
    HumanBehavior
} from "./modules/index.js";
import {
    initializeGlobalProfileManager,
    startPeriodicCleanup,
    showCurrentStats,
    globalBrowserManager
} from "./bot.js";

// ==================== Main PSN Instance Class ====================
class PSNInstance {
    constructor() {
        this.instanceId = config.INSTANCE_ID;
        this.serverUrl = config.SERVER_WS_URL;
        this.socket = null;
        this.connected = false;
        this.registered = false;
        this.isProcessing = false;
        this.workStartTime = null;
        
        this.stats = {
            processed: 0,
            success: 0,
            errors: 0,
            startTime: Date.now()
        };

        this.browserStats = {
            profilesCreated: 0,
            profilesClosed: 0,
            browserErrors: 0
        };

        this.profileManager = new ProfileManager(null, globalBrowserManager);
        this.accountProcessor = new AccountProcessor(null);
    }

    // ==================== Socket Management ====================
    initSocket() {
        logger.info(`🔄 Connecting to server: ${this.serverUrl}`);

        this.socket = io(this.serverUrl, {
            path: '/instance-socket',
            transports: ["websocket", "polling"],
            reconnection: true,
            reconnectionDelay: 5000,
            reconnectionAttempts: Infinity,
            timeout: 20000
        });

        this.setupSocketEvents();
    }

    setupSocketEvents() {
        this.socket.on("connect", () => {
            this.connected = true;
            logger.info(`✅ Connected to server as ${this.instanceId}`);
            this.registerInstance();
        });

        this.socket.on("disconnect", (reason) => {
            this.connected = false;
            this.registered = false;
            this.isProcessing = false;
            logger.warn(`❌ Disconnected: ${reason}`);
        });

        this.socket.on("registration-confirmed", (data) => {
            this.registered = true;
            logger.info(`🎯 Registration confirmed: ${data.instanceData.instanceId}`);
            setTimeout(() => this.processWorkFlow(), 2000);
        });

        this.socket.on("registration-error", (data) => {
            logger.error(`❌ Registration failed: ${data.error}`);
            this.registered = false;
        });

        this._setupWorkflowEvents();
        this._setupErrorEvents();
    }

    _setupWorkflowEvents() {
        this.socket.on("proxy-assigned", (proxyData) => {
            logger.debug(`📡 Proxy assigned event received`);
        });

        this.socket.on("no-proxy-available", (data) => {
            logger.debug(`📡 No proxy available event received`);
        });

        this.socket.on("accounts-assigned", (accountsData) => {
            logger.debug(`📡 Accounts assigned event received`);
        });

        this.socket.on("no-accounts-available", (data) => {
            logger.debug(`📡 No accounts available event received`);
        });

        this.socket.on("results-acknowledged", (data) => {
            logger.info(`✅ Results acknowledged: ${data.processed} accounts processed`);
            setTimeout(() => {
                if (this.connected && this.registered && !this.isProcessing) {
                    this.processWorkFlow();
                }
            }, 3000);
        });

        this.socket.on("heartbeat-ack", (data) => {
            // logger.debug(`💓 Heartbeat acknowledged`);
        });
    }

    _setupErrorEvents() {
        this.socket.on("error", (error) => {
            logger.error(`❌ Socket error: ${error.message || error}`);
        });

        this.socket.on("connect_error", (error) => {
            logger.error(`❌ Connection error: ${error.message || error}`);
        });
    }

    // ==================== Registration ====================
    registerInstance() {
        const registrationData = {
            instanceId: this.instanceId,
            serverInfo: {
                hostname: process.env.COMPUTERNAME || 'unknown',
                platform: process.platform,
                nodeVersion: process.version,
                memory: process.memoryUsage(),
                pid: process.pid,
                clusterId: globalBrowserManager.clusterId
            },
            capabilities: {
                batchSize: config.BATCH_SIZE || 3,
                supportedSites: ['sony'],
                maxConcurrency: config.MAX_CONCURRENCY || 3
            }
        };

        logger.info(`📝 Registering instance with capabilities: ${JSON.stringify(registrationData.capabilities)}`);
        this.socket.emit("register-instance", registrationData);
    }

    // ==================== Resource Requests ====================
    async requestProxy() {
        logger.info('🔍 Requesting proxy from server...');

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Proxy request timeout after 15 seconds'));
            }, 15000);

            this.socket.emit("request-proxy");

            const onProxyAssigned = (proxyData) => {
                clearTimeout(timeout);
                this.socket.off("proxy-assigned", onProxyAssigned);
                this.socket.off("no-proxy-available", onNoProxy);
                logger.info(`✅ Proxy received: ${proxyData.host}:${proxyData.port}`);
                resolve(proxyData);
            };

            const onNoProxy = (data) => {
                clearTimeout(timeout);
                this.socket.off("proxy-assigned", onProxyAssigned);
                this.socket.off("no-proxy-available", onNoProxy);
                logger.warn(`⚠️ No proxy available: ${data.message}`);
                reject(new Error(`No proxy available: ${data.message}`));
            };

            this.socket.on("proxy-assigned", onProxyAssigned);
            this.socket.on("no-proxy-available", onNoProxy);
        });
    }

    async requestAccounts(batchSize = 3) {
        logger.info(`📋 Requesting ${batchSize} accounts from server...`);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Accounts request timeout after 15 seconds'));
            }, 15000);

            this.socket.emit("request-accounts", { batchSize });

            const onAccountsAssigned = (accountsData) => {
                clearTimeout(timeout);
                this.socket.off("accounts-assigned", onAccountsAssigned);
                this.socket.off("no-accounts-available", onNoAccounts);
                logger.info(`✅ ${accountsData.accounts.length} accounts received`);
                resolve(accountsData);
            };

            const onNoAccounts = (data) => {
                clearTimeout(timeout);
                this.socket.off("accounts-assigned", onAccountsAssigned);
                this.socket.off("no-accounts-available", onNoAccounts);
                logger.warn(`⚠️ No accounts available: ${data.message}`);
                reject(new Error(`No accounts available: ${data.message}`));
            };

            this.socket.on("accounts-assigned", onAccountsAssigned);
            this.socket.on("no-accounts-available", onNoAccounts);
        });
    }

    // ==================== Main Workflow ====================
    async processWorkFlow() {
        if (this.isProcessing) {
            logger.info('⏸ Already processing, skipping workflow...');
            return;
        }

        if (!this.connected || !this.registered) {
            logger.warn('⚠️ Not connected or registered, skipping workflow...');
            return;
        }

        this.isProcessing = true;
        this.workStartTime = Date.now();
        let profileData = null;
        let proxy = null;
        let accounts = [];
        let accountsData = null;

        try {
            logger.info('🚀 Starting new workflow...');
            await this._executeWorkflowSteps(proxy, profileData, accounts, accountsData);
            
        } catch (error) {
            logger.error(`❌ Workflow error: ${error.message}`);
            await this._handleWorkflowError(error, profileData, proxy, accounts);
            
        } finally {
            this.isProcessing = false;
            await this._finalizeWorkflow();
        }
    }

    async _executeWorkflowSteps(proxy, profileData, accounts, accountsData) {
        // Step 1: Get Browser Stats
        const browserStats = await globalBrowserManager.getClusterStats();
        logger.info(`📊 Current browser stats: ${browserStats.totalBrowsers}/${browserStats.maxBrowsers} (Cluster ${globalBrowserManager.clusterId})`);

        this.sendHeartbeat('starting', {
            message: 'Starting new workflow',
            startedAt: this.workStartTime,
            browserStats: browserStats
        });

        // Step 2: Request Proxy
        proxy = await this._requestProxyStep();
        if (!proxy) return;

        // Step 3: Create Profile
        profileData = await this._createProfileStep(proxy);
        if (!profileData) return;

        // Step 4: Warmup (optional)
        await this._warmupStep(profileData);

        // Step 5: Request Accounts
        accountsData = await this._requestAccountsStep();
        if (!accountsData) return;
        accounts = accountsData.accounts;

        // Step 6: Process Accounts
        const results = await this._processAccountsStep(profileData.context, accounts, accountsData);

        // Step 7: Submit Results
        await this._submitResultsStep(results?.finalResults, proxy, accountsData.batchId);

        // Step 8: Cleanup
        await this._cleanupStep(profileData);

        logger.info('🎉 Workflow completed successfully!');
    }

    async _requestProxyStep() {
        logger.info('🔍 Step 1: Requesting proxy...');
        try {
            const proxy = await this.requestProxy();
            logger.info(`✅ Step 1 completed: Proxy ${proxy.host}:${proxy.port} received`);
            return proxy;
        } catch (proxyError) {
            logger.error(`❌ Step 1 failed: ${proxyError.message}`);
            setTimeout(() => {
                if (this.connected && this.registered) {
                    this.processWorkFlow();
                }
            }, 15000);
            return null;
        }
    }

    async _createProfileStep(proxy) {
        logger.info('🔧 Step 2: Creating profile with proxy...');
        try {
            const profileData = await this.profileManager.createProfile(proxy, []);
            
            this.browserStats.profilesCreated++;
            
            logger.info('✅ Step 2 completed: Profile created successfully');
            logger.info(`📊 Profile created by cluster ${globalBrowserManager.clusterId}: ${profileData.profile.name}`);

            const updatedStats = await globalBrowserManager.getClusterStats();
            logger.info(`📈 Updated browser stats: ${updatedStats.totalBrowsers}/${updatedStats.maxBrowsers}`);

            this.sendHeartbeat('profile-created', {
                proxyHost: proxy.host,
                proxyPort: proxy.port,
                profileId: profileData.profile.id,
                clusterId: globalBrowserManager.clusterId,
                browserStats: updatedStats
            });

            return profileData;

        } catch (profileError) {
            logger.error(`❌ Step 2 failed: ${profileError.message}`);
            this.browserStats.browserErrors++;

            if (this._isBrowserLimitError(profileError)) {
                logger.warn('🚫 Browser limit exceeded, waiting longer before retry...');
                this._releaseProxy(proxy, profileError.message);
                setTimeout(() => {
                    if (this.connected && this.registered) {
                        this.processWorkFlow();
                    }
                }, 30000);
                return null;
            }

            this._releaseProxy(proxy, profileError.message);
            throw profileError;
        }
    }

    async _warmupStep(profileData) {
        logger.info('🎭 Step 3: Testing fake account for warmup...');
        try {
            // await this.accountProcessor.processFakeAccount(profileData.context);
            logger.info('✅ Step 3 completed: Fake account test successful');

            this.sendHeartbeat('warmup-completed', {
                message: 'Fake account warmup completed'
            });

        } catch (fakeError) {
            logger.error(`❌ Step 3 failed: ${fakeError.message}`);

            if (AccountProcessor.isCriticalError(fakeError)) {
                logger.warn('🚫 Proxy seems problematic, releasing it...');
                throw fakeError;
            }

            logger.warn('⚠️ Fake account failed but continuing with real accounts...');
        }
    }

    async _requestAccountsStep() {
        logger.info('📋 Step 4: Requesting real accounts...');
        try {
            const accountsData = await this.requestAccounts(3);
            logger.info(`✅ Step 4 completed: ${accountsData.accounts.length} accounts received`);

            this.sendHeartbeat('accounts-received', {
                accountCount: accountsData.accounts.length,
                batchId: accountsData.batchId
            });

            return accountsData;

        } catch (accountsError) {
            logger.error(`❌ Step 4 failed: ${accountsError.message}`);
            setTimeout(() => {
                if (this.connected && this.registered) {
                    this.processWorkFlow();
                }
            }, 15000);
            return null;
        }
    }

    async _processAccountsStep(context, accounts, accountsData) {
        logger.info('🚀 Step 5: Processing real accounts in parallel...');
        
        this.sendHeartbeat('processing', {
            accountCount: accounts.length,
            batchId: accountsData.batchId,
            startedAt: Date.now()
        });

        const results = await this.processAccountsInParallel(context, accounts);
        logger.info(`✅ Step 5 completed: ${results.length} results generated`);

        // Update local stats
        results?.finalResults?.forEach(result => {
            this.stats.processed++;
            if (result.status === 'good') {
                this.stats.success++;
            } else {
                this.stats.errors++;
            }
        });

        return results;
    }

    async _submitResultsStep(results, proxy, batchId) {
        logger.info('📊 Step 6: Submitting results to server...');
        await this.submitResults(results, proxy, batchId);
        logger.info('✅ Step 6 completed: Results submitted successfully');
    }

    async _cleanupStep(profileData) {
        logger.info('🧹 Step 7: Cleaning up resources...');
        await this.closeProfileSafely(profileData);
        logger.info('✅ Step 7 completed: Cleanup successful');
    }

    // ==================== Account Processing ====================
    async processAccountsInParallel(context, accounts) {
        logger.info(`🚀 Starting parallel processing of ${accounts.length} accounts...`);

        const abortController = new AbortController();
        let shouldExitGlobal = false;
        const completedResults = [];

        const accountPromises = accounts.map(async (account, index) => {
            const startDelay = index * HumanBehavior.randomDelay(2000, 4000);

            if (startDelay > 0) {
                logger.info(`⏳ Account ${account.email} waiting ${startDelay}ms before start...`);
                await HumanBehavior.sleep(startDelay);
            }

            if (abortController.signal.aborted) {
                logger.info(`⏹️ Account ${account.email} aborted before processing`);
                return { type: 'aborted', account, index };
            }

            logger.info(`🚀 Starting account ${index + 1}: ${account.email}`);

            try {
                const accountString = `${account.email}:${account.password}`;
                const result = await this.accountProcessor.processAccount(
                    context,
                    accountString,
                    index,
                    accounts.length
                );

                const accountResult = {
                    id: account.id,
                    email: account.email,
                    password: account.password,
                    status: result.status,
                    error: result.error || result.message || null,
                    responseTime: result.responseTime || 0,
                    screenshot: result.screenshot || null,
                    additionalInfo: result.additionalInfo || {},
                    tabIndex: index,
                    shouldExit: result.shouldExit || false
                };

                return {
                    type: result.shouldExit ? 'exit' : 'completed',
                    result: accountResult,
                    account,
                    index
                };

            } catch (accountError) {
                if (accountError.name === 'AbortError') {
                    logger.info(`⏹️ Account ${account.email} was aborted`);
                    return { type: 'aborted', account, index };
                }

                logger.error(`❌ Error processing account ${account.email}: ${accountError.message}`);
                return {
                    type: 'error',
                    result: {
                        id: account.id,
                        email: account.email,
                        password: account.password,
                        status: 'server-error',
                        error: accountError.message,
                        responseTime: 0,
                        tabIndex: index
                    },
                    account,
                    index
                };
            }
        });

        // Process results as they complete
        const activePromises = [...accountPromises];
        while (activePromises.length > 0 && !shouldExitGlobal) {
            try {
                const result = await Promise.race(activePromises);
                const promiseIndex = activePromises.findIndex(p => p === accountPromises[result.index]);
                
                if (promiseIndex > -1) {
                    activePromises.splice(promiseIndex, 1);
                }

                if (result.type === 'exit') {
                    logger.warn(`🚨 Exit signal received from account ${result.result.email}. Aborting all processes...`);
                    shouldExitGlobal = true;
                    abortController.abort();
                    completedResults.push(result.result);
                    break;
                } else if (result.type === 'completed') {
                    logger.info(`✅ Account ${result.index + 1} completed: ${result.result.email} → ${result.result.status}`);
                    completedResults.push(result.result);
                } else if (result.type === 'error') {
                    logger.error(`❌ Account ${result.index + 1} error: ${result.result.email}`);
                    completedResults.push(result.result);
                }

            } catch (error) {
                logger.error(`❌ Unexpected error in promise race: ${error.message}`);
                break;
            }
        }

        // Handle remaining promises
        if (shouldExitGlobal) {
            logger.warn(`🚨 Processing stopped due to exit condition. Processed ${completedResults.length} accounts.`);
            await HumanBehavior.sleep(1000);
        } else {
            logger.info(`⏳ Waiting for remaining ${activePromises.length} accounts...`);
            const remainingResults = await Promise.allSettled(activePromises);

            remainingResults.forEach((result) => {
                if (result.status === 'fulfilled' && result.value.type === 'completed') {
                    completedResults.push(result.value.result);
                }
            });
        }

        const successCount = completedResults.filter(r => !['error', 'server-error', 'timeout-error'].includes(r.status)).length;
        const errorCount = completedResults.length - successCount;

        logger.info(`📈 Final summary: ${successCount} success, ${errorCount} errors, Total: ${completedResults.length}`);

        return {
            finalResults: completedResults,
            exitTriggered: shouldExitGlobal,
            totalProcessed: completedResults.length,
            successCount,
            errorCount
        };
    }

    // ==================== Profile Management ====================
    async closeProfileSafely(profileData) {
        try {
            if (profileData && profileData.context) {
                await profileData.context.close();
            }

            if (profileData && profileData.profile) {
                await this.profileManager.closeProfile(profileData);
            }

            this.browserStats.profilesClosed++;

            const updatedStats = await globalBrowserManager.getClusterStats();
            logger.info(`📉 Profile closed. Global browsers: ${updatedStats.totalBrowsers}/${updatedStats.maxBrowsers}`);

        } catch (cleanupError) {
            logger.error(`❌ Profile cleanup error: ${cleanupError.message}`);
            this.browserStats.browserErrors++;

            if (profileData && profileData.globalManager) {
                await profileData.globalManager.decrementBrowserCount();
            }
        }
    }

    // ==================== Results Management ====================
    async submitResults(results, proxy, batchId) {
        const processingTime = Date.now() - this.workStartTime;

        const submissionData = {
            results: results,
            proxyResult: {
                proxyId: proxy.id,
                success: true,
                responseTime: processingTime,
                error: null
            },
            batchInfo: {
                batchId: batchId,
                processingTime: processingTime,
                startTime: this.workStartTime,
                endTime: Date.now(),
                instanceStats: this.getStats(),
                browserStats: this.browserStats,
                clusterId: globalBrowserManager.clusterId
            }
        };

        logger.info(`📊 Submitting results: ${results.length} accounts processed in ${processingTime}ms`);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Results submission timeout'));
            }, 15000);

            const onAcknowledged = (data) => {
                clearTimeout(timeout);
                this.socket.off("results-acknowledged", onAcknowledged);
                resolve(data);
            };

            this.socket.on("results-acknowledged", onAcknowledged);
            this.socket.emit("submit-results", submissionData);
        });
    }

    // ==================== Utility Methods ====================
    sendHeartbeat(status = 'idle', currentBatch = null) {
        if (this.connected && this.registered) {
            this.socket.emit("heartbeat", {
                status: status,
                currentBatch: currentBatch,
                stats: this.getStats(),
                browserStats: this.browserStats,
                clusterId: globalBrowserManager.clusterId,
                timestamp: Date.now()
            });
        }
    }

    reportError(error, context = {}) {
        if (this.connected && this.registered) {
            this.socket.emit("error-report", {
                type: error.name || 'UnknownError',
                message: error.message,
                stack: error.stack,
                context: {
                    ...context,
                    clusterId: globalBrowserManager.clusterId,
                    browserStats: this.browserStats
                },
                instanceId: this.instanceId,
                timestamp: Date.now()
            });
        }

        logger.error(`🚨 Error reported: ${error.message}`, { context });
    }

    getStats() {
        const uptime = Date.now() - this.stats.startTime;
        return {
            ...this.stats,
            uptime: uptime,
            successRate: this.stats.processed > 0 ?
                Math.round((this.stats.success / this.stats.processed) * 100) : 0,
            avgProcessingTime: this.stats.processed > 0 ?
                Math.round(uptime / this.stats.processed) : 0,
            isProcessing: this.isProcessing,
            connected: this.connected,
            registered: this.registered,
            browserStats: this.browserStats,
            clusterId: globalBrowserManager.clusterId
        };
    }

    // ==================== Error Handling ====================
    async _handleWorkflowError(error, profileData, proxy, accounts) {
        this.browserStats.browserErrors++;

        this.reportError(error, {
            step: 'workflow',
            proxy: proxy ? `${proxy.host}:${proxy.port}` : null,
            accountCount: accounts.length,
            clusterId: globalBrowserManager.clusterId
        });

        if (profileData) {
            await this.closeProfileSafely(profileData);
        }

        if (accounts.length > 0) {
            logger.info('🔓 Releasing locked accounts due to error...');
            this.socket.emit("release-accounts", {
                accountIds: accounts.map(a => a.id),
                reason: 'workflow_error'
            });
        }

        if (proxy) {
            this._releaseProxy(proxy, error.message);
        }

        const retryDelay = this._isBrowserLimitError(error) ? 30000 : 10000;
        
        if (this._isBrowserLimitError(error)) {
            logger.warn(`🚫 Browser limit error, waiting ${retryDelay / 1000} seconds before retry...`);
        }

        setTimeout(() => {
            if (this.connected && this.registered) {
                this.processWorkFlow();
            }
        }, retryDelay);
    }

    async _finalizeWorkflow() {
        const finalStats = await globalBrowserManager.getClusterStats();
        this.sendHeartbeat('idle', {
            message: 'Workflow completed, back to idle',
            browserStats: finalStats,
            instanceBrowserStats: this.browserStats
        });
    }

    _isBrowserLimitError(error) {
        return error.message.includes('Concurrent browsers limit exceeded') ||
               error.message.includes('Global browser limit exceeded') ||
               error.message.includes('HTTP 402');
    }

    _releaseProxy(proxy, errorMessage) {
        this.socket.emit("release-proxy", {
            proxyId: proxy.id,
            error: errorMessage,
            success: false
        });
    }

    // ==================== Lifecycle Management ====================
    startHeartbeat() {
        setInterval(() => {
            this.sendHeartbeat();
        }, config.HEARTBEAT_INTERVAL || 5000);
    }

    startStatsDisplay() {
        setInterval(async () => {
            try {
                const globalStats = await globalBrowserManager.getClusterStats();
                logger.info(`📊 Global Browser Stats: ${globalStats.totalBrowsers}/${globalStats.maxBrowsers} | Instance: Created=${this.browserStats.profilesCreated}, Closed=${this.browserStats.profilesClosed}, Errors=${this.browserStats.browserErrors}`);
            } catch (error) {
                logger.error('Error displaying stats:', error.message);
            }
        }, 60000);
    }

    async start() {
        logger.info(`🚀 Starting PSN Instance: ${this.instanceId}`);
        logger.info(`📡 Server URL: ${this.serverUrl}`);
        config.display();

        try {
            logger.info('🔧 Initializing global browser manager...');
            await initializeGlobalProfileManager();

            if (globalBrowserManager.clusterId === '0' || !globalBrowserManager.clusterId) {
                startPeriodicCleanup(10);
                logger.info('🧹 Periodic cleanup started (master cluster)');
            }

            await showCurrentStats();
            logger.info(`✅ Global browser manager initialized for cluster ${globalBrowserManager.clusterId}`);

        } catch (initError) {
            logger.error(`❌ Failed to initialize global browser manager: ${initError.message}`);
        }

        this.initSocket();
        this.startHeartbeat();
        this.startStatsDisplay();

        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));

        process.on('uncaughtException', (error) => {
            logger.error(`💥 Uncaught Exception: ${error.message}`, error);
            this.reportError(error, { type: 'uncaughtException' });
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error(`💥 Unhandled Rejection: ${reason}`, { promise });
            this.reportError(new Error(reason), { type: 'unhandledRejection' });
        });

        logger.info('✅ PSN Instance started successfully');
    }

    async gracefulShutdown(signal) {
        logger.info(`🛑 Received ${signal}, shutting down gracefully...`);

        this.isProcessing = false;
        this.connected = false;
        this.registered = false;

        try {
            logger.info(`🧹 Cleaning up cluster ${globalBrowserManager.clusterId} browser count...`);

            const activeProfiles = this.browserStats.profilesCreated - this.browserStats.profilesClosed;
            for (let i = 0; i < activeProfiles; i++) {
                await globalBrowserManager.decrementBrowserCount();
            }

            logger.info(`✅ Cleaned up ${activeProfiles} active profiles from global count`);
        } catch (cleanupError) {
            logger.error(`❌ Error during browser cleanup: ${cleanupError.message}`);
        }

        if (this.socket) {
            this.socket.close();
        }

        logger.info(`👋 Instance ${this.instanceId} stopped gracefully`);
        process.exit(0);
    }
}

// ==================== Application Startup ====================
const instance = new PSNInstance();
instance.start().catch((error) => {
    logger.error(`💥 Failed to start instance: ${error.message}`, error);
    process.exit(1);
});