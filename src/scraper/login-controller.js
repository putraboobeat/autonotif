const { createLogger } = require('../utils/logger');
const { getPage, saveCookies, recreatePage } = require('./browser');
const { isLoggedIn } = require('./login');
const { sleep } = require('../utils/helpers');
const { config } = require('../config');

const log = createLogger('LOGIN-CTRL');

// Status enumerations
const AuthStatus = {
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  LOGGED_IN: 'LOGGED_IN',
  LOGIN_IN_PROGRESS: 'LOGIN_IN_PROGRESS',
  NEED_OTP: 'NEED_OTP',
  ERROR: 'ERROR',
};

let currentStatus = AuthStatus.NOT_LOGGED_IN;
let authError = null;
let loginPage = null; // Store reference to the page where login is happening

/**
 * Check current authentication status without blocking for long
 */
async function getAuthStatus() {
  const page = getPage();
  if (page && !page.isClosed()) {
    try {
      const logged = await isLoggedIn(page);
      if (logged) {
        currentStatus = AuthStatus.LOGGED_IN;
      } else if (currentStatus === AuthStatus.LOGGED_IN) {
        currentStatus = AuthStatus.NOT_LOGGED_IN;
      }
    } catch (error) {
      log.debug('Error checking status, assuming not logged in', { error: error.message });
      if (error.message.includes('detached Frame') || error.message.includes('closed')) {
        await recreatePage().catch(() => {});
      }
      currentStatus = AuthStatus.NOT_LOGGED_IN;
    }
  }
  return {
    status: currentStatus,
    error: authError,
  };
}

/**
 * Perform a full automated login with TOTP Google Authenticator
 * Fully awaitable and returns boolean (true = success, false = failure)
 */
async function autoLoginWithTotp() {
  if (!config.oca.totpSecret) {
    log.warn('Cannot perform autoLoginWithTotp: OCA_TOTP_SECRET not configured in .env');
    return false;
  }

  log.info('Starting full automated login with TOTP...');
  let page = getPage();
  if (!page || page.isClosed()) {
    page = await recreatePage();
  }

  if (!page) {
    log.error('Browser page not available for auto-login');
    return false;
  }

  currentStatus = AuthStatus.LOGIN_IN_PROGRESS;
  authError = null;
  loginPage = page;

  try {
    // 1. Navigate to login page
    log.debug('Navigating to OCA account login...');
    await page.goto(`${config.oca.url}account/login`, {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });

    await sleep(2500);

    // If already logged in (e.g. redirected directly)
    if (await isLoggedIn(page)) {
      log.info('Already logged in to OCA!');
      await saveCookies();
      currentStatus = AuthStatus.LOGGED_IN;
      return true;
    }

    // 2. Fill email
    const emailSelector = 'input[name="email_user"], input[type="email"], input[id="email"]';
    await page.waitForSelector(emailSelector, { timeout: 15000 });
    const emailEl = await page.$(emailSelector);
    if (!emailEl) throw new Error('Email input field not found');
    await emailEl.click({ clickCount: 3 });
    await emailEl.type(config.oca.email, { delay: 25 });

    // 3. Fill password
    const pwSelector = 'input[name="password"], input[type="password"], input[id="password"]';
    await page.waitForSelector(pwSelector, { timeout: 10000 });
    const pwEl = await page.$(pwSelector);
    if (!pwEl) throw new Error('Password input field not found');
    await pwEl.click({ clickCount: 3 });
    await pwEl.type(config.oca.password, { delay: 25 });

    // 4. Click Sign In
    const submitBtnSelector = 'button[type="submit"], .btn-pink, .btn-primary';
    await page.waitForSelector(submitBtnSelector, { timeout: 10000 });
    const submitBtn = await page.$(submitBtnSelector);
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }

    log.info('Credentials submitted. Waiting for OTP prompt or dashboard...');
    await sleep(4000);

    // Check if directly logged in without OTP
    if (await isLoggedIn(page)) {
      log.info('Login successful without OTP!');
      await saveCookies();
      currentStatus = AuthStatus.LOGGED_IN;
      return true;
    }

    // 5. Generate and fill OTP
    const otpSelector = 'input.otp-input, input[type="tel"]';
    await page.waitForSelector(otpSelector, { timeout: 15000 });

    const { TOTP } = require('totp-generator');
    const { otp: token } = await TOTP.generate(config.oca.totpSecret);
    const cleanCode = (token || '').toString().trim();
    log.info(`Generated TOTP internally: ${cleanCode}`);

    const otpInputs = await page.$$(otpSelector);
    if (otpInputs.length >= 6) {
      for (let i = 0; i < 6; i++) {
        await otpInputs[i].click();
        await otpInputs[i].type(cleanCode[i], { delay: 40 });
      }
      log.info('Filled 6 OTP boxes.');
    } else {
      throw new Error(`Expected 6 OTP boxes, but found ${otpInputs.length}`);
    }

    await sleep(800);

    // 6. Click Submit button in OTP modal
    const otpSubmitBtn = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => {
        const text = (b.innerText || b.value || '').trim().toLowerCase();
        return (text === 'submit' || text === 'verifikasi' || text === 'verify') && !b.disabled;
      }) || null;
    });

    if (otpSubmitBtn && (await otpSubmitBtn.asElement())) {
      await otpSubmitBtn.asElement().click();
      log.info('Clicked OTP Submit button.');
    } else {
      log.warn('Could not find enabled Submit button, pressing Enter...');
      await page.keyboard.press('Enter');
    }

    // 7. Wait for post-OTP navigation / dashboard load
    await sleep(6000);

    const logged = await isLoggedIn(page);
    if (logged) {
      log.info('✅ Fully automated TOTP login successful!');
      await saveCookies();
      currentStatus = AuthStatus.LOGGED_IN;
      authError = null;
      return true;
    } else {
      log.error(`❌ Auto-login failed: URL after OTP is ${page.url()}`);
      currentStatus = AuthStatus.ERROR;
      authError = 'Auto-login failed after OTP';
      return false;
    }
  } catch (err) {
    log.error('❌ Auto-login encountered an exception', { error: err.message });
    currentStatus = AuthStatus.ERROR;
    authError = err.message;
    return false;
  }
}

