const { config, validateConfig } = require('./config');
const { createLogger } = require('./utils/logger');
const { sleep } = require('./utils/helpers');
const { initDatabase } = require('./database/init');
const { ConfigModel } = require('./database/models');
const { launchBrowser, closeBrowser, isBrowserAlive } = require('./scraper/browser');
const { performLogin } = require('./scraper/login');
const { scrapeAllOpenTickets } = require('./scraper/ticket-scraper');
const { detectNewOpenTickets, markTicketProcessed } = require('./detector/ticket-detector');
const { sendTicketNotification, sendPersonalMessage } = require('./notifier/starsender');
const { buildGroupMessage, buildPersonalMessage, buildKanwilMessage } = require('./notifier/message-builder');
const { NotificationLogModel } = require('./database/models');
const { startDashboard } = require('./dashboard/server');

const log = createLogger('MAIN');

let isRunning = false;
let scrapeCount = 0;

let isScraping = false;

/**
 * Main scraping cycle
 */
async function scrapeCycle() {
  if (isScraping) {
    log.debug('Scrape cycle is already running, waiting for completion...');
    while (isScraping) {
      await sleep(500);
    }
    return;
  }
  isScraping = true;
  try {
    const { isLoggedIn } = require('./scraper/login');
    const { getPage } = require('./scraper/browser');
    const loggedIn = await isLoggedIn(getPage()).catch(() => false);
    if (!loggedIn) {
      if (config.oca.totpSecret) {
        log.info('Not logged in, but TOTP Secret is configured. Triggering full auto-login...');
        const { startLoginInteractive } = require('./scraper/login-controller');
        
        // Let it run in background and skip this scrape cycle
        startLoginInteractive(config.oca.email, config.oca.password).catch(err => {
          log.error('Full auto-login failed', { error: err.message });
        });
        
        ConfigModel.set('scraper_status', 'idle');
        await sleep(10000); // give it some time
        return;
      }

      log.warn('Not logged in. Waiting for user to login via Dashboard UI...');
      ConfigModel.set('scraper_status', 'idle');
      await sleep(config.app.scrapeInterval);
      return;
    }

    scrapeCount++;
    log.info(`=== Scrape cycle #${scrapeCount} ===`);

    // Update status
    ConfigModel.set('scraper_status', 'running');
    ConfigModel.set('last_scrape_time', new Date().toISOString());

    // 2. Detect tickets to notify
    const { detectTicketsToNotify, markTicketProcessed } = require('./detector/ticket-detector');
    const { newTickets, reminderTickets, allOpenTickets } = detectTicketsToNotify(await scrapeAllOpenTickets());

    // Common config
    const notifEnabled = ConfigModel.get('notification_enabled') !== '0';
    const groupEnabled = ConfigModel.get('group_notification_enabled') !== '0';
    const personalEnabled = ConfigModel.get('personal_notification_enabled') !== '0';
    const waGroupId = ConfigModel.get('wa_group_id') || config.wa.groupName;

    if (!notifEnabled) {
      log.warn('Notifications are disabled. Skipping...');
      // Mark as processed without sending
      for (const ticket of newTickets) {
        markTicketProcessed(ticket, { notifiedGroup: false, notifiedAdmin: false });
      }
    } else {
      // === PROCESS NEW TICKETS ===
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
          await sleep(2000);
        }

        // 2. KIRIM KE GROUP WA
        const groupMsg = buildGroupMessage(ticket, waGroupId, allOpenTickets);
        const personalMsgs = (ticket.matchingAdmins || []).map((admin) => ({
          admin,
          message: buildPersonalMessage(ticket, admin),
        }));

        const results = await sendTicketNotification(
          ticket,
          groupEnabled ? waGroupId : null,
          groupEnabled ? groupMsg : null,
          personalEnabled ? personalMsgs : []
        );

        if (results.group && results.group.success) notifiedGroup = true;
        if (results.personal.some((r) => r.success)) notifiedAdmin = true;

        markTicketProcessed(ticket, { notifiedGroup, notifiedAdmin });
        await sleep(3000);
      }

      // === PROCESS REMINDER TICKETS ===
      const { buildGroupReminderMessage, buildPersonalReminderMessage, buildGroupReminderSummaryMessage } = require('./notifier/message-builder');
      const { sendGroupMessage } = require('./notifier/starsender');

      // 1. Kirim REKAP DAFTAR SEMUA TIKET BELUM CLOSED ke Group WA (hanya 1 pesan daftar, tidak spam)
      let groupSummarySuccess = false;
      if (reminderTickets.length > 0 && groupEnabled && waGroupId) {
        log.info(`Sending summary reminder of open tickets to group "${waGroupId}"...`);
        const summaryMsg = buildGroupReminderSummaryMessage(allOpenTickets || reminderTickets, waGroupId);
        const groupRes = await sendGroupMessage(waGroupId, summaryMsg);
        groupSummarySuccess = groupRes && groupRes.success;
        
        NotificationLogModel.create({
          ticketId: 'REMINDER_SUMMARY',
          targetType: 'group',
          targetName: waGroupId,
          targetNumber: waGroupId,
          message: summaryMsg,
          status: groupSummarySuccess ? 'sent' : 'failed',
          response: JSON.stringify(groupRes),
        });
        await sleep(3000);
      }

      // 2. Kirim reminder personal ke admin kantah terkait dan Admin Kanwil
      for (const ticket of reminderTickets) {
        const rc = ticket.reminderCount;

        // Kirim reminder juga ke Admin Utama (Kanwil dari .env)
        if (config.kanwil.phone) {
          const kanwilRemMsg = `⚠️ *REMINDER KANWIL*: Tiket #${ticket.ticketId} (${ticket.kantorPertanahan}) masih berstatus OPEN dan belum diselesaikan (Reminder ke-${rc}).`;
          await sendPersonalMessage(config.kanwil.phone, kanwilRemMsg);
        }

        const personalRemMsgs = (ticket.matchingAdmins || []).map((admin) => ({
          admin,
          message: buildPersonalReminderMessage(ticket, admin, rc),
        }));

        const results = await sendTicketNotification(
          ticket,
          null, // Group notification sudah terangkum dalam 1 pesan rekap daftar di atas
          null,
          personalEnabled ? personalRemMsgs : []
        );

        let notifiedAdmin = results.personal.some((r) => r.success) ? true : false;

        markTicketProcessed(ticket, { notifiedGroup: groupSummarySuccess, notifiedAdmin, isReminder: true });
        await sleep(3000);
      }
    } ConfigModel.set('scraper_status', 'idle');
    log.info(`Scrape cycle #${scrapeCount} complete. Next in ${config.app.scrapeInterval / 1000}s`);

  } catch (error) {
    log.error('Error in scrape cycle', { error: error.message, stack: error.stack });
    ConfigModel.set('scraper_status', 'error');

    // If browser crashed, try to recover
    if (error.message.includes('Target closed') || error.message.includes('Session closed') || error.message.includes('Navigation timeout')) {
      log.warn('Browser issue detected, will restart on next cycle');
      try {
        await closeBrowser();
      } catch {}
    }
  } finally {
    isScraping = false;
  }
}

