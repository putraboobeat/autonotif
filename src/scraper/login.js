const { createLogger } = require('../utils/logger');
const { config } = require('../config');
const { sleep } = require('../utils/helpers');
const { getPage, saveCookies, loadCookies } = require('./browser');

const log = createLogger('LOGIN');

/**
 * Check if currently on login page
 */
async function isOnLoginPage(page) {
  try {
    const url = page.url();
    // Check if URL contains login-related paths
    if (url.includes('sso.') || url.includes('/login') || url.includes('/auth')) {
      return true;
    }

    // Check for login form elements
    const hasLoginForm = await page.evaluate(() => {
      const emailInput = document.querySelector('input[type="email"], input[name="email"], input[id="email"]');
      const passwordInput = document.querySelector('input[type="password"]');
      return !!(emailInput && passwordInput);
    });

    return hasLoginForm;
  } catch {
    return false;
  }
}

/**
 * Check if we are logged in to OCA Interaction
 */
async function isLoggedIn(page) {
  try {
    const url = page.url();
    // If we're on the interaction dashboard, we're logged in
    if (url.includes('interaction.ocaindonesia.co.id') && !url.includes('/login') && !url.includes('sso.')) {
      // Verify by checking for dashboard elements
      const hasDashboard = await page.evaluate(() => {
        // Look for ticket-related elements or navigation
        const ticketElements = document.querySelector('[class*="ticket"], [class*="sidebar"], [class*="nav"]');
        return !!ticketElements;
      });
      return hasDashboard;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Perform login to OCA Interaction
 */
async function performLogin() {
  const page = getPage();
  if (!page) throw new Error('Browser page not available');

  log.info('Starting login process...');

  // Try loading saved cookies first
  const cookiesLoaded = await loadCookies();

  // Navigate to OCA
  await page.goto(config.oca.url, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  await sleep(3000);

  // Check if cookies got us in
  if (cookiesLoaded && (await isLoggedIn(page))) {
    log.info('Login successful via saved cookies');
    return true;
  }

  // Need to do fresh login
  log.info('Performing fresh login...');

  // Wait for login page to fully load
  await sleep(2000);

  // Check current page state
  const currentUrl = page.url();
  log.info('Current URL after navigation', { url: currentUrl });

  try {
    // Try to find and fill email field
    // OCA might use SSO page at sso.ocaindonesia.co.id
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[id="email"]',
      'input[name="username"]',
      'input[id="username"]',
      '#identifierId', // Google SSO
      'input[type="text"]', // Fallback
    ];

    let emailFilled = false;
    for (const selector of emailSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector, { clickCount: 3 }); // Select all existing text
        await page.type(selector, config.oca.email, { delay: 50 });
        emailFilled = true;
        log.info('Email filled', { selector });
        break;
      } catch {
        continue;
      }
    }

    if (!emailFilled) {
      log.error('Could not find email input field');
      // Take screenshot for debugging
      await page.screenshot({ path: './data/login-debug.png' });
      throw new Error('Email input field not found');
    }

    await sleep(1000);

    // Try to find and fill password field
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[id="password"]',
    ];

    let passwordFilled = false;
    for (const selector of passwordSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector, { clickCount: 3 });
        await page.type(selector, config.oca.password, { delay: 50 });
        passwordFilled = true;
        log.info('Password filled', { selector });
        break;
      } catch {
        continue;
      }
    }

    if (!passwordFilled) {
      log.error('Could not find password input field');
      await page.screenshot({ path: './data/login-debug-pw.png' });
      throw new Error('Password input field not found');
    }

    await sleep(1000);

    // Submit the form
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'button:has-text("Masuk")',
      '.btn-login',
      '#btn-login',
    ];

    let submitted = false;
    for (const selector of submitSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 3000 });
        await page.click(selector);
        submitted = true;
        log.info('Form submitted', { selector });
        break;
      } catch {
        continue;
      }
    }

    // If no submit button found, try pressing Enter
    if (!submitted) {
      log.info('No submit button found, pressing Enter...');
      await page.keyboard.press('Enter');
    }

    // Wait for navigation after login
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
      log.warn('Navigation timeout after login submit');
    });

    await sleep(5000);

    // Check if login was successful
    if (await isLoggedIn(page)) {
      log.info('Login successful!');
      await saveCookies();
      return true;
    }

    // Check if there's a 2FA/OTP prompt
    const has2FA = await page.evaluate(() => {
      const body = document.body.innerText.toLowerCase();
      return body.includes('otp') || body.includes('verification') || body.includes('2fa') || body.includes('kode verifikasi');
    });

    if (has2FA) {
      log.warn('2FA/OTP detected! Please complete 2FA manually on first run.');
      log.warn('The system will save cookies after manual 2FA completion.');
      // Wait longer for manual 2FA input
      await sleep(60000); // Wait 1 minute for manual intervention
      if (await isLoggedIn(page)) {
        await saveCookies();
        return true;
      }
    }

    log.error('Login appears to have failed');
    await page.screenshot({ path: './data/login-failed.png' });
    return false;

  } catch (error) {
    log.error('Login error', { error: error.message });
    try {
      await page.screenshot({ path: './data/login-error.png' });
    } catch {}
    throw error;
  }
}

/**
 * Ensure we are logged in, auto re-login if needed
 */
async function ensureLoggedIn() {
  const page = getPage();
  if (!page) throw new Error('Browser page not available');

  if (await isLoggedIn(page)) {
    return true;
  }

  log.warn('Session expired or not logged in, attempting re-login...');
  return await performLogin();
}

module.exports = {
  performLogin,
  isLoggedIn,
  isOnLoginPage,
  ensureLoggedIn,
};
