const { createLogger } = require('../utils/logger');
const { getPage, saveCookies } = require('./browser');
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
 * Get current authentication status
 */
async function getAuthStatus() {
  const page = getPage();
  if (page) {
    // If not in middle of interactive login, double check actual status
    if (currentStatus !== AuthStatus.NEED_OTP && currentStatus !== AuthStatus.LOGIN_IN_PROGRESS) {
      const logged = await isLoggedIn(page);
      currentStatus = logged ? AuthStatus.LOGGED_IN : AuthStatus.NOT_LOGGED_IN;
    }
  }
  
  return {
    status: currentStatus,
    error: authError,
  };
}

/**
 * Start the login process using credentials
 */
async function startLoginInteractive(email, password) {
  if (currentStatus === AuthStatus.LOGIN_IN_PROGRESS || currentStatus === AuthStatus.NEED_OTP) {
    throw new Error('Login process is already in progress or waiting for OTP');
  }

  currentStatus = AuthStatus.LOGIN_IN_PROGRESS;
  authError = null;
  loginPage = getPage();

  if (!loginPage) {
    currentStatus = AuthStatus.ERROR;
    authError = 'Browser page is not available';
    return { status: currentStatus, error: authError };
  }

  // We run the Puppeteer automation in the background but return status quickly to API
  // This allows the API request to not timeout while Puppeteer works
  _runPuppeteerLogin(email, password).catch(err => {
    log.error('Background login task failed', { error: err.message });
    currentStatus = AuthStatus.ERROR;
    authError = err.message;
  });

  return { status: AuthStatus.LOGIN_IN_PROGRESS, message: 'Login process started' };
}

/**
 * The background Puppeteer logic for first step (email & password)
 */
