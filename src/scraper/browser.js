const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');
const { config } = require('../config');

puppeteer.use(StealthPlugin());

const log = createLogger('BROWSER');

let browser = null;
let page = null;

/**
 * Launch headless Chromium browser
 */
async function launchBrowser() {
  if (browser && browser.isConnected()) {
    log.debug('Browser already running');
    return { browser, page };
  }

  log.info('Launching headless Chromium...');

  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--window-size=1920,1080',
      '--disable-notifications',
      '--disable-popup-blocking',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    defaultViewport: {
      width: 1920,
      height: 1080,
    },
    timeout: 60000,
  });

  await setupPage();

  log.info('Browser launched successfully');
  return { browser, page };
}

async function setupPage() {
  if (!browser || !browser.isConnected()) {
    await launchBrowser();
    return page;
  }

  page = await browser.newPage();
    
  // Auto-accept any javascript alerts or prompts
  page.on('dialog', async (dialog) => {
    log.debug(`Auto-dismissing dialog: ${dialog.message()}`);
    await dialog.accept().catch(() => {});
  });

  // Set user agent to avoid detection
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );

  // Set extra headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  });

  // Block unnecessary resources to speed things up
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const resourceType = req.resourceType();
    if (['image', 'font', 'media'].includes(resourceType)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  // Automatically load existing cookies on startup
  await loadCookies();
  return page;
}

/**
 * Recreate browser page (useful to recover from 'detached Frame' or crash errors)
 */
async function recreatePage() {
  log.warn('Recreating browser page to clean up detached frame or session error...');
  if (page && !page.isClosed()) {
    await page.close().catch(() => {});
  }
  return await setupPage();
}

/**
 * Get current page instance
 */
function getPage() {
  return page;
}

/**
 * Get browser instance
 */
function getBrowser() {
  return browser;
}

/**
 * Save cookies to file for session persistence
 */
async function saveCookies() {
  if (!page) return;

  try {
    const cookies = await page.cookies();
    const cookiePath = path.resolve(config.app.cookiePath);
    const cookieDir = path.dirname(cookiePath);

    if (!fs.existsSync(cookieDir)) {
      fs.mkdirSync(cookieDir, { recursive: true });
    }

    fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2));
    log.debug('Cookies saved', { count: cookies.length });
  } catch (error) {
    log.error('Failed to save cookies', { error: error.message });
  }
}

/**
 * Load cookies from file
 */
async function loadCookies() {
  if (!page) return false;

  try {
    const cookiePath = path.resolve(config.app.cookiePath);
    if (!fs.existsSync(cookiePath)) {
      log.debug('No saved cookies found');
      return false;
    }

    const cookiesStr = fs.readFileSync(cookiePath, 'utf-8');
    const cookies = JSON.parse(cookiesStr);

    if (cookies.length > 0) {
      await page.setCookie(...cookies);
      log.info('Cookies loaded', { count: cookies.length });
      return true;
    }
  } catch (error) {
    log.error('Failed to load cookies', { error: error.message });
  }

  return false;
}

/**
 * Close browser
 */
async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
      log.info('Browser closed');
    } catch (error) {
      log.error('Error closing browser', { error: error.message });
    }
    browser = null;
    page = null;
  }
}

/**
 * Check if browser is still alive
 */
function isBrowserAlive() {
  return browser && browser.isConnected() && page && !page.isClosed();
}

module.exports = {
  launchBrowser,
  getPage,
  recreatePage,
  getBrowser,
  saveCookies,
  loadCookies,
  closeBrowser,
  isBrowserAlive,
};
