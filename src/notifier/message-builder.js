/**
 * Build WhatsApp notification messages
 */
const { renderTemplate } = require('./templates');

function formatMention(phone) {
  if (!phone) return '';
  let clean = phone.toString().replace(/\D/g, '');
  if (clean.startsWith('0')) {
    clean = '62' + clean.slice(1);
  }
  return `@${clean}`;
}

/**
 * Helper to format field and add "(belum diinput detail oleh admin kantah)" if empty or "-"
 */
function formatField(val, isDetail = false) {
  if (val === undefined || val === null || val === '') {
    return isDetail ? '- (belum diinput detail oleh admin kantah)' : '-';
  }
  const str = String(val).trim();
  if (str === '' || str === '-' || str === '--') {
    return isDetail ? '- (belum diinput detail oleh admin kantah)' : '-';
  }
  return str;
}

/**
 * Build group notification message
 */
function buildGroupMessage(ticket, groupName, allOpenTickets) {
  const mentions = (ticket.matchingAdmins || [])
    .map((a) => formatMention(a.no_hp))
    .filter(Boolean)
    .join(' ') || 'Admin Kantah Terkait';

  let msg = renderTemplate('template_new_group', {
    ticketId: ticket.ticketId,
    customer: ticket.customer,
    kantor: ticket.kantorPertanahan,
    subjek: ticket.subject || ticket.category,
    kategori: ticket.category,
    tanggal: ticket.createdDate,
    lastUpdate: ticket.lastUpdate,
    mentions: mentions
  });

  if (allOpenTickets && allOpenTickets.length > 0) {
    msg += `\n\n*Catatan Pengawasan*: Saat ini terdapat total ${allOpenTickets.length} pengaduan masyarakat berstatus OPEN yang masih menunggu penyelesaian.`;
  }

  return msg;
}

/**
 * Build personal notification message for admin
 */
function buildPersonalMessage(ticket, admin) {
  return renderTemplate('template_new_personal', {
    ticketId: ticket.ticketId,
    customer: ticket.customer,
    kantor: admin.kantor_pertanahan || ticket.kantorPertanahan,
    adminNama: admin.nama,
    subjek: ticket.subject || ticket.category,
    kategori: ticket.category,
    tanggal: ticket.createdDate,
    lastUpdate: ticket.lastUpdate
  });
}

/**
 * Build notification message for Admin Kanwil (receives ALL complaints)
 */
function buildKanwilMessage(ticket, adminName) {
  return renderTemplate('template_new_kanwil', {
    ticketId: ticket.ticketId,
    customer: ticket.customer,
    kantor: ticket.kantorPertanahan,
    subjek: ticket.subject || ticket.category,
    kategori: ticket.category,
    tanggal: ticket.createdDate,
    lastUpdate: ticket.lastUpdate
  });
}

/**
 * Build group reminder notification message
 */
function buildGroupReminderMessage(ticket, groupName, reminderCount) {
  const mentions = (ticket.matchingAdmins || [])
    .map((a) => formatMention(a.no_hp))
    .filter(Boolean)
    .join(' ') || 'Admin Kantah Terkait';

  return renderTemplate('template_reminder_group', {
    ticketId: ticket.ticketId,
    customer: ticket.customer,
    kantor: ticket.kantorPertanahan,
    subjek: ticket.subject || ticket.category,
    kategori: ticket.category,
    tanggal: ticket.createdDate,
    lastUpdate: ticket.lastUpdate,
    reminderCount: reminderCount,
    mentions: mentions
  });
}

/**
 * Build personal reminder notification message
 */
function buildPersonalReminderMessage(ticket, adminData, reminderCount) {
  return renderTemplate('template_reminder_personal', {
    ticketId: ticket.ticketId,
    customer: ticket.customer,
    kantor: adminData.kantor_pertanahan || ticket.kantorPertanahan,
    adminNama: adminData.nama,
    subjek: ticket.subject || ticket.category,
    kategori: ticket.category,
    tanggal: ticket.createdDate,
    lastUpdate: ticket.lastUpdate,
    reminderCount: reminderCount
  });
}

/**
 * Build test message
 */
function buildTestMessage() {
  const now = new Date().toLocaleString('id-ID');
  return [
    '*Informasi Uji Coba Sistem*',
    '',
    `Assalamualaikum rekan-rekan,`,
    '',
    `Pesan ini merupakan pengiriman uji coba dari sistem pemantauan pengaduan masyarakat ATR/BPN Provinsi Aceh.`,
    `Waktu Tes: ${now}`,
    '',
    'Jika pesan ini diterima dengan baik, seluruh integrasi notifikasi berjalan lancar dan siap memantau layanan.',
    '',
    'Salam,',
    '_Admin Kanwil ATR/BPN Provinsi Aceh_'
  ].join('\n');
}

/**
 * Build consolidated reminder summary list for WhatsApp Group
 */