async function _runPuppeteerLogin(email, password) {
  log.info('Running interactive login...');
  
  await loginPage.goto('https://interaction.ocaindonesia.co.id', {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  await sleep(3000);

  if (await isLoggedIn(loginPage)) {
    log.info('Already logged in!');
    currentStatus = AuthStatus.LOGGED_IN;
    return;
  }

  // Find and fill email
  let emailFilled = false;
  const emailSelectors = [
    'input[type="email"]', 'input[name="email"]', 'input[id="email"]', 'input[name="username"]'
  ];
  
  for (const selector of emailSelectors) {
    try {
      const el = await loginPage.$(selector);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(email, { delay: 30 });
        emailFilled = true;
        break;
      }
    } catch {}
  }

  if (!emailFilled) throw new Error('Email field not found on page');

  await sleep(1000);

  // Find and fill password
  let passwordFilled = false;
  const passwordSelectors = [
    'input[type="password"]', 'input[name="password"]', 'input[id="password"]'
  ];
  
  for (const selector of passwordSelectors) {
    try {
      const el = await loginPage.$(selector);
      if (el) {
        await el.click({ clickCount: 3 });
        await el.type(password, { delay: 30 });
        passwordFilled = true;
        break;
      }
    } catch {}
  }

  if (!passwordFilled) throw new Error('Password field not found on page');

  await sleep(1000);

  // Submit form
  const submitSelectors = [
    'button[type="submit"]', 'input[type="submit"]', '.btn-login', 'button.btn-primary'
  ];
  
  let submitted = false;
  for (const selector of submitSelectors) {
    try {
      const btn = await loginPage.$(selector);
      if (btn) {
        await btn.click();
        submitted = true;
        break;
      }
    } catch {}
  }

  if (!submitted) {
    await loginPage.keyboard.press('Enter');
  }

  // Wait for navigation or OTP prompt
  try {
    await loginPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
  } catch (e) {
    log.warn('No full navigation detected, checking for OTP prompt inline...');
  }
  
  await sleep(6000);

  if (await isLoggedIn(loginPage)) {
    log.info('Login successful without OTP!');
    await saveCookies();
    currentStatus = AuthStatus.LOGGED_IN;
    return;
  }

  // Check if OTP is requested
  const hasOTP = await loginPage.evaluate(() => {
    const bodyText = document.body.innerText.toLowerCase();
    return bodyText.includes('otp') || 
           bodyText.includes('kode verifikasi') || 
           bodyText.includes('verification') ||
           bodyText.includes('login code') ||
           bodyText.includes('authenticator') ||
           bodyText.includes('6-digit');
  });

  if (hasOTP) {
    log.info('OTP requested by OCA server.');
    currentStatus = AuthStatus.NEED_OTP;

    // Check if TOTP Secret is configured for full automation
    if (config.oca.totpSecret) {
      log.info('TOTP Secret found. Generating and submitting OTP automatically...');
      const { TOTP } = require('totp-generator');
      const { otp: token } = await TOTP.generate(config.oca.totpSecret);
      log.info(`OTP Generated internally: ${token}`);
      
      try {
        const result = await submitOtpInteractive(token);
        if (result.status === AuthStatus.LOGGED_IN) {
          log.info('Fully automated login with TOTP successful!');
          return;
        } else {
          log.error('Automated TOTP failed', { error: result.error });
        }
      } catch (err) {
        log.error('Failed during automated TOTP submission', { error: err.message });
      }
    } else {
      log.info('No TOTP Secret configured. Waiting for manual UI input...');
    }
  } else {
    log.error('Login failed, no OTP prompt found but not on dashboard.');
    await loginPage.screenshot({ path: './data/login_failed_no_otp.png' });
    currentStatus = AuthStatus.ERROR;
    authError = 'Login failed. Check credentials.';
  }
}

/**
 * Submit the OTP code provided by the user via UI
 */
async function submitOtpInteractive(otpCode) {
  if (currentStatus !== AuthStatus.NEED_OTP || !loginPage) {
    throw new Error('System is not waiting for OTP');
  }

  currentStatus = AuthStatus.LOGIN_IN_PROGRESS;
  authError = null;

  try {
    // Find all visible, empty input elements (handles both single input or 6 individual OTP input boxes)
    let otpFilled = false;
    try {
      const allInputHandles = await loginPage.$$('input:not([type="hidden"]):not([readonly]):not([disabled])');
      const emptyInputs = [];
      for (const handle of allInputHandles) {
        const isVisible = await handle.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
        if (!isVisible) continue;
        const val = await (await handle.getProperty('value')).jsonValue();
        if (!val || val.toString().trim() === '') {
          emptyInputs.push(handle);
        }
      }

      if (emptyInputs.length >= 6) {
        log.info(`Detected ${emptyInputs.length} empty input boxes (6-digit OTP modal). Filling...`);
        await emptyInputs[0].click();
        await sleep(200);
        // Type entire string to test auto-advance
        await loginPage.keyboard.type(otpCode, { delay: 100 });
        await sleep(500);
        
        // Check if all 6 boxes are filled now
        const sixthValue = await (await emptyInputs[5].getProperty('value')).jsonValue();
        if (!sixthValue) {
          log.warn('Auto-advance did not complete all 6 boxes, filling individually...');
          for (let i = 0; i < Math.min(emptyInputs.length, otpCode.length); i++) {
            await emptyInputs[i].click();
            await emptyInputs[i].evaluate((el) => { el.value = ''; });
            await emptyInputs[i].type(otpCode[i]);
            await sleep(100);
          }
        }
        otpFilled = true;
      } else if (emptyInputs.length > 0) {
        log.info('Detected single empty OTP input box. Filling...');
        await emptyInputs[0].click({ clickCount: 3 });
        await emptyInputs[0].type(otpCode, { delay: 50 });
        otpFilled = true;
      }
    } catch (err) {
      log.warn('Error during intelligent OTP filling, trying fallback selectors', { error: err.message });
    }

    if (!otpFilled) {
      log.warn('Could not fill OTP via empty input detection, trying fallback (Tab + type)');
      await loginPage.keyboard.press('Tab');
      await sleep(500);
      await loginPage.keyboard.type(otpCode, { delay: 50 });
    }

    await sleep(1000);

    let btnClicked = false;
    const btnHandle = await loginPage.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], .btn'));
      for (const btn of buttons) {
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || style.visibility === 'hidden' || btn.disabled) continue;
        const text = (btn.innerText || btn.value || '').trim().toLowerCase();
        if (['submit', 'verifikasi', 'verify', 'kirim', 'lanjut', 'continue', 'ok'].includes(text)) {
          return btn;
        }
      }
      return document.querySelector('button[type="submit"], .btn-submit, .btn-primary, button.btn') || null;
    });

    if (btnHandle && (await btnHandle.asElement())) {
      await btnHandle.asElement().click();
      btnClicked = true;
      log.info('Clicked OTP Submit button successfully');
    }

    if (!btnClicked) {
      log.info('Could not find specific OTP submit button, pressing Enter...');
      await loginPage.keyboard.press('Enter');
    }

    try {
      await loginPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 });
    } catch {}
    
    await sleep(4000);

    if (await isLoggedIn(loginPage)) {
      log.info('OTP Accepted! Login successful.');
      await saveCookies();
      currentStatus = AuthStatus.LOGGED_IN;
      return { status: currentStatus, message: 'Login successful' };
    } else {
      const hasError = await loginPage.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase();
        return bodyText.includes('invalid') || bodyText.includes('salah') || bodyText.includes('expired');
      });

      if (hasError) {
        log.error('OTP Rejected or expired');
        await loginPage.screenshot({ path: './data/otp_failed.png' });
        currentStatus = AuthStatus.NEED_OTP; // allow retry
        authError = 'Kode OTP salah atau kadaluarsa';
        return { status: currentStatus, error: authError };
      } else {
        log.error('Login failed after OTP (unknown reason)');
        await loginPage.screenshot({ path: './data/otp_failed.png' });
        currentStatus = AuthStatus.ERROR;
        authError = 'Gagal masuk setelah submit OTP';
        return { status: currentStatus, error: authError };
      }
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
  startLoginInteractive,
  submitOtpInteractive,
};
