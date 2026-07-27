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

  const reminderIntervalMinutes = parseInt(ConfigModel.get('reminder_interval_minutes') || '5', 10);

  // Synchronize status & info for ALL scraped tickets (Open, Closed, Resolved, etc.)
  for (const ticket of scrapedTickets) {
    if (!ticket.ticketId) continue;
    const processedData = TicketModel.isProcessed(ticket.ticketId);
    if (processedData) {
      TicketModel.updateInfo(ticket);
      if (processedData.status && ticket.status && processedData.status.toLowerCase() !== ticket.status.toLowerCase()) {
        log.info(`Ticket ${ticket.ticketId} status updated: ${processedData.status} ➔ ${ticket.status}`);
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

  for (const ticket of openTickets) {
    // Check if this ticket was already processed
    const processedData = TicketModel.isProcessed(ticket.ticketId);
    
    if (processedData) {
      // It is processed. Check if it needs a reminder.
      if (reminderIntervalMinutes > 0 && processedData.last_notified_at) {
        const lastNotifiedTime = new Date(processedData.last_notified_at).getTime();
        const now = Date.now();
        const minutesPassed = (now - lastNotifiedTime) / (1000 * 60);

        if (minutesPassed >= reminderIntervalMinutes) {
          log.info(`Ticket ${ticket.ticketId} still OPEN after ${Math.floor(minutesPassed)} minutes, triggering reminder.`);
          
          const matchingAdmins = AdminModel.findByKantor(ticket.kantorPertanahan);
          reminderTickets.push({ ...ticket, matchingAdmins, reminderCount: (processedData.reminder_count || 0) + 1 });
        }
      }
      continue;
    }

    // This is a new ticket — find matching admin
    const matchingAdmins = AdminModel.findByKantor(ticket.kantorPertanahan);

    if (matchingAdmins.length > 0) {
      log.info(`New open ticket found: ${ticket.ticketId}`, {
        customer: ticket.customer,
        kantor: ticket.kantorPertanahan,
        admins: matchingAdmins.map((a) => a.nama),
      });
    } else {
      log.warn(`New open ticket ${ticket.ticketId} — no matching admin found for: "${ticket.kantorPertanahan}"`);
    }

    newTickets.push({
      ...ticket,
      matchingAdmins,
    });
  }

  if (newTickets.length > 0 || reminderTickets.length > 0) {
    log.info(`Detected ${newTickets.length} new open ticket(s) and ${reminderTickets.length} reminder(s) to notify`);
  } else {
    log.debug('No tickets to notify');
  }

  return { newTickets, reminderTickets, allOpenTickets: openTickets };
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
