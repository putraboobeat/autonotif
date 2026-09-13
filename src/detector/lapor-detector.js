const { createLogger } = require('../utils/logger');
const { LaporTicketModel } = require('../database/models');

const log = createLogger('LAPOR-DETECTOR');

function detectLaporTickets(scrapedTickets) {
  const newTickets = [];

  for (const ticket of scrapedTickets) {
    if (!ticket.ticketId) continue;
    
    const processedData = LaporTicketModel.isProcessed(ticket.ticketId);
    
    if (processedData) {
      // Cek apakah status berubah
      if (processedData.status !== ticket.status) {
        log.info(`Status tiket Lapor ${ticket.ticketId} berubah: ${processedData.status} ➔ ${ticket.status}`);
        LaporTicketModel.save(ticket);
      }
    } else {
      if (ticket.status.toLowerCase() === 'open') {
        log.info(`Tiket Lapor baru terdeteksi: ${ticket.ticketId}`);
        newTickets.push(ticket);
      } else {
        // Simpan tiket lama tapi abaikan untuk notifikasi
        LaporTicketModel.save(ticket);
      }
    }
  }

  return { newTickets };
}

function markLaporTicketProcessed(ticket, { notifiedGroup = false } = {}) {
  try {
    LaporTicketModel.save(ticket);
    LaporTicketModel.updateNotificationStatus(ticket.ticketId, { notifiedGroup });
    log.debug(`Ticket Lapor ${ticket.ticketId} marked as processed`);
  } catch (error) {
    log.error(`Failed to mark Lapor ticket ${ticket.ticketId} as processed`, { error: error.message });
  }
}

module.exports = {
  detectLaporTickets,
  markLaporTicketProcessed
};
