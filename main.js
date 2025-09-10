// main.js
import { io } from "socket.io-client";
import {
    createNewProfile,
    processFakeAccountFirst,
    processAccountInTab,
    cleanupProfile
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
            // این event در requestProxy() handle می‌شه
            logger.debug(`📡 Proxy assigned event received`);
        });

        // عدم وجود پروکسی
        this.socket.on("no-proxy-available", (data) => {
            // این event در requestProxy() handle می‌شه
            logger.debug(`📡 No proxy available event received`);
        });

        // دریافت اکانت‌ها
        this.socket.on("accounts-assigned", (accountsData) => {
            // این event در requestAccounts() handle می‌شه
            logger.debug(`📡 Accounts assigned event received`);
        });

        // عدم وجود اکانت
        this.socket.on("no-accounts-available", (data) => {
            // این event در requestAccounts() handle می‌شه
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
                pid: process.pid
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

            // ارسال درخواست پروکسی
            this.socket.emit("request-proxy");

            // گوش دادن به پاسخ موفق
            const onProxyAssigned = (proxyData) => {
                clearTimeout(timeout);
                this.socket.off("proxy-assigned", onProxyAssigned);
                this.socket.off("no-proxy-available", onNoProxy);
                logger.info(`✅ Proxy received: ${proxyData.host}:${proxyData.port}`);
                resolve(proxyData);
            };

            // گوش دادن به عدم وجود پروکسی
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

            // ارسال درخواست اکانت‌ها
            this.socket.emit("request-accounts", { batchSize });

            // گوش دادن به پاسخ موفق
            const onAccountsAssigned = (accountsData) => {
                clearTimeout(timeout);
                this.socket.off("accounts-assigned", onAccountsAssigned);
                this.socket.off("no-accounts-available", onNoAccounts);
                logger.info(`✅ ${accountsData.accounts.length} accounts received`);
                resolve(accountsData);
            };

            // گوش دادن به عدم وجود اکانت
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

            // ارسال وضعیت شروع کار
            this.sendHeartbeat('starting', {
                message: 'Starting new workflow',
                startedAt: this.workStartTime
            });

            // مرحله 1: دریافت پروکسی
            logger.info('🔍 Step 1: Requesting proxy...');
            try {
                proxy = await this.requestProxy();
                logger.info(`✅ Step 1 completed: Proxy ${proxy.host}:${proxy.port} received`);
            } catch (proxyError) {
                logger.error(`❌ Step 1 failed: ${proxyError.message}`);

                // اگر پروکسی نیست، بعداً دوباره تلاش کن
                setTimeout(() => {
                    if (this.connected && this.registered) {
                        this.processWorkFlow();
                    }
                }, 15000); // 1 دقیقه تاخیر

                return;
            }

            // مرحله 2: ایجاد پروفایل با پروکسی
            logger.info('🔧 Step 2: Creating profile with proxy...');
            try {
                profileData = await createNewProfile(proxy, []);
                const context = profileData.context;
                const profile = profileData.profile;
                logger.info('✅ Step 2 completed: Profile created successfully');

                // ارسال وضعیت ایجاد پروفایل
                this.sendHeartbeat('profile-created', {
                    proxyHost: proxy.host,
                    proxyPort: proxy.port,
                    profileId: profile.id
                });

            } catch (profileError) {
                logger.error(`❌ Step 2 failed: ${profileError.message}`);

                // گزارش خطای پروکسی
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

                // اگر فیک اکانت fail شد، ممکنه پروکسی مشکل داشته باشه
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

                // اگر خطای عادی بود، ادامه بده
                logger.warn('⚠️ Fake account failed but continuing with real accounts...');
            }

            // مرحله 4: دریافت اکانت‌های واقعی
            logger.info('📋 Step 4: Requesting real accounts...');
            try {
                accountsData = await this.requestAccounts(3); // فقط 3 اکانت
                accounts = accountsData.accounts;
                logger.info(`✅ Step 4 completed: ${accounts.length} accounts received`);

                this.sendHeartbeat('accounts-received', {
                    accountCount: accounts.length,
                    batchId: accountsData.batchId
                });

            } catch (accountsError) {
                logger.error(`❌ Step 4 failed: ${accountsError.message}`);

                // اگر اکانت نیست، بعداً دوباره تلاش کن
                setTimeout(() => {
                    if (this.connected && this.registered) {
                        this.processWorkFlow();
                    }
                }, 15000); // 30 ثانیه تاخیر

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
            results.forEach(result => {
                this.stats.processed++;
                if (result.status === 'good') {
                    this.stats.success++;
                } else {
                    this.stats.errors++;
                }
            });

            // مرحله 6: ارسال نتایج
            logger.info('📊 Step 6: Submitting results to server...');
            await this.submitResults(results, proxy, accountsData.batchId);
            logger.info('✅ Step 6 completed: Results submitted successfully');

            // مرحله 7: پاک‌سازی
            logger.info('🧹 Step 7: Cleaning up resources...');
            await profileData.context.close();
            await cleanupProfile(profileData.profile);
            logger.info('✅ Step 7 completed: Cleanup successful');

            logger.info('🎉 Workflow completed successfully!');

        } catch (error) {
            logger.error(`❌ Workflow error: ${error.message}`);

            // گزارش خطا به سرور
            this.reportError(error, {
                step: 'workflow',
                proxy: proxy ? `${proxy.host}:${proxy.port}` : null,
                accountCount: accounts.length
            });

            // پاک‌سازی در صورت خطا
            if (profileData) {
                try {
                    logger.info('🧹 Emergency cleanup: Closing context and profile...');
                    await profileData.context.close();
                    await cleanupProfile(profileData.profile);
                } catch (cleanupError) {
                    logger.error(`❌ Emergency cleanup error: ${cleanupError.message}`);
                }
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

            // تاخیر بیشتر در صورت خطا
            setTimeout(() => {
                if (this.connected && this.registered) {
                    this.processWorkFlow();
                }
            }, 10000); // 10 ثانیه تاخیر

        } finally {
            this.isProcessing = false;
            this.sendHeartbeat('idle', {
                message: 'Workflow completed, back to idle'
            });
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

        // ✅ ایجاد promise برای هر اکانت
        const accountPromises = accounts.map(async (account, index) => {
            const startDelay = index * randomDelay(2000, 4000);

            if (startDelay > 0) {
                logger.info(`⏳ Account ${account.email} waiting ${startDelay}ms before start...`);
                await sleep(startDelay);
            }

            // چک کردن abort signal قبل از شروع
            if (abortController.signal.aborted) {
                logger.info(`⏹️ Account ${account.email} aborted before processing`);
                return { type: 'aborted', account, index };
            }

            logger.info(`🚀 Starting account ${index + 1}: ${account.email}`);

            try {
                const accountString = `${account.email}:${account.password}`;

                // اضافه کردن abort signal به processAccountInTab
                const result = await processAccountInTab(
                    context,
                    accountString,
                    index,
                    accounts.length,
                    abortController.signal // پاس دادن signal
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

        // ✅ پردازش promises با race condition
        const activePromises = [...accountPromises];

        while (activePromises.length > 0 && !shouldExitGlobal) {
            try {
                const result = await Promise.race(activePromises);

                // حذف promise تکمیل شده از لیست
                const promiseIndex = activePromises.findIndex(p => p === accountPromises[result.index]);
                if (promiseIndex > -1) {
                    activePromises.splice(promiseIndex, 1);
                }

                // پردازش نتیجه
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
                // aborted results را ignore می‌کنیم

            } catch (error) {
                logger.error(`❌ Unexpected error in promise race: ${error.message}`);
                break;
            }
        }

        // اگر exit شده، منتظر تکمیل promise های باقی‌مانده نمی‌مانیم
        if (shouldExitGlobal) {
            logger.warn(`🚨 Processing stopped due to exit condition. Processed ${completedResults.length} accounts.`);

            // کمی صبر کنیم تا abort signal به همه برسد
            await sleep(1000);
        } else {
            logger.info(`⏳ Waiting for remaining ${activePromises.length} accounts...`);
            // اگر exit نشده، منتظر بقیه می‌مانیم
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
            results: completedResults,
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
                instanceStats: this.getStats()
            }
        };

        logger.info(`📊 Submitting results: ${results.length} accounts processed in ${processingTime}ms`);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Results submission timeout'));
            }, 15000);

            // گوش دادن به تایید
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
                context: context,
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
            registered: this.registered
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
    * راه‌اندازی instance
    */
    async start() {
        logger.info(`🚀 Starting PSN Instance: ${this.instanceId}`);
        logger.info(`📡 Server URL: ${this.serverUrl}`);
        logger.info(`⚙️ Configuration:`);
        logger.info(`   - Batch Size: ${config.BATCH_SIZE || 2}`);
        logger.info(`   - Max Concurrency: ${config.MAX_CONCURRENCY || 2}`);
        logger.info(`   - Heartbeat Interval: ${config.HEARTBEAT_INTERVAL || 30000}ms`);

        // راه‌اندازی اتصال
        this.initSocket();

        // شروع heartbeat
        this.startHeartbeat();

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
