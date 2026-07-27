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
 * Build group notification message
 */
function buildGroupMessage(ticket, groupName, allOpenTickets) {
  const lines = [
    '🔔 *NOTIFIKASI PENGADUAN BARU*',
    '',
    `Ada pengaduan masuk di group *${groupName || 'WhatsApp'}*:`,
    `👤 *Customer*: ${ticket.customer || '-'}`,
    `🏢 *Kantor*: ${ticket.kantorPertanahan || '-'}`,
  ];

  if (ticket.agent) {
    lines.push(`📁 *Agent*: ${ticket.agent.split('\n')[0]}`);
  }

  lines.push(
    `⚡ *Status*: ${ticket.status}`,
    `📌 *Priority*: ${ticket.priority || '-'}`,
  );

  if (ticket.category) {
    lines.push(`📂 *Kategori*: ${ticket.category}`);
  }

  if (ticket.subCategory) {
    lines.push(`📎 *Sub Kategori*: ${ticket.subCategory}`);
  }

  if (ticket.subject) {
    lines.push(`📝 *Subject*: ${ticket.subject}`);
  }

  lines.push(
    `📅 *Tanggal*: ${ticket.createdDate || '-'}`,
    '',
  );

  if (ticket.matchingAdmins && ticket.matchingAdmins.length > 0) {
    const mentions = ticket.matchingAdmins
      .map((a) => `${a.nama} (${formatMention(a.no_hp)})`)
      .join('\n• ');
    const tagOnly = ticket.matchingAdmins
      .map((a) => formatMention(a.no_hp))
      .filter(Boolean)
      .join(' ');
    lines.push(
      `✅ *Admin Terkait*: \n• ${mentions}`,
      '',
      `👉 Mohon segera dicek & ditindaklanjuti: ${tagOnly}`
    );
  } else {
    lines.push('⚠️ Belum ada admin terdaftar untuk kantor ini.');
  }

  if (allOpenTickets && allOpenTickets.length > 0) {
    lines.push('', `📊 *Total Tiket Belum Selesai (OPEN) Saat Ini*: ${allOpenTickets.length} tiket.`);
  }

  return lines.join('\n');
}

/**
 * Build personal notification message for admin
 */
function buildPersonalMessage(ticket, admin) {
  const lines = [
    '🔔 *NOTIFIKASI PENGADUAN*',
    '',
    `Halo *${admin.nama}*,`,
    '',
    `Ada tiket pengaduan baru yang ditujukan ke *${admin.kantor_pertanahan}*:`,
    '',
    `📋 *Ticket ID*: ${ticket.ticketId}`,
    `👤 *Customer*: ${ticket.customer || '-'}`,
    `⚡ *Priority*: ${ticket.priority || '-'}`,
  ];

  if (ticket.category) {
    lines.push(`📂 *Kategori*: ${ticket.category}`);
  }

  if (ticket.subject) {
    lines.push(`📝 *Subject*: ${ticket.subject}`);
  }

  lines.push(
    `📅 *Tanggal*: ${ticket.createdDate || '-'}`,
    '',
    'Silahkan segera ditangani melalui:',
    '🔗 https://interaction.ocaindonesia.co.id/',
    '',
    'Terima kasih 🙏',
  );

  return lines.join('\n');
}

/**
 * Build notification message for Admin Kanwil (receives ALL complaints)
 */
function buildKanwilMessage(ticket, adminName) {
  const lines = [
    `🔔 *NOTIFIKASI PENGADUAN BARU*`,
    '',
    `Kepada Yth. Admin Kanwil ${adminName || ''},`,
    '',
    `Terdapat pengaduan baru masuk pada sistem OCA Interaction untuk *Kantor Pertanahan ${ticket.kantorPertanahan || '-'}*.`,
    '',
    `📋 *Ticket ID*: ${ticket.ticketId}`,
    `👤 *Customer*: ${ticket.customer || '-'}`,
    `🏢 *Kantor*: ${ticket.kantorPertanahan || '-'}`,
    `🔖 *Kategori*: ${ticket.category || '-'}`,
    `💬 *Subjek*: ${ticket.subject || '-'}`,
    `📅 *Tanggal*: ${ticket.createdDate || '-'}`,
    '',
    `Harap pantau tindak lanjut dari admin kantor terkait.`,
    '',
    `_Pesan Otomatis dari Sistem_`
  ];
  return lines.join('\n');
}

/**
 * Build group reminder notification message
 */
function buildGroupReminderMessage(ticket, groupName, reminderCount) {
  const isEscalation = ticket.isEscalation || reminderCount >= 5;
  const lines = [
    isEscalation ? '🚨 *[ESKALASI KANWIL] PERINGATAN PENGADUAN DARURAT* 🚨' : '⚠️ *REMINDER: PENGADUAN BELUM DISELESAIKAN* ⚠️',
    '',
    `Pengaduan di group *${groupName || 'WhatsApp'}* ini masih berstatus OPEN (Reminder ke-${reminderCount}):`,
    `📋 *Ticket ID*: ${ticket.ticketId}`,
    `👤 *Customer*: ${ticket.customer || '-'}`,
    `🏢 *Kantor*: ${ticket.kantorPertanahan || '-'}`,
    '',
    isEscalation 
      ? `🔥 *PENGADUAN INI TELAH MELEWATI >${reminderCount}X PENGINGAT!* Mohon perhatian serius dari pimpinan & admin bertugas.` 
      : `Harap segera ditindaklanjuti pada Dashboard OCA Interaction.`,
    ''
  ];

  if (ticket.matchingAdmins && ticket.matchingAdmins.length > 0) {
    const tagOnly = ticket.matchingAdmins
      .map((a) => formatMention(a.no_hp))
      .filter(Boolean)
      .join(' ');
    lines.push(`🚨 *PERINGATAN UNTUK*: ${tagOnly}`, '');
  }

  lines.push(`_Pesan Otomatis dari Sistem_`);
  return lines.join('\n');
}

