const { ConfigModel } = require('../database/models');

const TEMPLATE_DEFINITIONS = {
  template_new_group: {
    title: '1. Notifikasi Tiket Baru (Group WhatsApp)',
    description: 'Pesan perdana ke Grup WhatsApp saat aduan baru terdeteksi di OCA Interaction.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {kategori}, {tanggal}, {lastUpdate}, {mentions}',
    defaultText: `*Informasi Pengaduan Masuk*

Assalamualaikum rekan-rekan,

Mohon perhatiannya, baru saja masuk satu aduan dari masyarakat yang perlu segera ditindaklanjuti.

*No. Tiket*: {ticketId}
*Kantor Tujuan*: {kantor}
*Nama Pelapor*: {customer}
*Kategori*: {kategori}
*Subjek*: {subjek}
*Tanggal Masuk*: {tanggal}
*Last Update*: {lastUpdate}

Kepada {mentions} selaku admin yang bertugas, mohon segera dibuka dan diproses melalui aplikasi OCA Interaction. Terima kasih atas kesigapannya.`
  },

  template_new_personal: {
    title: '2. Notifikasi Tiket Baru (Japri Personal Admin Kantah)',
    description: 'Pesan langsung (japri) ke WhatsApp Admin Kantor Pertanahan terkait.',
    placeholders: '{ticketId}, {customer}, {kantor}, {adminNama}, {subjek}, {kategori}, {tanggal}, {lastUpdate}',
    defaultText: `Assalamualaikum Pak/Bu *{adminNama}*,

Mohon maaf mengganggu waktunya. Kami ingin menginformasikan bahwa ada satu tiket pengaduan baru yang masuk dan diarahkan ke *{kantor}*:

*No. Tiket*: {ticketId}
*Nama Pelapor*: {customer}
*Kategori*: {kategori}
*Subjek*: {subjek}
*Tanggal Masuk*: {tanggal}
*Last Update*: {lastUpdate}

Mohon kiranya bisa segera ditindaklanjuti melalui aplikasi OCA Interaction ya. Kalau ada kendala, jangan sungkan menghubungi kami.

Terima kasih banyak atas kerjasamanya.`
  },

  template_new_kanwil: {
    title: '3. Laporan Rekap Tiket Baru (Japri Admin Kanwil)',
    description: 'Laporan pemantauan ke nomor Admin Kanwil (Pengawas Utama) setiap kali ada aduan baru.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {kategori}, {tanggal}, {lastUpdate}',
    defaultText: `*Laporan Tiket Masuk*

Pak/Bu, berikut informasi aduan baru yang tercatat di sistem:

*No. Tiket*: {ticketId}
*Kantor Pertanahan*: {kantor}
*Pelapor*: {customer}
*Kategori*: {kategori}
*Subjek*: {subjek}
*Tanggal Masuk*: {tanggal}
*Last Update*: {lastUpdate}

Notifikasi sudah diteruskan ke admin kantah yang bersangkutan dan ke group.

_Sistem Pemantauan Pengaduan Kanwil_`
  },

  template_reminder_group: {
    title: '4. Peringatan Rutin / Reminder (Group WhatsApp)',
    description: 'Pesan pengingat di Grup jika tiket masih berstatus OPEN setelah jangka waktu tertentu.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {kategori}, {tanggal}, {lastUpdate}, {reminderCount}, {mentions}',
    defaultText: `*Pengingat Tiket Belum Selesai (ke-{reminderCount})*

Assalamualaikum rekan-rekan di *{kantor}*,

Mohon maaf kami ingatkan kembali, tiket pengaduan berikut masih tercatat belum diselesaikan di sistem:

*No. Tiket*: {ticketId}
*Pelapor*: {customer}
*Kategori*: {kategori}
*Subjek*: {subjek}
*Tanggal Masuk*: {tanggal}
*Last Update*: {lastUpdate}

Kepada {mentions}, mohon bisa dibantu untuk segera ditindaklanjuti agar tidak berlarut-larut. Mari sama-sama kita jaga kualitas pelayanan. Terima kasih.`
  },

  template_reminder_personal: {
    title: '5. Peringatan Rutin / Reminder (Japri Admin Kantah)',
    description: 'Pesan pengingat langsung (japri) ke admin kantor jika aduan masih OPEN.',
    placeholders: '{ticketId}, {customer}, {kantor}, {adminNama}, {subjek}, {kategori}, {tanggal}, {lastUpdate}, {reminderCount}',
    defaultText: `Assalamualaikum Pak/Bu *{adminNama}*,

Mohon maaf mengganggu lagi. Ini pengingat ke-{reminderCount} terkait pengaduan yang masih berstatus terbuka di OCA Interaction:

*No. Tiket*: {ticketId}
*Pelapor*: {customer}
*Kategori*: {kategori}
*Subjek*: {subjek}
*Tanggal Masuk*: {tanggal}
*Last Update*: {lastUpdate}

Kalau memungkinkan, mohon bisa segera direspons atau di-close ya Pak/Bu, agar tidak masuk ke tahap eskalasi.

Terima kasih banyak atas perhatiannya.`
  },

  template_reminder_kanwil: {
    title: '6. Peringatan Rutin (Japri Admin Kanwil)',
    description: 'Pesan peringatan pemantauan untuk Admin Kanwil pada tiket yang berulang kali diingatkan.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {kategori}, {tanggal}, {lastUpdate}, {reminderCount}',
    defaultText: `*Info Reminder*: Tiket No. {ticketId} dari {kantor} masih berstatus terbuka (Reminder ke-{reminderCount}).
*Kategori*: {kategori}
*Subjek*: {subjek}
*Tanggal Masuk*: {tanggal}
*Last Update*: {lastUpdate}

Sudah dikirimkan pengingat rutin ke admin kantah terkait.`
  },

  template_eskalasi_ktu: {
    title: '7. Eskalasi Darurat > 1 Hari (Japri Kasubbag Tata Usaha Kantah)',
    description: 'Laporan kritis langsung ke HP Kasubbag TU Kantor Pertanahan setempat jika admin abai > 24 jam.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {kategori}, {tanggal}, {lastUpdate}, {ktuNama}',
    defaultText: `Assalamualaikum Pak/Bu *{ktuNama}*,

Dengan hormat, kami dari Tim Pengawasan Kanwil ingin menyampaikan informasi bahwa terdapat satu tiket pengaduan di lingkungan *{kantor}* yang sudah melewati batas waktu 1x24 jam dan belum ditindaklanjuti oleh admin bertugas:

*No. Tiket*: {ticketId}
*Pelapor*: {customer}
*Kategori*: {kategori}
*Subjek*: {subjek}
*Tanggal Masuk*: {tanggal}
*Last Update*: {lastUpdate}

Kami mohon bantuan Bapak/Ibu selaku Kasubbag Tata Usaha untuk berkenan mengingatkan atau menginstruksikan admin yang bertanggung jawab agar segera memproses dan menutup tiket tersebut di OCA Interaction.

Atas perhatian dan arahannya, kami ucapkan terima kasih.`
  },

  template_eskalasi_humas: {
    title: '8. Eskalasi Darurat > 1 Hari (Japri Kasubbag Umum & Humas Kanwil)',
    description: 'Laporan rekap kritis ke Kasubbag Umum & Humas tingkat Wilayah (Kanwil) saat ada pelanggaran waktu 24 jam.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {kategori}, {tanggal}, {lastUpdate}, {reminderCount}',
    defaultText: `Assalamualaikum Pak/Bu Kasubbag,

Berikut kami laporkan bahwa terdapat pengaduan masyarakat yang sudah melewati batas waktu 1x24 jam dan belum diselesaikan:

*No. Tiket*: {ticketId}
*Kantor*: {kantor}
*Pelapor*: {customer}
*Kategori*: {kategori}
*Subjek*: {subjek}
*Tanggal Masuk*: {tanggal}
*Last Update*: {lastUpdate}
*Total Pengingat*: {reminderCount} kali

Kami sudah mengirimkan eskalasi juga ke Kasubbag Tata Usaha kantah terkait. Mohon arahan lebih lanjut dari Bapak/Ibu agar pelayanan tidak terhambat.

Terima kasih.`
  },

  template_closed_group: {
    title: '9. Apresiasi & Berhasil Closed (Group WhatsApp)',
    description: 'Pesan ucapan terima kasih di Grup ketika admin berhasil menyelesaikan aduan warga.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {kategori}, {tanggal}, {lastUpdate}, {mentions}',
    defaultText: `*Tiket Pengaduan Selesai*

Alhamdulillah, pengaduan berikut sudah berhasil ditangani dan ditutup:

*No. Tiket*: {ticketId}
*Kantor*: {kantor}
*Pelapor*: {customer}
*Kategori*: {kategori}
*Subjek*: {subjek}
*Tanggal Masuk*: {tanggal}
*Last Update*: {lastUpdate}
*Ditangani oleh*: {mentions}

Terima kasih banyak kepada rekan-rekan yang sudah sigap menindaklanjuti. Semoga kita bisa terus menjaga kecepatan dan kualitas pelayanan kepada masyarakat.`
  },

  template_manual_resend: {
    title: '10. Peringatan Manual dari Dashboard (Tombol Kirim Ulang)',
    description: 'Pesan peringatan khusus ketika admin kanwil mengeklik tombol "Kirim Ulang Peringatan" dari Dashboard web.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {kategori}, {tanggal}, {lastUpdate}, {adminNama}',
    defaultText: `Assalamualaikum Pak/Bu *{adminNama}*,

Pesan ini dikirimkan langsung oleh Tim Kanwil melalui Dashboard Pengawasan. Kami ingin meminta perhatian khusus untuk tiket pengaduan berikut yang belum diselesaikan:

*No. Tiket*: {ticketId}
*Pelapor*: {customer}
*Kategori*: {kategori}
*Subjek*: {subjek}
*Tanggal Masuk*: {tanggal}
*Last Update*: {lastUpdate}

Mohon saat ini bisa langsung dibuka dan ditindaklanjuti melalui OCA Interaction ya. Kami sangat mengapresiasi kecepatan respons Bapak/Ibu.`
  }
};

