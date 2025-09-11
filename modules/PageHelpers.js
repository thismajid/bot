import HumanBehavior from "./HumanBehavior.js";
import Constants from "./Constants.js";

// ==================== PageHelpers Class ====================
export default class PageHelpers {
    // ==================== Page Loading and Waiting ====================
    static async waitFullLoadAndSettle(page, extraMs = Constants.PAGE_SETTLE_EXTRA_MS) {
        if (Constants.WAIT_FOR_FULL_LOAD) {
            try { 
                await page.waitForLoadState("load", { timeout: 15000 }); 
            } catch { }
        }
        
        await HumanBehavior.sleep(extraMs);
        await HumanBehavior.randomMouseMovements(page);
        await HumanBehavior.randomScroll(page);
    }

    static async waitForFrameWithSelector(page, selector, timeout = Constants.PAGE_LOAD_TIMEOUT) {
        const start = Date.now();
        let lastError = null;

        while (Date.now() - start < timeout) {
            try {
                for (const frame of page.frames()) {
                    try {
                        const el = await frame.$(selector);
                        if (el) {
                            console.log(`✅ Found selector "${selector}" in frame`);
                            return frame;
                        }
                    } catch (frameErr) {
                        lastError = frameErr;
                    }
                }
            } catch (pageErr) {
                lastError = pageErr;
            }

            await HumanBehavior.sleep(100);
        }

        console.log(`❌ Frame with selector "${selector}" not found after ${timeout}ms`);
        if (lastError) {
            console.log("Last error:", lastError.message);
        }

        throw new Error(`Frame with selector "${selector}" not found`);
    }

    static async waitForPageContent(page, targetText, maxWaitTime = 25000, tabNumber = '') {
        const startTime = Date.now();
        const checkInterval = 2000;

        console.log(`[Tab ${tabNumber}] 🔍 Smart loading detection started - looking for: "${targetText}"`);

        while (Date.now() - startTime < maxWaitTime) {
            try {
                const pageContent = await page.content();

                if (pageContent.includes(targetText)) {
                    const loadTime = Date.now() - startTime;
                    console.log(`[Tab ${tabNumber}] ✅ Target text found after ${loadTime}ms!`);
                    return true;
                }

                if (this._hasTimeoutMessage(pageContent)) {
                    console.log(`[Tab ${tabNumber}] ⏰ Timeout message detected during page loading!`);
                    return false;
                }

                const hasText = await page.evaluate((text) => {
                    return document.body && document.body.innerText && document.body.innerText.includes(text);
                }, targetText).catch(() => false);

                if (hasText) {
                    const loadTime = Date.now() - startTime;
                    console.log(`[Tab ${tabNumber}] ✅ Target text found in body after ${loadTime}ms!`);
                    return true;
                }

                const hasTimeoutMessage = await page.evaluate(() => {
                    return document.body && document.body.innerText &&
                        document.body.innerText.includes('The connection to the server timed out.');
                }).catch(() => false);

                if (hasTimeoutMessage) {
                    console.log(`[Tab ${tabNumber}] ⏰ Timeout message detected in body during page loading!`);
                    return false;
                }

                const elapsed = Date.now() - startTime;
                console.log(`[Tab ${tabNumber}] ⏳ Still loading... (${elapsed}ms/${maxWaitTime}ms) - next check in 2s`);

                await HumanBehavior.sleep(checkInterval);

            } catch (error) {
                console.log(`[Tab ${tabNumber}] ⚠️ Error during content check: ${error.message}`);
                await HumanBehavior.sleep(checkInterval);
            }
        }

        console.log(`[Tab ${tabNumber}] ❌ Timeout: Target text "${targetText}" not found within ${maxWaitTime}ms`);
        return false;
    }

    static _hasTimeoutMessage(pageContent) {
        const timeoutMessages = [
            'The connection to the server timed out.',
            'Can\'t connect to the server',
            'device sent too many requests'
        ];
        
        return timeoutMessages.some(message => pageContent.includes(message));
    }

    // ==================== Navigation Helpers ====================
    static async safeClickMayNavigate(page, frame, selector, navTimeout = 8000) {
        await HumanBehavior.hoverElement(page, selector);

        const nav = page.waitForNavigation({ 
            waitUntil: "load", 
            timeout: navTimeout 
        }).catch(() => null);
        
        const click = HumanBehavior.humanClick(page, selector);
        await Promise.all([click, nav]);
        await this.waitFullLoadAndSettle(page);
    }

    // ==================== Element Locators ====================
    static emailLocator(frame) {
        const selectors = [
            'input[type="email"]:visible',
            'input[type="email"]',
            '#signin-entrance-input-signinId',
            'input[autocomplete*="email"]',
            'input[autocomplete*="username"]',
            '[data-qa*="email"]'
        ];

        for (const selector of selectors) {
            try {
                const locator = frame.locator(selector).first();
                console.log(`📧 Using email selector: ${selector}`);
                return locator;
            } catch (err) {
                continue;
            }
        }

        console.log("📧 Using default email selector");
        return frame.locator('input[type="email"]').first();
    }

    static passwordLocator(frame) {
        const selectors = [
            'input[type="password"]:visible:not([aria-hidden="true"])',
            'input[type="password"]:not([tabindex="-1"])',
            'input[type="password"]',
            '#signin-entrance-input-password',
            '[data-qa*="password"]'
        ];

        for (const selector of selectors) {
            try {
                const locator = frame.locator(selector).first();
                return locator;
            } catch (err) {
                continue;
            }
        }

        return frame.locator('input[type="password"]').first();
    }

    // ==================== Screenshot Utilities ====================
    static async takeAdvancedScreenshot(page, filename) {
        try {
            const screenshotsDir = path.join(process.cwd(), 'screenshots');
            
            // Ensure screenshots directory exists
            if (!fsSync.existsSync(screenshotsDir)) {
                await fs.mkdir(screenshotsDir, { recursive: true });
            }
            
            const screenshotPath = path.join(screenshotsDir, filename);
            await page.screenshot({ 
                path: screenshotPath, 
                fullPage: true,
                quality: 80
            });
            
            return screenshotPath;
        } catch (screenshotErr) {
            console.log(`⚠️ Screenshot failed: ${screenshotErr.message}`);
            return null;
        }
    }
}