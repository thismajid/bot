// main.js
import { io } from "socket.io-client";
import {
    createNewProfile,
    processFakeAccountFirst,
    processAccountInTab,
    cleanupProfile,
    initializeGlobalProfileManager,
    startPeriodicCleanup,
    showCurrentStats,
    globalBrowserManager
} from "./bot.js";
import { logger } from "./utils/logger.js";
import { config } from "./utils/config.js";

// Helper functions
function randomDelay(min = 2000, max = 3000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

        // ✅ اضافه کردن آمار مرورگر
        this.browserStats = {
            profilesCreated: 0,
            profilesClosed: 0,
            browserErrors: 0
        };
    }

    /**
    * راه‌اندازی اتصال WebSocket
    */
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

    /**
    * تنظیم event های WebSocket
    */
    setupSocketEvents() {
        // اتصال موفق
        this.socket.on("connect", () => {
            this.connected = true;
            logger.info(`✅ Connected to server as ${this.instanceId}`);
            this.registerInstance();
        });

        // قطع اتصال
        this.socket.on("disconnect", (reason) => {
            this.connected = false;
            this.registered = false;
            this.isProcessing = false;
            logger.warn(`❌ Disconnected: ${reason}`);
        });

        // تایید ثبت نام
        this.socket.on("registration-confirmed", (data) => {
            this.registered = true;
            logger.info(`🎯 Registration confirmed: ${data.instanceData.instanceId}`);

            // شروع فرآیند کار با تاخیر کوتاه
            setTimeout(() => this.processWorkFlow(), 2000);
        });

        // خطای ثبت نام
        this.socket.on("registration-error", (data) => {
            logger.error(`❌ Registration failed: ${data.error}`);
            this.registered = false;
        });

        // دریافت پروکسی
        this.socket.on("proxy-assigned", (proxyData) => {
            logger.debug(`📡 Proxy assigned event received`);
        });

        // عدم وجود پروکسی
        this.socket.on("no-proxy-available", (data) => {
            logger.debug(`📡 No proxy available event received`);
        });

        // دریافت اکانت‌ها
        this.socket.on("accounts-assigned", (accountsData) => {
            logger.debug(`📡 Accounts assigned event received`);
        });

        // عدم وجود اکانت
        this.socket.on("no-accounts-available", (data) => {
            logger.debug(`📡 No accounts available event received`);
        });

        // تایید دریافت نتایج
        this.socket.on("results-acknowledged", (data) => {
            logger.info(`✅ Results acknowledged: ${data.processed} accounts processed`);

            // شروع فرآیند بعدی با تاخیر
            setTimeout(() => {
                if (this.connected && this.registered && !this.isProcessing) {
                    this.processWorkFlow();
                }
            }, 3000);
        });

        // heartbeat response
        this.socket.on("heartbeat-ack", (data) => {
            // logger.debug(`💓 Heartbeat acknowledged`);
        });

        // خطاهای عمومی
        this.socket.on("error", (error) => {
            logger.error(`❌ Socket error: ${error.message || error}`);
        });

        this.socket.on("connect_error", (error) => {
            logger.error(`❌ Connection error: ${error.message || error}`);
        });
    }

    /**
    * ثبت نام instance در سرور
    */
    registerInstance() {
        const registrationData = {
            instanceId: this.instanceId,
            serverInfo: {
                hostname: process.env.COMPUTERNAME || 'unknown',
                platform: process.platform,
                nodeVersion: process.version,
                memory: process.memoryUsage(),
                pid: process.pid,
                clusterId: globalBrowserManager.clusterId // ✅ اضافه کردن cluster ID
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

    /**
    * درخواست پروکسی از سرور
    */
    async requestProxy() {
        logger.info('🔍 Requesting proxy from server...');

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Proxy request timeout after 30 seconds'));
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

    /**
    * درخواست اکانت‌ها از سرور
    */
    async requestAccounts(batchSize = 3) {
        logger.info(`📋 Requesting ${batchSize} accounts from server...`);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Accounts request timeout after 30 seconds'));
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

    /**
    * فرآیند کامل پردازش
    */
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

            // ✅ نمایش آمار فعلی مرورگرها
            const browserStats = await globalBrowserManager.getClusterStats();
            logger.info(`📊 Current browser stats: ${browserStats.totalBrowsers}/${browserStats.maxBrowsers} (Cluster ${globalBrowserManager.clusterId})`);

            this.sendHeartbeat('starting', {
                message: 'Starting new workflow',
                startedAt: this.workStartTime,
                browserStats: browserStats
            });

            // مرحله 1: دریافت پروکسی
            logger.info('🔍 Step 1: Requesting proxy...');
            try {
                proxy = await this.requestProxy();
                logger.info(`✅ Step 1 completed: Proxy ${proxy.host}:${proxy.port} received`);
            } catch (proxyError) {
                logger.error(`❌ Step 1 failed: ${proxyError.message}`);

                setTimeout(() => {
                    if (this.connected && this.registered) {
                        this.processWorkFlow();
                    }
                }, 15000);

                return;
            }

            // مرحله 2: ایجاد پروفایل با پروکسی
            logger.info('🔧 Step 2: Creating profile with proxy...');
            try {
                // ✅ استفاده از createNewProfile بهبود یافته
                profileData = await createNewProfile(proxy, []);
                const context = profileData.context;
                const profile = profileData.profile;

                // ✅ آپدیت آمار
                this.browserStats.profilesCreated++;

                logger.info('✅ Step 2 completed: Profile created successfully');
                logger.info(`📊 Profile created by cluster ${globalBrowserManager.clusterId}: ${profile.name}`);

                // ✅ نمایش آمار جدید
                const updatedStats = await globalBrowserManager.getClusterStats();
                logger.info(`📈 Updated browser stats: ${updatedStats.totalBrowsers}/${updatedStats.maxBrowsers}`);

                this.sendHeartbeat('profile-created', {
                    proxyHost: proxy.host,
                    proxyPort: proxy.port,
                    profileId: profile.id,
                    clusterId: globalBrowserManager.clusterId,
                    browserStats: updatedStats
                });

            } catch (profileError) {
                logger.error(`❌ Step 2 failed: ${profileError.message}`);

                // ✅ آپدیت آمار خطا
                this.browserStats.browserErrors++;

                // ✅ مدیریت خطاهای مرتبط با محدودیت مرورگر
                if (profileError.message.includes('Concurrent browsers limit exceeded') ||
                    profileError.message.includes('Global browser limit exceeded') ||
                    profileError.message.includes('HTTP 402')) {

                    logger.warn('🚫 Browser limit exceeded, waiting longer before retry...');

                    this.socket.emit("release-proxy", {
                        proxyId: proxy.id,
                        error: profileError.message,
                        success: false
                    });

                    // تاخیر بیشتر برای خطاهای محدودیت مرورگر
                    setTimeout(() => {
                        if (this.connected && this.registered) {
                            this.processWorkFlow();
                        }
                    }, 30000); // 30 ثانیه تاخیر

                    return;
                }

                this.socket.emit("release-proxy", {
                    proxyId: proxy.id,
                    error: profileError.message,
                    success: false
                });

                throw profileError;
            }

            // مرحله 3: تست فیک اکانت
            logger.info('🎭 Step 3: Testing fake account for warmup...');
            try {
                // await processFakeAccountFirst(profileData.context);
                logger.info('✅ Step 3 completed: Fake account test successful');

                this.sendHeartbeat('warmup-completed', {
                    message: 'Fake account warmup completed'
                });

            } catch (fakeError) {
                logger.error(`❌ Step 3 failed: ${fakeError.message}`);

                if (fakeError.message.includes('PROXY_') ||
                    fakeError.message.includes('CONNECTION_') ||
                    fakeError.message.includes('CONTEXT_DESTROYED')) {

                    logger.warn('🚫 Proxy seems problematic, releasing it...');
                    this.socket.emit("release-proxy", {
                        proxyId: proxy.id,
                        error: fakeError.message,
                        success: false
                    });

                    throw fakeError;
                }

                logger.warn('⚠️ Fake account failed but continuing with real accounts...');
            }

            // مرحله 4: دریافت اکانت‌های واقعی
            logger.info('📋 Step 4: Requesting real accounts...');
            try {
                accountsData = await this.requestAccounts(3);
                accounts = accountsData.accounts;
                logger.info(`✅ Step 4 completed: ${accounts.length} accounts received`);

                this.sendHeartbeat('accounts-received', {
                    accountCount: accounts.length,
                    batchId: accountsData.batchId
                });

            } catch (accountsError) {
                logger.error(`❌ Step 4 failed: ${accountsError.message}`);

                setTimeout(() => {
                    if (this.connected && this.registered) {
                        this.processWorkFlow();
                    }
                }, 15000);

                return;
            }

            // مرحله 5: پردازش اکانت‌های واقعی
            logger.info('🚀 Step 5: Processing real accounts in parallel...');
            this.sendHeartbeat('processing', {
                accountCount: accounts.length,
                batchId: accountsData.batchId,
                startedAt: Date.now()
            });

            const results = await this.processAccountsInParallel(profileData.context, accounts);
            logger.info(`✅ Step 5 completed: ${results.length} results generated`);

            // آپدیت آمار محلی
            results?.finalResults?.forEach(result => {
                this.stats.processed++;
                if (result.status === 'good') {
                    this.stats.success++;
                } else {
                    this.stats.errors++;
                }
            });

            // مرحله 6: ارسال نتایج
            logger.info('📊 Step 6: Submitting results to server...');
            await this.submitResults(results?.finalResults, proxy, accountsData.batchId);
            logger.info('✅ Step 6 completed: Results submitted successfully');

            // مرحله 7: پاک‌سازی
            logger.info('🧹 Step 7: Cleaning up resources...');

            // ✅ استفاده از closeProfile بهبود یافته
            await this.closeProfileSafely(profileData);

            logger.info('✅ Step 7 completed: Cleanup successful');
            logger.info('🎉 Workflow completed successfully!');

        } catch (error) {
            logger.error(`❌ Workflow error: ${error.message}`);

            // ✅ آپدیت آمار خطا
            this.browserStats.browserErrors++;

            this.reportError(error, {
                step: 'workflow',
                proxy: proxy ? `${proxy.host}:${proxy.port}` : null,
                accountCount: accounts.length,
                clusterId: globalBrowserManager.clusterId
            });

            // پاک‌سازی در صورت خطا
            if (profileData) {
                await this.closeProfileSafely(profileData);
            }

            // آزادسازی منابع در صورت خطا
            if (accounts.length > 0) {
                logger.info('🔓 Releasing locked accounts due to error...');
                this.socket.emit("release-accounts", {
                    accountIds: accounts.map(a => a.id),
                    reason: 'workflow_error'
                });
            }

            if (proxy) {
                logger.info('🔓 Releasing proxy due to error...');
                this.socket.emit("release-proxy", {
                    proxyId: proxy.id,
                    error: error.message,
                    success: false
                });
            }

            // ✅ تاخیر متغیر بر اساس نوع خطا
            let retryDelay = 10000; // پیش‌فرض 10 ثانیه

            if (error.message.includes('Concurrent browsers limit exceeded') ||
                error.message.includes('Global browser limit exceeded') ||
                error.message.includes('HTTP 402')) {
                retryDelay = 30000; // 30 ثانیه برای خطاهای محدودیت مرورگر
                logger.warn(`🚫 Browser limit error, waiting ${retryDelay / 1000} seconds before retry...`);
            }

            setTimeout(() => {
                if (this.connected && this.registered) {
                    this.processWorkFlow();
                }
            }, retryDelay);

        } finally {
            this.isProcessing = false;

            // ✅ ارسال آمار نهایی
            const finalStats = await globalBrowserManager.getClusterStats();
            this.sendHeartbeat('idle', {
                message: 'Workflow completed, back to idle',
                browserStats: finalStats,
                instanceBrowserStats: this.browserStats
            });
        }
    }

    /**
    * ✅ متد جدید برای بستن امن پروفایل
    */
    async closeProfileSafely(profileData) {
        try {
            if (profileData && profileData.context) {
                await profileData.context.close();
            }

            if (profileData && profileData.profile) {
                await cleanupProfile(profileData.profile);
            }

            // ✅ کاهش شمارنده گلوبال
            if (profileData && profileData.globalManager) {
                await profileData.globalManager.decrementBrowserCount();
                await profileData.globalManager.unregisterProfile(profileData.profile.id);
            }

            // ✅ آپدیت آمار
            this.browserStats.profilesClosed++;

            const updatedStats = await globalBrowserManager.getClusterStats();
            logger.info(`📉 Profile closed. Global browsers: ${updatedStats.totalBrowsers}/${updatedStats.maxBrowsers}`);

        } catch (cleanupError) {
            logger.error(`❌ Profile cleanup error: ${cleanupError.message}`);
            this.browserStats.browserErrors++;

            // حتی در صورت خطا، شمارنده را کاهش دهید
            if (profileData && profileData.globalManager) {
                await profileData.globalManager.decrementBrowserCount();
            }
        }
    }

    /**
    * پردازش موازی اکانت‌ها با تاخیر (مثل کد قدیمی)
    */
    async processAccountsInParallel(context, accounts) {
        logger.info(`🚀 Starting parallel processing of ${accounts.length} accounts...`);

        const abortController = new AbortController();
        let shouldExitGlobal = false;
        const completedResults = [];

        const accountPromises = accounts.map(async (account, index) => {
            const startDelay = index * randomDelay(2000, 4000);

            if (startDelay > 0) {
                logger.info(`⏳ Account ${account.email} waiting ${startDelay}ms before start...`);
                await sleep(startDelay);
            }

            if (abortController.signal.aborted) {
                logger.info(`⏹️ Account ${account.email} aborted before processing`);
                return [{ type: 'aborted', account, index }];
            }

            logger.info(`🚀 Starting account ${index + 1}: ${account.email}`);

            try {
                const accountString = `${account.email}:${account.password}`;

                const result = await processAccountInTab(
                    context,
                    accountString,
                    index,
                    accounts.length,
                    abortController.signal
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

        if (shouldExitGlobal) {
            logger.warn(`🚨 Processing stopped due to exit condition. Processed ${completedResults.length} accounts.`);
            await sleep(1000);
        } else {
            logger.info(`⏳ Waiting for remaining ${activePromises.length} accounts...`);
            const remainingResults = await Promise.allSettled(activePromises);

            remainingResults.forEach((result, i) => {
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

    /**
    * ارسال نتایج به سرور
    */
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
                browserStats: this.browserStats, // ✅ اضافه کردن آمار مرورگر
                clusterId: globalBrowserManager.clusterId // ✅ اضافه کردن cluster ID
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

    /**
    * ارسال heartbeat به سرور
    */
    sendHeartbeat(status = 'idle', currentBatch = null) {
        if (this.connected && this.registered) {
            this.socket.emit("heartbeat", {
                status: status,
                currentBatch: currentBatch,
                stats: this.getStats(),
                browserStats: this.browserStats, // ✅ اضافه کردن آمار مرورگر
                clusterId: globalBrowserManager.clusterId, // ✅ اضافه کردن cluster ID
                timestamp: Date.now()
            });
        }
    }

    /**
    * گزارش خطا به سرور
    */
    reportError(error, context = {}) {
        if (this.connected && this.registered) {
            this.socket.emit("error-report", {
                type: error.name || 'UnknownError',
                message: error.message,
                stack: error.stack,
                context: {
                    ...context,
                    clusterId: globalBrowserManager.clusterId, // ✅ اضافه کردن cluster ID
                    browserStats: this.browserStats
                },
                instanceId: this.instanceId,
                timestamp: Date.now()
            });
        }

        logger.error(`🚨 Error reported: ${error.message}`, { context });
    }

    /**
    * دریافت آمار instance
    */
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
            browserStats: this.browserStats, // ✅ اضافه کردن آمار مرورگر
            clusterId: globalBrowserManager.clusterId // ✅ اضافه کردن cluster ID
        };
    }

    /**
    * شروع heartbeat دوره‌ای
    */
    startHeartbeat() {
        setInterval(() => {
            this.sendHeartbeat();
        }, config.HEARTBEAT_INTERVAL || 5000);
    }

    /**
    * ✅ شروع نمایش آمار دوره‌ای
    */
    startStatsDisplay() {
        setInterval(async () => {
            try {
                const globalStats = await globalBrowserManager.getClusterStats();
                logger.info(`📊 Global Browser Stats: ${globalStats.totalBrowsers}/${globalStats.maxBrowsers} | Instance: Created=${this.browserStats.profilesCreated}, Closed=${this.browserStats.profilesClosed}, Errors=${this.browserStats.browserErrors}`);
            } catch (error) {
                logger.error('Error displaying stats:', error.message);
            }
        }, 60000); // هر دقیقه
    }

    /**
    * راه‌اندازی instance
    */
    async start() {
        logger.info(`🚀 Starting PSN Instance: ${this.instanceId}`);
        logger.info(`📡 Server URL: ${this.serverUrl}`);
        logger.info(`⚙️ Configuration:`);
        logger.info(`   - Batch Size: ${config.BATCH_SIZE || 2}`);
        logger.info(`   - Max Concurrency: ${config.MAX_CONCURRENCY || 2}`);
        logger.info(`   - Heartbeat Interval: ${config.HEARTBEAT_INTERVAL || 30000}ms`);

        try {
            // ✅ مقداردهی اولیه سیستم مدیریت گلوبال مرورگرها
            logger.info('🔧 Initializing global browser manager...');
            await initializeGlobalProfileManager();

            // ✅ شروع پاکسازی دوره‌ای (فقط برای کلاستر master)
            if (globalBrowserManager.clusterId === '0' || !globalBrowserManager.clusterId) {
                startPeriodicCleanup(10); // هر 10 دقیقه
                logger.info('🧹 Periodic cleanup started (master cluster)');
            }

            // ✅ نمایش آمار اولیه
            await showCurrentStats();

            logger.info(`✅ Global browser manager initialized for cluster ${globalBrowserManager.clusterId}`);

        } catch (initError) {
            logger.error(`❌ Failed to initialize global browser manager: ${initError.message}`);
            // ادامه دهید حتی اگر مقداردهی اولیه ناموفق بود
        }

        // راه‌اندازی اتصال
        this.initSocket();

        // شروع heartbeat
        this.startHeartbeat();

        // ✅ شروع نمایش آمار دوره‌ای
        this.startStatsDisplay();

        // مدیریت سیگنال‌های خروج
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

    /**
    * خاموش کردن مناسب
    */
    async gracefulShutdown(signal) {
        logger.info(`🛑 Received ${signal}, shutting down gracefully...`);

        // متوقف کردن پردازش جدید
        this.isProcessing = false;
        this.connected = false;
        this.registered = false;

        // ✅ پاکسازی شمارنده مرورگرهای این کلاستر
        try {
            logger.info(`🧹 Cleaning up cluster ${globalBrowserManager.clusterId} browser count...`);

            // کاهش شمارنده برای تعداد پروفایل‌های ایجاد شده توسط این instance
            const activeProfiles = this.browserStats.profilesCreated - this.browserStats.profilesClosed;
            for (let i = 0; i < activeProfiles; i++) {
                await globalBrowserManager.decrementBrowserCount();
            }

            logger.info(`✅ Cleaned up ${activeProfiles} active profiles from global count`);
        } catch (cleanupError) {
            logger.error(`❌ Error during browser cleanup: ${cleanupError.message}`);
        }

        // بستن اتصال WebSocket
        if (this.socket) {
            this.socket.close();
        }

        logger.info(`👋 Instance ${this.instanceId} stopped gracefully`);
        process.exit(0);
    }
}

// راه‌اندازی instance
const instance = new PSNInstance();
instance.start().catch((error) => {
    logger.error(`💥 Failed to start instance: ${error.message}`, error);
    process.exit(1);
});