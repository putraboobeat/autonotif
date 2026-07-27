/**
 * First-time Login Script
 * 
 * Buka browser TERLIHAT (bukan headless) agar user bisa input OTP manual.
 * Setelah login berhasil, LANGSUNG lanjut scraping tanpa restart browser.
 * Browser tetap terbuka (visible) dan app berjalan seperti biasa.
 * 
 * Usage: node src/first-login.js
 */

require('dotenv').config();

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { config } = require('./config');
const { createLogger } = require('./utils/logger');
const { sleep } = require('./utils/helpers');
const { initDatabase } = require('./database/init');
const { ConfigModel } = require('./database/models');
const { detectNewOpenTickets, markTicketProcessed } = require('./detector/ticket-detector');
const { sendTicketNotification, sendPersonalMessage } = require('./notifier/starsender');
const { buildGroupMessage, buildPersonalMessage, buildKanwilMessage } = require('./notifier/message-builder');
const { NotificationLogModel } = require('./database/models');
const { startDashboard } = require('./dashboard/server');

puppeteer.use(StealthPlugin());

const log = createLogger('FIRST-LOGIN');
const COOKIE_PATH = path.resolve(config.app.cookiePath);

let browser = null;
let page = null;

async function firstLogin() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  🔐 Auto Notif Pengaduan — Login + Start        ║');
  console.log('║  Browser terbuka, login + OTP, lalu auto jalan  ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\n');

  // Init database
  initDatabase();
  startDashboard();

  // Ensure data directory exists
  const dataDir = path.dirname(COOKIE_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Launch VISIBLE browser
  log.info('Membuka browser (visible mode)...');
  browser = await puppeteer.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,900',
      '--disable-notifications',
    ],
    defaultViewport: {
      width: 1280,
      height: 900,
    },
    timeout: 120000,
  });

  page = await browser.newPage();
  
  // Auto-accept any javascript alerts or prompts
  page.on('dialog', async (dialog) => {
    log.info(`Terdapat popup dialog "${dialog.message()}", otomatis menekan OK.`);
    await dialog.accept().catch(() => {});
  });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  });

  // Navigate to OCA
  log.info('Navigasi ke OCA Interaction...');
  await page.goto(config.oca.url, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });

  // Try to auto-fill credentials
  try {
    await sleep(2000);
    const emailSelectors = [
      'input[type="email"]', 'input[name="email"]', 'input[id="email"]', 'input[name="username"]',
    ];
    for (const sel of emailSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ clickCount: 3 });
          await el.type(config.oca.email, { delay: 30 });
          log.info('✅ Email otomatis terisi');
          break;
        }
      } catch {}
    }
    try {
      const pw = await page.$('input[type="password"]');
      if (pw) {
        await pw.click({ clickCount: 3 });
        await pw.type(config.oca.password, { delay: 30 });
        log.info('✅ Password otomatis terisi');
      }
    } catch {}
  } catch {}

  console.log('\n');
  console.log('═══════════════════════════════════════════════════');
  console.log('  📋 INSTRUKSI:');
  console.log('  1. Klik LOGIN di browser');
  console.log('  2. Masukkan kode OTP');
  console.log('  3. Tunggu sampai masuk ke dashboard OCA');
  console.log('  4. Tekan ENTER di terminal ini');
  console.log('═══════════════════════════════════════════════════');
  console.log('\n');

  // Wait for user to complete login
  await waitForEnter('Setelah masuk ke dashboard OCA, tekan ENTER...');

  // Save cookies
  const cookies = await page.cookies();
  fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
  log.info(`Cookies disimpan (${cookies.length} cookies)`);

  const currentUrl = page.url();
  log.info(`URL saat ini: ${currentUrl}`);

  if (currentUrl.includes('interaction.ocaindonesia.co.id') && !currentUrl.includes('/login')) {
    log.info('✅ Login berhasil! Memulai scraping...');
  } else {
    log.warn('⚠️  URL belum di dashboard, tapi tetap lanjut...');
  }

  // ===== LANGSUNG LANJUT KE SCRAPING LOOP (browser yang sama!) =====
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  🔄 Memulai monitoring tiket...                  ║');
  console.log('║  Browser tetap terbuka, auto refresh tiap 1 min ║');
  console.log('║  Tekan Ctrl+C untuk berhenti                    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\n');

  let scrapeCount = 0;

  while (true) {
    try {
      scrapeCount++;
      log.info(`=== Scrape cycle #${scrapeCount} ===`);
      ConfigModel.set('scraper_status', 'running');
      ConfigModel.set('last_scrape_time', new Date().toISOString());

      // Navigate to ticket list (sorted by status, Open first)
      const ticketUrl = `${config.oca.url}ticket/list?startDate=&endDate=&sortTable=status;-1&page=1`;
      
      if (page.url().includes('/ticket/list')) {
        await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
      } else {
        await page.goto(ticketUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      }

      await sleep(3000);

      // Check if we got redirected to login
      if (page.url().includes('/login') || page.url().includes('sso.')) {
        log.warn('Session expired! Mencoba login ulang...');
        // Try to re-login
        await page.goto(config.oca.url, { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(2000);

        // Auto fill
        try {
          const emailEl = await page.$('input[type="email"], input[name="email"]');
          if (emailEl) {
            await emailEl.click({ clickCount: 3 });
            await emailEl.type(config.oca.email, { delay: 30 });
          }
          const pwEl = await page.$('input[type="password"]');
          if (pwEl) {
            await pwEl.click({ clickCount: 3 });
            await pwEl.type(config.oca.password, { delay: 30 });
          }
          const submitBtn = await page.$('button[type="submit"]');
          if (submitBtn) await submitBtn.click();
          
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
          await sleep(5000);

          // Check if OTP needed again
          if (page.url().includes('/login') || page.url().includes('sso.')) {
            log.error('❌ Re-login gagal, mungkin butuh OTP lagi. Restart app: npm run first-login');
            ConfigModel.set('scraper_status', 'error');
            await sleep(config.app.scrapeInterval);
            continue;
          }

          log.info('✅ Re-login berhasil!');
          const newCookies = await page.cookies();
          fs.writeFileSync(COOKIE_PATH, JSON.stringify(newCookies, null, 2));
          continue; // Retry scrape
        } catch (e) {
          log.error('Re-login error', { error: e.message });
          await sleep(config.app.scrapeInterval);
          continue;
        }
      }

      // Wait for table to load
      try {
        await page.waitForSelector('table', { timeout: 15000 });
      } catch {
        log.warn('Table tidak ditemukan');
        ConfigModel.set('scraper_status', 'idle');
        await sleep(config.app.scrapeInterval);
        continue;
      }

      await sleep(2000);

      // Extract ticket data
      const tickets = await page.evaluate(() => {
        const rows = document.querySelectorAll('table tbody tr');
        const data = [];

        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 7) return;

          const cellTexts = Array.from(cells).map((c) => c.innerText.trim());

          let ticketId = '';
          let customer = '';
          let agent = '';
          let status = '';
          let priority = '';
          let category = '';
          let subCategory = '';
          let subject = '';
          let createdDate = '';
          let lastUpdate = '';

          // Find ticket ID
          for (const text of cellTexts) {
            if (text.match(/TICKET-\d+/)) ticketId = text.match(/TICKET-\d+/)[0];
            if (['Open', 'Closed', 'Pending', 'Resolved'].includes(text)) status = text;
            if (['Low', 'Medium', 'High', 'Urgent'].includes(text)) priority = text;
          }

          if (cells.length >= 12) {
            ticketId = ticketId || cellTexts[1] || '';
            customer = cellTexts[2] || '';
            agent = cellTexts[3] || '';
            priority = priority || cellTexts[5] || '';
            status = status || cellTexts[6] || '';
            category = cellTexts[7] || '';
            subCategory = cellTexts[8] || '';
            subject = cellTexts[9] || '';
            createdDate = cellTexts[10] || cellTexts[cells.length - 2] || '';
            lastUpdate = cellTexts[11] || cellTexts[cells.length - 1] || createdDate || '';
          } else if (cells.length >= 10) {
            ticketId = ticketId || cellTexts[1] || '';
            customer = cellTexts[2] || '';
            agent = cellTexts[3] || '';
            priority = priority || cellTexts[5] || '';
            status = status || cellTexts[6] || '';
            category = cellTexts[7] || '';
            subCategory = cellTexts[8] || '';
            subject = cellTexts[9] || '';
            createdDate = cells.length >= 11 ? cellTexts[cells.length - 2] : cellTexts[cells.length - 1] || '';
            lastUpdate = cellTexts[cells.length - 1] || createdDate || '';
          } else if (cells.length >= 7) {
            ticketId = ticketId || cellTexts[0] || '';
            customer = cellTexts[1] || '';
            agent = cellTexts[2] || '';
            priority = priority || cellTexts[3] || '';
            status = status || cellTexts[4] || '';
            category = cellTexts[5] || '';
            createdDate = cells.length >= 8 ? cellTexts[cells.length - 2] : cellTexts[cells.length - 1] || '';
            lastUpdate = cellTexts[cells.length - 1] || createdDate || '';
          }

          if (ticketId) {
            data.push({ ticketId, customer, agent, status, priority, category, subCategory, subject, createdDate, lastUpdate });
          }
        });

        return data;
      });

      // Enrich with kantor pertanahan
      const enriched = tickets.map((t) => {
        const lines = t.agent.split('\n').map((l) => l.trim()).filter(Boolean);
        return { ...t, kantorPertanahan: lines[0] || '' };
      });

      log.info(`Scraped ${enriched.length} tiket, ${enriched.filter(t => t.status === 'Open').length} Open`);

      // Detect new tickets
      const newTickets = detectNewOpenTickets(enriched);

      if (newTickets.length > 0) {
        const notifEnabled = ConfigModel.get('notification_enabled') !== '0';
        const groupEnabled = ConfigModel.get('group_notification_enabled') !== '0';
        const personalEnabled = ConfigModel.get('personal_notification_enabled') !== '0';

        if (notifEnabled) {
          for (const ticket of newTickets) {
            let notifiedGroup = false;
            let notifiedAdmin = false;

            // 1. KIRIM KE ADMIN KANWIL (selalu)
            if (config.kanwil.phone) {
              const kanwilMsg = buildKanwilMessage(ticket, config.kanwil.name);
              const kanwilResult = await sendPersonalMessage(config.kanwil.phone, kanwilMsg);

              NotificationLogModel.create({
                ticketId: ticket.ticketId,
                targetType: 'kanwil',
                targetName: config.kanwil.name,
                targetNumber: config.kanwil.phone,
                message: kanwilMsg,
                status: kanwilResult.success ? 'sent' : 'failed',
                response: JSON.stringify(kanwilResult),
              });

              log.info(`Kanwil: ${kanwilResult.success ? '✅' : '❌'} → ${config.kanwil.phone}`);
              await sleep(2000);
            }

            // 2. KIRIM KE GROUP WA
            const groupMsg = buildGroupMessage(ticket);
            const personalMsgs = (ticket.matchingAdmins || []).map((admin) => ({
              admin,
              message: buildPersonalMessage(ticket, admin),
            }));

            const results = await sendTicketNotification(
              ticket,
              groupEnabled ? groupMsg : null,
              personalEnabled ? personalMsgs : []
            );

            if (results.group && results.group.success) notifiedGroup = true;
            if (results.personal.some((r) => r.success)) notifiedAdmin = true;

            markTicketProcessed(ticket, { notifiedGroup, notifiedAdmin });
            await sleep(3000);
          }

          log.info(`✅ Notifikasi terkirim untuk ${newTickets.length} tiket baru`);
        } else {
          for (const ticket of newTickets) {
            markTicketProcessed(ticket, { notifiedGroup: false, notifiedAdmin: false });
          }
          log.warn('Notifikasi dinonaktifkan, tiket hanya direcord');
        }
      }

      // Save cookies to keep session
      const freshCookies = await page.cookies();
      fs.writeFileSync(COOKIE_PATH, JSON.stringify(freshCookies, null, 2));

      ConfigModel.set('scraper_status', 'idle');
      log.info(`Cycle #${scrapeCount} selesai. Next in ${config.app.scrapeInterval / 1000}s`);

    } catch (error) {
      log.error('Error in scrape cycle', { error: error.message });
      ConfigModel.set('scraper_status', 'error');
    }

    await sleep(config.app.scrapeInterval);
  }
}

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n⏎  ${prompt} `, () => { rl.close(); resolve(); });
  });
}

// Graceful shutdown
async function shutdown(signal) {
  log.info(`${signal} received, shutting down...`);
  ConfigModel.set('scraper_status', 'stopped');
  if (browser) await browser.close().catch(() => {});
  const { closeDatabase } = require('./database/init');
  closeDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (e) => log.error('Uncaught exception', { error: e.message }));
process.on('unhandledRejection', (r) => log.error('Unhandled rejection', { reason: String(r) }));

firstLogin().catch((e) => {
  log.error('Fatal error', { error: e.message });
  process.exit(1);
});