global.triggerManualScrape = () => scrapeCycle();

/**
 * Main application entry point
 */
async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║     🔔 Auto Notif Pengaduan — WhatsApp Bot     ║');
  console.log('║     Monitoring OCA Interaction Tickets          ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\n');

  // Validate config
  const isValid = validateConfig();
  if (!isValid) {
    log.warn('Some config values are missing. System will start but notifications may fail.');
  }

  // Initialize database
  log.info('Initializing database...');
  initDatabase();

  // Start dashboard server
  log.info('Starting admin dashboard...');
  startDashboard();

  // Launch browser
  log.info('Launching browser...');
  await launchBrowser();

  // Initialize login status
  const { isLoggedIn } = require('./scraper/login');
  const logged = await isLoggedIn(require('./scraper/browser').getPage());
  if (!logged) {
    log.info('Not logged in. Waiting for user to login via Dashboard UI...');
    ConfigModel.set('scraper_status', 'idle');
  } else {
    log.info('Already logged in!');
  }

  // Start scraping loop
  isRunning = true;
  log.info(`Starting scrape loop (interval: ${config.app.scrapeInterval / 1000}s)...`);

  while (isRunning) {
    await scrapeCycle();
    await sleep(config.app.scrapeInterval);
  }
}

// Graceful shutdown
async function shutdown(signal) {
  log.info(`Received ${signal}. Shutting down gracefully...`);
  isRunning = false;
  ConfigModel.set('scraper_status', 'stopped');
  await closeBrowser();
  const { closeDatabase } = require('./database/init');
  closeDatabase();
  log.info('Shutdown complete.');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception', { error: error.message, stack: error.stack });
});
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection', { reason: String(reason) });
});

// Start the application
main().catch((error) => {
  log.error('Fatal error', { error: error.message, stack: error.stack });
  process.exit(1);
});