/**
 * Build personal reminder notification message
 */
function buildPersonalReminderMessage(ticket, adminData, reminderCount) {
  const isEscalation = ticket.isEscalation || reminderCount >= 5;
  const lines = [
    isEscalation ? `🚨 *[ESKALASI] PERINGATAN DARURAT: ${adminData.kantor_pertanahan}* 🚨` : `⚠️ *REMINDER PENGADUAN: ${adminData.kantor_pertanahan}* ⚠️`,
    '',
    `Kepada Yth. Sdr/i *${adminData.nama}*,`,
    '',
    `Pengaduan berikut masih berstatus OPEN dan belum diselesaikan (Reminder ke-${reminderCount}):`,
    '',
    `📋 *Ticket ID*: ${ticket.ticketId}`,
    `👤 *Customer*: ${ticket.customer || '-'}`,
    `🔖 *Kategori*: ${ticket.category || '-'}`,
    `💬 *Subjek*: ${ticket.subject || '-'}`,
    `📅 *Tanggal Masuk*: ${ticket.createdDate || '-'}`,
    '',
    isEscalation 
      ? `🔥 *MOHON SEGERA DIPROSES DATANYA SEKARANG JUGA DI OCA!*` 
      : `Harap segera memproses pengaduan ini di OCA Interaction.`,
    '',
    `_Pesan Otomatis dari Sistem_`
  ];
  return lines.join('\n');
}

/**
 * Build test message
 */
function buildTestMessage() {
  const now = new Date().toLocaleString('id-ID');
  return [
    '🧪 *TEST NOTIFIKASI*',
    '',
    `Ini adalah pesan test dari sistem Auto Notif Pengaduan.`,
    `Waktu: ${now}`,
    '',
    'Jika Anda menerima pesan ini, sistem berjalan dengan baik ✅',
  ].join('\n');
}

/**
 * Build consolidated reminder summary list for WhatsApp Group
 */
function buildGroupReminderSummaryMessage(openTickets, groupName) {
  const { AdminModel } = require('../database/models');
  const lines = [
    '⚠️ *REMINDER: DAFTAR PENGADUAN BELUM DISELESAIKAN (OPEN)* ⚠️',
    '',
    `Berikut adalah daftar tiket pengaduan di group *${groupName || 'WhatsApp'}* yang belum diselesaikan / closed:`,
    ''
  ];

  const allMentions = new Set();

  openTickets.forEach((ticket, idx) => {
    const admins = AdminModel.findByKantor(ticket.kantorPertanahan) || [];
    const adminNames = admins.map(a => `${a.nama} (${formatMention(a.no_hp)})`).join(', ') || 'Belum terdaftar';
    admins.forEach(a => {
      const m = formatMention(a.no_hp);
      if (m) allMentions.add(m);
    });

    const badge = ticket.isEscalation ? '🔥 [ESKALASI] ' : '';

    lines.push(
      `*${idx + 1}. ${badge}Tiket ID*: ${ticket.ticketId}`,
      `   🏢 *Kantor*: ${ticket.kantorPertanahan || '-'}`,
      `   👤 *Customer*: ${ticket.customer || '-'}`,
      `   🔖 *Subjek*: ${ticket.subject || ticket.category || '-'}`,
      `   👨‍💻 *Admin Terkait*: ${adminNames}`,
      ''
    );
  });

  const tagsList = Array.from(allMentions).join(' ');
  if (tagsList) {
    lines.push(
      `🚨 *MOHON SEGERA DITINDAKLANJUTI KEPADA ADMIN KANTAH & KANWIL*:`,
      `${tagsList}`,
      ''
    );
  }

  lines.push(`_Pesan Otomatis dari Sistem Auto Notif Pengaduan_`);
  return lines.join('\n');
}

/**
 * Build group notification for newly resolved/closed tickets
 */
function buildClosedTicketGroupMessage(closedTickets) {
  const lines = [
    '✅ *APRESIASI PENYELESAIAN PENGADUAN* 🎉',
    '',
    `Sistem memantau terdapat *${closedTickets.length} tiket pengaduan* yang baru saja bertukar status menjadi *CLOSED / RESOLVED* di OCA Interaction:`,
    ''
  ];

  const allMentions = new Set();

  closedTickets.forEach((ticket, idx) => {
    const admins = ticket.matchingAdmins || [];
    const tagList = admins
      .map(a => formatMention(a.no_hp))
      .filter(Boolean)
      .join(' ');
    if (tagList) {
      admins.forEach(a => {
        const m = formatMention(a.no_hp);
        if (m) allMentions.add(m);
      });
    }

    lines.push(
      `*${idx + 1}. Tiket ID*: ${ticket.ticketId} (${ticket.status})`,
      `   🏢 *Kantor*: ${ticket.kantorPertanahan || '-'}`,
      `   👤 *Customer*: ${ticket.customer || '-'}`,
      `   💬 *Subjek*: ${ticket.subject || ticket.category || '-'}`,
      `   👏 *Penanggung Jawab*: ${tagList || 'Admin Wilayah'}`,
      ''
    );
  });

  lines.push(
    '🙏 _Terima kasih atas respons cepat dan pelayanan prima kepada masyarakat!_',
    '_Pesan Otomatis dari Sistem Auto Notif Pengaduan_'
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
