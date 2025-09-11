export default class HumanBehavior {
    static sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    static randomDelay(min = 100, max = 300) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    static async smoothMouseMove(page, selector) {
        try {
            const element = await page.locator(selector).first();
            const box = await element.boundingBox();

            if (box) {
                const targetX = box.x + Math.random() * box.width;
                const targetY = box.y + Math.random() * box.height;
                await page.mouse.move(targetX, targetY, { steps: 5 + Math.floor(Math.random() * 5) });
                await this.sleep(this.randomDelay(200, 500));
            }
        } catch (err) {
            console.log("Mouse move failed:", err.message);
        }
    }

    static async hoverElement(page, selector) {
        try {
            await this.smoothMouseMove(page, selector);
            await page.hover(selector, { force: true });
            await this.sleep(this.randomDelay(150, 350));
        } catch (err) {
            console.log("Hover failed:", err.message);
            await this.sleep(this.randomDelay(150, 350));
        }
    }

    static async humanClick(page, selector, options = {}) {
        try {
            await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
            await this.smoothMouseMove(page, selector);
            await this.sleep(this.randomDelay(50, 150));

            if (Math.random() < 0.1) {
                await page.click(selector, { delay: this.randomDelay(25, 75), force: true, ...options });
                await this.sleep(this.randomDelay(50, 100));
            }

            await page.click(selector, { delay: this.randomDelay(50, 150), force: true, ...options });
            await this.sleep(this.randomDelay(100, 250));
        } catch (err) {
            console.log("Human click failed:", err.message);
            await this._fallbackClick(page, selector, options);
        }
    }

    static async _fallbackClick(page, selector, options) {
        try {
            const locator = page.locator(selector).first();
            await locator.waitFor({ state: 'visible', timeout: 5000 });
            await locator.click({ force: true, ...options });
        } catch (fallbackErr) {
            try {
                await page.evaluate((sel) => {
                    const element = document.querySelector(sel);
                    if (element) element.click();
                }, selector);
                console.log("JavaScript click successful");
            } catch (jsErr) {
                console.log("All click methods failed:", jsErr.message);
                throw fallbackErr;
            }
        }
    }

    static async humanType(page, selector, text, options = {}) {
        try {
            await this.humanClick(page, selector);
            await page.fill(selector, '');
            await this.sleep(this.randomDelay(100, 200));

            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                await page.type(selector, char, { delay: this.randomDelay(40, 100) });

                if (Math.random() < 0.1) {
                    await this.sleep(this.randomDelay(150, 400));
                }
            }

            await this.sleep(this.randomDelay(150, 300));
        } catch (err) {
            console.log("Human type failed:", err.message);
            await page.fill(selector, text);
        }
    }

    static async typeWithMistakes(page, selector, correctText) {
        try {
            await this.humanClick(page, selector);
            await page.fill(selector, '');
            await this.sleep(this.randomDelay(200, 400));

            if (Math.random() < 0.3 && correctText.length > 3) {
                const partialText = correctText.substring(0, Math.floor(correctText.length * 0.7));
                for (let char of partialText) {
                    await page.type(selector, char, { delay: this.randomDelay(80, 200) });
                }

                const mistakes = 'xx';
                for (let char of mistakes) {
                    await page.type(selector, char, { delay: this.randomDelay(80, 200) });
                }

                await this.sleep(this.randomDelay(500, 1000));

                for (let i = 0; i < mistakes.length; i++) {
                    await page.press(selector, 'Backspace', { delay: this.randomDelay(100, 200) });
                }

                await this.sleep(this.randomDelay(300, 500));

                const remainingText = correctText.substring(partialText.length);
                for (let char of remainingText) {
                    await page.type(selector, char, { delay: this.randomDelay(80, 200) });
                }
            } else {
                for (let char of correctText) {
                    await page.type(selector, char, { delay: this.randomDelay(80, 200) });
                }
            }

            await this.sleep(this.randomDelay(300, 600));
        } catch (err) {
            console.log("Type with mistakes failed:", err.message);
            await page.fill(selector, correctText);
        }
    }

    static async randomScroll(page) {
        try {
            if (Math.random() < 0.3) {
                const scrollAmount = Math.floor(Math.random() * 150) + 50;
                await page.mouse.wheel(0, scrollAmount);
                await this.sleep(this.randomDelay(250, 500));
                await page.mouse.wheel(0, -scrollAmount);
                await this.sleep(this.randomDelay(150, 300));
            }
        } catch (err) {
            console.log("Random scroll failed:", err.message);
        }
    }

    static async randomMouseMovements(page) {
        try {
            if (Math.random() < 0.4) {
                const viewport = await page.viewportSize();
                const x = Math.random() * (viewport?.width || 1200);
                const y = Math.random() * (viewport?.height || 800);
                await page.mouse.move(x, y, { steps: 3 + Math.floor(Math.random() * 5) });
                await this.sleep(this.randomDelay(100, 150));
            }
        } catch (err) {
            console.log("Random mouse movement failed:", err.message);
        }
    }

    static async waitFullLoadAndSettle(page, extraMs = 3000) {
        try { 
            await page.waitForLoadState("load", { timeout: 15000 }); 
        } catch { }
        
        await this.sleep(extraMs);
        await this.randomMouseMovements(page);
        await this.randomScroll(page);
    }
}