/**
 * Get all templates with their current values (or defaults) and metadata
 */
function getAllTemplates() {
  const result = {};
  for (const [key, def] of Object.entries(TEMPLATE_DEFINITIONS)) {
    const savedVal = ConfigModel.get(key);
    result[key] = {
      title: def.title,
      description: def.description,
      placeholders: def.placeholders,
      text: savedVal && savedVal.trim() !== '' ? savedVal : def.defaultText,
      defaultText: def.defaultText,
    };
  }
  return result;
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
 * Render a template by replacing placeholders with actual data
 */
function renderTemplate(key, data = {}) {
  const def = TEMPLATE_DEFINITIONS[key];
  if (!def) return '';

  const rawTemplate = ConfigModel.get(key) || def.defaultText;
  let text = rawTemplate;

  const replacements = {
    '{ticketId}': data.ticketId || data.ticket_id || '-',
    '{customer}': data.customer || '-',
    '{kantor}': data.kantor || data.kantorPertanahan || data.kantor_pertanahan || 'Kanwil BPN Prov Aceh',
    '{subjek}': formatField(data.subjek || data.subject || data.category, true),
    '{kategori}': formatField(data.kategori || data.category, true),
    '{tanggal}': formatField(data.tanggal || data.createdDate || data.created_date || data.created_at, true),
    '{lastUpdate}': formatField(data.lastUpdate || data.last_update || data.createdDate || data.created_date || data.created_at || data.tanggal, true),
    '{mentions}': data.mentions || '',
    '{adminNama}': data.adminNama || data.nama || 'Admin Kantah',
    '{ktuNama}': data.ktuNama || data.nama_ktu || 'Kasubbag Tata Usaha',
    '{reminderCount}': data.reminderCount || '1',
  };

  for (const [placeholder, val] of Object.entries(replacements)) {
    text = text.split(placeholder).join(val);
  }

  // Bersihkan tulisan Admin Kanwil dari template lama agar tidak duplikat dengan footer HumasKanwil
  text = text
    .replace(/(\r?\n)*_?(Salam( hormat)?,|Terima kasih,)\r?\n_?(Admin|Tim Pengawasan) Kanwil (?:ATR\/)?BPN Prov(insi|\.)? Aceh_?/gi, '')
    .replace(/(\r?\n)*_?(Admin|Tim Pengawasan) Kanwil (?:ATR\/)?BPN Prov(insi|\.)? Aceh_?/gi, '')
    .trim();

  return text;
}

module.exports = {
  TEMPLATE_DEFINITIONS,
  getAllTemplates,
  renderTemplate
};
