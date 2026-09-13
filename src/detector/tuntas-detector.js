const { createLogger } = require('../utils/logger');
const { TuntasTicketModel } = require('../database/models');

const log = createLogger('TUNTAS-DETECTOR');

function detectTuntasTickets(scrapedTickets) {
  const newTickets = [];

  for (const ticket of scrapedTickets) {
    if (!ticket.ticketId) continue;
    
    const processedData = TuntasTicketModel.isProcessed(ticket.ticketId);
    
    if (processedData) {
      // Cek apakah status berubah
      if (processedData.status !== ticket.status) {
        log.info(`Status tiket Tuntas ${ticket.ticketId} berubah: ${processedData.status} ➔ ${ticket.status}`);
        TuntasTicketModel.save(ticket);
      }
    } else {
      if (ticket.status.toLowerCase() === 'open') {
        log.info(`Tiket Tuntas baru terdeteksi: ${ticket.ticketId}`);
        newTickets.push(ticket);
      } else {
        // Simpan tiket lama tapi abaikan untuk notifikasi
        TuntasTicketModel.save(ticket);
      }
    }
  }

  return { newTickets };
}

function markTuntasTicketProcessed(ticket, { notifiedGroup = false } = {}) {
  try {
    TuntasTicketModel.save(ticket);
    TuntasTicketModel.updateNotificationStatus(ticket.ticketId, { notifiedGroup });
    log.debug(`Ticket Tuntas ${ticket.ticketId} marked as processed`);
  } catch (error) {
    log.error(`Failed to mark Tuntas ticket ${ticket.ticketId} as processed`, { error: error.message });
  }
}

module.exports = {
  detectTuntasTickets,
  markTuntasTicketProcessed
};
