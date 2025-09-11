import fs from "node:fs/promises";
import fsSync from "node:fs";
import Constants from "./Constants.js";

// ==================== ProxyManager Class ====================
export default class ProxyManager {
    constructor() {
        this.workingProxiesFile = Constants.WORKING_PROXIES_FILE;
        this.cookiesFile = Constants.COOKIES_FILE;
    }

    // ==================== Proxy Loading ====================
    async loadWorkingProxies() {
        try {
            if (!fsSync.existsSync(this.workingProxiesFile)) {
                console.log("❌ No working_proxies.txt file found!");
                console.log("🔧 Please run: node proxy-tester.js proxies.txt");
                return [];
            }

            const content = await fs.readFile(this.workingProxiesFile, "utf8");
            const proxies = content
                .split("\n")
                .map(line => line.trim())
                .filter(Boolean)
                .map(this._parseProxyLine)
                .filter(Boolean);

            console.log(`✅ Loaded ${proxies.length} pre-tested working proxies`);
            return proxies;
        } catch (err) {
            console.log("❌ Error loading working proxies:", err.message);
            return [];
        }
    }

    _parseProxyLine(line) {
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
    }

    // ==================== Proxy Selection ====================
    async getNextWorkingProxy(workingProxies) {
        if (!workingProxies || workingProxies.length === 0) {
            console.log("❌ No more working proxies available");
            return null;
        }

        const selectedProxy = workingProxies.shift();
        console.log(`🎯 Selected proxy: ${selectedProxy.host}:${selectedProxy.port} (pre-tested)`);
        return selectedProxy;
    }

    // ==================== Proxy Removal ====================
    async removeUsedWorkingProxy(usedProxy) {
        try {
            if (!this._isValidProxy(usedProxy)) {
                console.log("No proxy to remove or missing original line");
                return;
            }

            if (!fsSync.existsSync(this.workingProxiesFile)) {
                console.log("Working proxies file not found");
                return;
            }

            const lines = await this._readProxyLines();
            const remainingLines = this._filterOutUsedProxy(lines, usedProxy);

            await this._writeRemainingProxies(remainingLines);
            this._logProxyRemoval(usedProxy, remainingLines.length);

        } catch (err) {
            console.log("Error removing used working proxy:", err.message);
        }
    }

    _isValidProxy(proxy) {
        return proxy && proxy.originalLine;
    }

    async _readProxyLines() {
        const content = await fs.readFile(this.workingProxiesFile, "utf8");
        return content
            .split("\n")
            .map(line => line.trim())
            .filter(Boolean);
    }

    _filterOutUsedProxy(lines, usedProxy) {
        return lines.filter(line => line !== usedProxy.originalLine);
    }

    async _writeRemainingProxies(remainingLines) {
        const newContent = remainingLines.length > 0 
            ? remainingLines.join("\n") + "\n" 
            : "";
        await fs.writeFile(this.workingProxiesFile, newContent, "utf8");
    }

    _logProxyRemoval(usedProxy, remainingCount) {
        console.log(`🗑️ Removed used proxy: ${usedProxy.host}:${usedProxy.port}`);
        console.log(`📊 Remaining working proxies: ${remainingCount}`);
    }

    // ==================== Cookie Management ====================
    async loadCookies() {
        try {
            if (!fsSync.existsSync(this.cookiesFile)) {
                console.log("No cookies file found. Running without cookies.");
                return [];
            }

            const content = await fs.readFile(this.cookiesFile, "utf8");
            const cookies = JSON.parse(content);
            console.log(`Loaded ${cookies.length} cookies`);
            return cookies;
        } catch (err) {
            console.log("Error loading cookies:", err.message);
            return [];
        }
    }
}