/**
 * Start interactive login process (Step 1: Email & Password)
 * Used when user logs in manually through the Dashboard UI
 */
async function startLoginInteractive(email, password) {
  currentStatus = AuthStatus.LOGIN_IN_PROGRESS;
  authError = null;
  loginPage = getPage();

  if (!loginPage || loginPage.isClosed()) {
    loginPage = await recreatePage();
  }

  if (!loginPage) {
    currentStatus = AuthStatus.ERROR;
    authError = 'Browser page is not available';
    return { status: currentStatus, error: authError };
  }

  // Run in background for UI responsiveness
  _runPuppeteerLogin(email, password).catch(async (err) => {
    log.error('Background login task failed', { error: err.message });
    if (err.message.includes('detached Frame') || err.message.includes('closed')) {
      log.warn('Cleaning up corrupted browser session due to detached frame...');
      await recreatePage().catch(() => {});
    }
    currentStatus = AuthStatus.ERROR;
    authError = err.message;
  });

  return { status: AuthStatus.LOGIN_IN_PROGRESS, message: 'Login process started' };
}

/**
 * The background Puppeteer logic for manual login from Dashboard UI
 */
async function _runPuppeteerLogin(email, password) {
  log.info('Running interactive login from UI...');
  
  try {
    await loginPage.goto(`${config.oca.url}account/login`, {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });
  } catch (err) {
    if (err.message.includes('detached Frame') || err.message.includes('closed')) {
      log.warn('Encountered detached frame during goto, recreating page and retrying...');
      loginPage = await recreatePage();
      await loginPage.goto(`${config.oca.url}account/login`, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });
    } else {
      throw err;
    }
  }

  await sleep(2500);

  if (await isLoggedIn(loginPage)) {
    log.info('Already logged in!');
    currentStatus = AuthStatus.LOGGED_IN;
    return;
  }

  // Find and fill email
  const emailSelector = 'input[name="email_user"], input[type="email"], input[id="email"]';
  await loginPage.waitForSelector(emailSelector, { timeout: 15000 });
  const emailEl = await loginPage.$(emailSelector);
  if (!emailEl) throw new Error('Email field not found on page');
  await emailEl.click({ clickCount: 3 });
  await emailEl.type(email, { delay: 25 });

  await sleep(500);

  // Find and fill password
  const pwSelector = 'input[name="password"], input[type="password"], input[id="password"]';
  await loginPage.waitForSelector(pwSelector, { timeout: 10000 });
  const pwEl = await loginPage.$(pwSelector);
  if (!pwEl) throw new Error('Password field not found on page');
  await pwEl.click({ clickCount: 3 });
  await pwEl.type(password, { delay: 25 });

  await sleep(500);

  // Submit form
  const submitSelector = 'button[type="submit"], .btn-pink, .btn-primary';
  const submitBtn = await loginPage.$(submitSelector);
  if (submitBtn) {
    await submitBtn.click();
  } else {
    await loginPage.keyboard.press('Enter');
  }

  await sleep(4000);

  if (await isLoggedIn(loginPage)) {
    log.info('Login successful without OTP!');
    await saveCookies();
    currentStatus = AuthStatus.LOGGED_IN;
    return;
  }

  // If TOTP secret is configured, auto-complete OTP
  if (config.oca.totpSecret) {
    log.info('TOTP secret available. Auto-filling OTP...');
    const { TOTP } = require('totp-generator');
    const { otp: token } = await TOTP.generate(config.oca.totpSecret);
    const result = await submitOtpInteractive(token);
    if (result.status === AuthStatus.LOGGED_IN) {
      log.info('Auto TOTP completion successful!');
      return;
    }
  }

  // Otherwise, set NEED_OTP for user to input in UI
  currentStatus = AuthStatus.NEED_OTP;
  log.info('System waiting for OTP from user via UI...');
}