function buildGroupReminderSummaryMessage(openTickets, groupName) {
  const { AdminModel } = require('../database/models');
  const lines = [
    '*Daftar Rekapitulasi Pengaduan Masyarakat Belum Selesai (OPEN)*',
    '',
    `Assalamualaikum rekan-rekan di grup *${groupName || 'WhatsApp'}*,`,
    '',
    'Berikut adalah daftar tiket pengaduan masyarakat yang masih tercatat berstatus OPEN pada aplikasi OCA Interaction dan memerlukan perhatian bersama:',
    ''
  ];

  const allMentions = new Set();

  openTickets.forEach((ticket, idx) => {
    const admins = AdminModel.findByKantor(ticket.kantorPertanahan) || [];
    const adminNames = admins.map(a => `${a.nama} (${formatMention(a.no_hp)})`).join(', ') || 'Admin wilayah terkait';
    admins.forEach(a => {
      const m = formatMention(a.no_hp);
      if (m) allMentions.add(m);
    });

    const badge = ticket.isEscalation ? '[ESKALASI KANWIL] ' : '';

    lines.push(
      `*${idx + 1}. ${badge}No. Tiket*: ${ticket.ticketId}`,
      `   *Kantor*: ${formatField(ticket.kantorPertanahan)}`,
      `   *Pelapor*: ${formatField(ticket.customer)}`,
      `   *Kategori*: ${formatField(ticket.category, true)}`,
      `   *Subjek*: ${formatField(ticket.subject || ticket.category, true)}`,
      `   *Tanggal Masuk*: ${formatField(ticket.createdDate, true)}`,
      `   *Last Update*: ${formatField(ticket.lastUpdate || ticket.createdDate, true)}`,
      `   *Admin Terkait*: ${adminNames}`,
      ''
    );
  });

  const tagsList = Array.from(allMentions).join(' ');
  if (tagsList) {
    lines.push(
      `Kepada rekan-rekan ${tagsList}, mohon kiranya dapat segera ditindaklanjuti dan diselesaikan melalui OCA Interaction agar pelayanan terbaik tetap terjaga.`,
      ''
    );
  }

  lines.push(
    'Terima kasih atas dedikasi dan perhatian seluruh rekan-rekan.',
    '',
    'Salam,',
    '_Admin Kanwil ATR/BPN Provinsi Aceh_'
  );
  return lines.join('\n');
}

/**
 * Build group notification for newly resolved/closed tickets
 */
function buildClosedTicketGroupMessage(closedTickets) {
  if (closedTickets.length === 1) {
    const ticket = closedTickets[0];
    const admins = ticket.matchingAdmins || [];
    const mentions = admins.map(a => formatMention(a.no_hp)).filter(Boolean).join(' ') || 'Admin Kantah Terkait';
    return renderTemplate('template_closed_group', {
      ticketId: ticket.ticketId,
      customer: ticket.customer,
      kantor: ticket.kantorPertanahan,
      subjek: ticket.subject || ticket.category,
      kategori: ticket.category,
      tanggal: ticket.createdDate,
      lastUpdate: ticket.lastUpdate || ticket.createdDate,
      mentions: mentions
    });
  }

  const lines = [
    '*Informasi Penyelesaian Pengaduan*',
    '',
    'Alhamdulillah rekan-rekan,',
    '',
    `Sistem memantau terdapat *${closedTickets.length} pengaduan masyarakat* yang baru saja berhasil ditangani dan diubah statusnya menjadi CLOSED pada OCA Interaction:`,
    ''
  ];

  const allMentions = new Set();

  closedTickets.forEach((ticket, idx) => {
    const admins = ticket.matchingAdmins || [];
    const tagList = admins.map(a => formatMention(a.no_hp)).filter(Boolean).join(' ');
    if (tagList) {
      admins.forEach(a => {
        const m = formatMention(a.no_hp);
        if (m) allMentions.add(m);
      });
    }

    lines.push(
      `*${idx + 1}. No. Tiket*: ${ticket.ticketId}`,
      `   *Kantor*: ${formatField(ticket.kantorPertanahan)}`,
      `   *Pelapor*: ${formatField(ticket.customer)}`,
      `   *Kategori*: ${formatField(ticket.category, true)}`,
      `   *Subjek*: ${formatField(ticket.subject || ticket.category, true)}`,
      `   *Tanggal Masuk*: ${formatField(ticket.createdDate, true)}`,
      `   *Last Update*: ${formatField(ticket.lastUpdate || ticket.createdDate, true)}`,
      `   *Penanggung Jawab*: ${tagList || 'Admin Wilayah Terkait'}`,
      ''
    );
  });

  lines.push(
    'Terima kasih banyak atas kecepatan dan kualitas layanan dari rekan-rekan yang bertugas. Mari terus perpanjang rekam jejak pelayanan prima kita.',
    '',
    'Salam,',
    '_Admin Kanwil ATR/BPN Provinsi Aceh_'
  );

  return lines.join('\n');
}

module.exports = {
  buildGroupMessage,
  buildPersonalMessage,
  buildKanwilMessage,
  buildGroupReminderMessage,
  buildPersonalReminderMessage,
  buildGroupReminderSummaryMessage,
  buildClosedTicketGroupMessage,
  buildTestMessage,
};
