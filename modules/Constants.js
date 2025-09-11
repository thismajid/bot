export default {
    // ==================== File Paths ====================
    ACCOUNTS_FILE: "accounts.txt",
    WORKING_PROXIES_FILE: "working_proxies.txt",
    COOKIES_FILE: "cookies.json",
    RESULTS_FILE: "results.txt",
    
    // ==================== URLs ====================
    LOGIN_URL: "https://my.account.sony.com/central/management/?entry=device_password&origin_client_id=dfaa38ee-6f41-48c5-908c-2a338a183121",
    
    // ==================== Server Configuration ====================
    KAMELEO_PORT: 5050,
    CONCURRENT_TABS: 2,
    
    // ==================== Page Settings ====================
    WAIT_FOR_FULL_LOAD: true,
    PAGE_SETTLE_EXTRA_MS: 3000,
    
    // ==================== Timeouts (milliseconds) ====================
    MAX_RETRIES: 2,
    MAX_TIMEOUT_RETRIES: 2,
    PROFILE_CREATE_TIMEOUT: 25000,
    PAGE_LOAD_TIMEOUT: 30000,
    FRAME_WAIT_TIMEOUT: 20000,
    NAVIGATION_TIMEOUT: 8000,
    
    // ==================== Delays (milliseconds) ====================
    MIN_DELAY: 100,
    MAX_DELAY: 300,
    RETRY_BASE_DELAY: 1500,
    
    // ==================== Cleanup Settings ====================
    CLEANUP_INTERVAL: 10 * 60 * 1000, // 10 minutes
    PROFILE_MAX_AGE: 5 * 60 * 1000,   // 5 minutes
    
    // ==================== Browser Limits ====================
    MAX_CONCURRENT_BROWSERS: parseInt(process.env.MAX_CONCURRENT_BROWSERS) || 10,
    
    // ==================== Fingerprint Settings ====================
    FINGERPRINT_OS_VERSION: '11',
    FINGERPRINT_DEVICE_TYPE: 'desktop',
    FINGERPRINT_OS_TYPE: 'windows',
    FINGERPRINT_BROWSER: 'chrome'
};