/**
 * Submit the OTP code provided by the user via UI
 */
async function submitOtpInteractive(otpCode) {
  if (!loginPage || loginPage.isClosed()) {
    loginPage = getPage();
  }
  if (!loginPage) {
    throw new Error('Browser page not available');
  }

  currentStatus = AuthStatus.LOGIN_IN_PROGRESS;
  authError = null;

  try {
    const cleanCode = (otpCode || '').toString().trim().replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      throw new Error(`Kode OTP harus 6 digit (diterima: ${cleanCode.length})`);
    }

    const otpSelector = 'input.otp-input, input[type="tel"]';
    await loginPage.waitForSelector(otpSelector, { timeout: 10000 });
    const otpInputs = await loginPage.$$(otpSelector);

    if (otpInputs.length >= 6) {
      for (let i = 0; i < 6; i++) {
        await otpInputs[i].click();
        await otpInputs[i].type(cleanCode[i], { delay: 40 });
      }
    } else {
      const singleInput = await loginPage.$('input[type="text"], input[name*="otp"]');
      if (singleInput) {
        await singleInput.click({ clickCount: 3 });
        await singleInput.type(cleanCode, { delay: 40 });
      }
    }

    await sleep(600);

    // Find enabled OTP submit button
    const submitBtn = await loginPage.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => {
        const text = (b.innerText || b.value || '').trim().toLowerCase();
        return (text === 'submit' || text === 'verifikasi' || text === 'verify') && !b.disabled;
      }) || null;
    });

    if (submitBtn && (await submitBtn.asElement())) {
      await submitBtn.asElement().click();
    } else {
      await loginPage.keyboard.press('Enter');
    }

    await sleep(6000);

    if (await isLoggedIn(loginPage)) {
      log.info('OTP Accepted! Login successful.');
      await saveCookies();
      currentStatus = AuthStatus.LOGGED_IN;
      return { status: currentStatus, message: 'Login successful' };
    } else {
      currentStatus = AuthStatus.ERROR;
      authError = 'Gagal masuk setelah submit OTP';
      return { status: currentStatus, error: authError };
    }
  } catch (error) {
    log.error('Error submitting OTP', { error: error.message });
    currentStatus = AuthStatus.ERROR;
    authError = error.message;
    return { status: currentStatus, error: authError };
  }
}

module.exports = {
  AuthStatus,
  getAuthStatus,
  autoLoginWithTotp,
  startLoginInteractive,
  submitOtpInteractive,
};
