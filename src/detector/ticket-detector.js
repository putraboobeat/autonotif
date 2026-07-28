const { createLogger } = require('../utils/logger');
const { TicketModel, AdminModel, ConfigModel } = require('../database/models');

const log = createLogger('DETECTOR');

/**
 * Detect tickets that need notification (New open tickets + Reminders)
 * @param {Array} scrapedTickets - Tickets from the scraper
 * @returns {Object} { newTickets, reminderTickets }
 */
function detectTicketsToNotify(scrapedTickets) {
  const newTickets = [];
  const reminderTickets = [];
  const closedTickets = [];

  const reminderIntervalMinutes = parseInt(ConfigModel.get('reminder_interval_minutes') || '5', 10);

  // Synchronize status & info for ALL scraped tickets (Open, Closed, Resolved, etc.)
  for (const ticket of scrapedTickets) {
    if (!ticket.ticketId) continue;
    const processedData = TicketModel.isProcessed(ticket.ticketId);
    if (processedData) {
      const oldStatus = (processedData.status || '').toLowerCase();
      const newStatus = (ticket.status || '').toLowerCase();

      TicketModel.updateInfo(ticket);
      if (oldStatus !== newStatus) {
        log.info(`Ticket ${ticket.ticketId} status updated: ${processedData.status} ➔ ${ticket.status}`);
        // If it just changed from Open to Closed/Resolved, trigger appreciation announcement
        if (oldStatus === 'open' && (newStatus === 'closed' || newStatus === 'resolved')) {
          log.info(`🎉 Ticket ${ticket.ticketId} resolved! Triggering appreciation notification...`);
          const matchingAdmins = AdminModel.findByKantor(ticket.kantorPertanahan);
          closedTickets.push({ ...ticket, matchingAdmins, oldStatus: processedData.status });
        }
      }
    } else if (ticket.status && ticket.status.toLowerCase() !== 'open') {
      TicketModel.save(ticket);
      log.info(`Recorded existing non-open ticket: ${ticket.ticketId} (${ticket.status})`);
    }
  }

  // Filter only Open tickets
  const openTickets = scrapedTickets.filter(
    (ticket) => ticket.status && ticket.status.toLowerCase() === 'open'
  );

  log.debug(`Found ${openTickets.length} open tickets from scrape`);

function categorizeAdmins(allAdmins) {
  const matchingAdmins = [];
  const ktuAdmins = [];
  (allAdmins || []).forEach(a => {
    const nm = (a.nama || '').toLowerCase();
    const jb = (a.jabatan || '').toLowerCase();

    if (a.no_hp_ktu && a.no_hp_ktu.trim() !== '') {
      ktuAdmins.push({
        nama: a.nama_ktu || 'Kasubbag Tata Usaha',
        no_hp: a.no_hp_ktu,
        kantor_pertanahan: a.kantor_pertanahan,
        jabatan: 'kasubbag_tu'
      });
    }

    if (jb === 'kasubbag_tu' || nm.includes('kasubbag') || nm.includes('tata usaha') || nm.includes('ktu')) {
      if (!ktuAdmins.some(k => k.no_hp === a.no_hp)) {
        ktuAdmins.push(a);
      }
    } else {
      matchingAdmins.push(a);
    }
  });
  if (matchingAdmins.length === 0 && ktuAdmins.length > 0) {
    matchingAdmins.push(...ktuAdmins);
  }
  return { matchingAdmins, ktuAdmins };
}

  for (const ticket of openTickets) {
    // Check if this ticket was already processed
    const processedData = TicketModel.isProcessed(ticket.ticketId);
    
    if (processedData) {
      // It is processed. Check if it needs a reminder.
      if (reminderIntervalMinutes > 0 && processedData.last_notified_at) {
        const lastNotifiedTime = new Date(processedData.last_notified_at).getTime();
        const firstNotifiedTime = new Date(processedData.notified_at || processedData.last_notified_at).getTime();
        const now = Date.now();
        const minutesPassed = (now - lastNotifiedTime) / (1000 * 60);
        const hoursOpen = (now - firstNotifiedTime) / (1000 * 60 * 60);

        if (minutesPassed >= reminderIntervalMinutes) {
          const reminderCount = (processedData.reminder_count || 0) + 1;
          const isOver24Hours = hoursOpen >= 24 || reminderCount >= 10;
          const isEscalation = reminderCount >= 5 || isOver24Hours;
          log.info(`Ticket ${ticket.ticketId} still OPEN after ${Math.floor(hoursOpen)} hours (${Math.floor(minutesPassed)}m since last reminder), triggering reminder #${reminderCount}${isOver24Hours ? ' (ESKALASI 1x24 JAM KE KASUBBAG TU & HUMAS!)' : isEscalation ? ' (ESKALASI)' : ''}.`);
          
          const allFound = AdminModel.findByKantor(ticket.kantorPertanahan);
          const { matchingAdmins, ktuAdmins } = categorizeAdmins(allFound);
          reminderTickets.push({ ...ticket, matchingAdmins, ktuAdmins, reminderCount, isEscalation, isOver24Hours });
        }
      }
      continue;
    }

    // This is a new ticket — find matching admin
    const resolvedKantor = ticket.kantorPertanahan || '';
    const allFound = AdminModel.findByKantor(resolvedKantor);
    const { matchingAdmins, ktuAdmins } = categorizeAdmins(allFound);

    if (matchingAdmins.length > 0) {
      log.info(`🔒 KANTAH LOCK — Tiket baru ${ticket.ticketId} => "${resolvedKantor}" (dari Agent: "${(ticket.agent || '').split('\n')[0]}") — ${matchingAdmins.length} admin cocok: [${matchingAdmins.map((a) => a.nama).join(', ')}]`);
    } else {
      log.warn(`⚠️ KANTAH LOCK — Tiket baru ${ticket.ticketId} => "${resolvedKantor}" (dari Agent: "${(ticket.agent || '').split('\n')[0]}") — TIDAK ADA ADMIN COCOK!`);
    }

    newTickets.push({
      ...ticket,
      matchingAdmins,
      ktuAdmins,
    });
  }

  if (newTickets.length > 0 || reminderTickets.length > 0 || closedTickets.length > 0) {
    log.info(`Detected ${newTickets.length} new open ticket(s), ${reminderTickets.length} reminder(s), and ${closedTickets.length} closed ticket(s) to notify`);
  } else {
    log.debug('No tickets to notify');
  }

  return { newTickets, reminderTickets, closedTickets, allOpenTickets: openTickets };
}

/**
 * Mark a ticket as processed in the database
 */
function markTicketProcessed(ticket, { notifiedGroup = false, notifiedAdmin = false, isReminder = false } = {}) {
  try {
    if (isReminder) {
      TicketModel.updateNotificationStatus(ticket.ticketId, { notifiedGroup, notifiedAdmin, isReminder: true });
      log.debug(`Ticket ${ticket.ticketId} reminder marked in database`);
    } else {
      TicketModel.save({
        ticketId: ticket.ticketId,
        customer: ticket.customer,
        agent: ticket.agent,
        kantorPertanahan: ticket.kantorPertanahan,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        subCategory: ticket.subCategory,
        subject: ticket.subject,
        createdDate: ticket.createdDate,
        lastUpdate: ticket.lastUpdate,
        notifiedGroup,
        notifiedAdmin,
      });
      log.debug(`Ticket ${ticket.ticketId} marked as processed in database`);
    }
  } catch (error) {
    log.error(`Failed to mark ticket ${ticket.ticketId} as processed`, { error: error.message });
  }
}

module.exports = {
  detectTicketsToNotify,
  markTicketProcessed,
};
