const { ConfigModel } = require('../database/models');

const TEMPLATE_DEFINITIONS = {
  template_new_group: {
    title: '1. Notifikasi Tiket Baru (Group WhatsApp)',
    description: 'Pesan perdana ke Grup WhatsApp saat aduan baru terdeteksi di OCA Interaction.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {kategori}, {tanggal}, {mentions}',
    defaultText: `📢 *[ADUAN BARU MASUK] PEMBERITAHUAN PENGADUAN BPN ACEH*

Halo rekan-rekan, terdapat aduan warga baru yang masuk ke sistem dan memerlukan penanganan segera:

📋 *Ticket ID*: {ticketId}
🏢 *Kantor Tujuan*: {kantor}
👤 *Pelapor / Warga*: {customer}
🔖 *Kategori*: {kategori}
💬 *Subjek Aduan*: {subjek}
📅 *Tanggal Masuk*: {tanggal}

🚨 *Mohon Atensi Admin Bertugas*: {mentions}
Harap segera membuka dashboard OCA Interaction dan menindaklanjuti pengaduan ini demi pelayanan prima kepada masyarakat. Terima kasih! 🙏

_Sistem Pemantau Pengaduan Kanwil ATR/BPN Provinsi Aceh_`
  },

  template_new_personal: {
    title: '2. Notifikasi Tiket Baru (Japri Personal Admin Kantah)',
    description: 'Pesan pesan langsung (japri) ke WhatsApp Admin Kantor Pertanahan terkait.',
    placeholders: '{ticketId}, {customer}, {kantor}, {adminNama}, {subjek}, {kategori}, {tanggal}',
    defaultText: `🔔 *[NOTIFIKASI PERSONAL] PENGADUAN WARGA BARU*

Selamat siang/sore Yth. Sdr/i *{adminNama}*,
Sebagai Admin dari *{kantor}*, kami menginfokan bahwa terdapat satu tiket pengaduan baru yang diarahkan ke kantor Bapak/Ibu:

📋 *Ticket ID*: {ticketId}
👤 *Nama Pelapor*: {customer}
🔖 *Kategori*: {kategori}
💬 *Subjek*: {subjek}
📅 *Tanggal Masuk*: {tanggal}

Mohon perkenan Bapak/Ibu untuk segera memproses dan merespons tiket tersebut pada aplikasi OCA Interaction. Kolaborasi dan kecepatan respons Anda sangat berarti bagi kemajuan layanan BPN Aceh. Terima kasih banyak atas kerjasamanya! 🫡✨`
  },

  template_new_kanwil: {
    title: '3. Laporan Rekap Tiket Baru (Japri Admin Kanwil)',
    description: 'Laporan pemantauan ke nomor Admin Kanwil (Pengawas Utama) setiap kali ada aduan baru.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {kategori}, {tanggal}',
    defaultText: `🏛️ *[LAPORAN PENGAWAS KANWIL] TIKET MASUK TERBARU*

Yth. Admin Kanwil BPN Aceh,
Sistem memantau aduan baru telah didaftarkan dengan rincian berikut:

📋 *Ticket ID*: {ticketId}
🏢 *Kantor Pertanahan*: {kantor}
👤 *Pelapor*: {customer}
🔖 *Subjek*: {subjek}
📅 *Tanggal*: {tanggal}

Sistem telah meneruskan pesan peringatan instan kepada grup dan admin kantah yang bersangkutan.`
  },

  template_reminder_group: {
    title: '4. Peringatan Rutin / Reminder (Group WhatsApp)',
    description: 'Pesan pengingat di Grup jika tiket masih berstatus OPEN setelah jangka waktu tertentu.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {reminderCount}, {mentions}',
    defaultText: `⚠️ *[REMINDER KE-{reminderCount}: TIKET PENGADUAN BELUM SELESAI]* ⚠️

Mohon perhatian rekan-rekan di *{kantor}*. Pengaduan berikut dipantau MASIH BERSTATUS OPEN dan belum dilakukan penutupan/penyelesaian:

📋 *Ticket ID*: {ticketId}
👤 *Pelapor*: {customer}
💬 *Subjek*: {subjek}

🚨 *Kepada Petugas*: {mentions}
Waktu penanganan terus berjalan. Mari saling mengingatkan agar tiket ini segera diproses dan tidak berlanjut ke eskalasi pimpinan. Semangat melayani! 💪`
  },

  template_reminder_personal: {
    title: '5. Peringatan Rutin / Reminder (Japri Admin Kantah)',
    description: 'Pesaningat langsung (japri) ke admin kantor jika aduan masih OPEN.',
    placeholders: '{ticketId}, {customer}, {kantor}, {adminNama}, {subjek}, {reminderCount}',
    defaultText: `⚠️ *[REMINDER KE-{reminderCount}] PENGADUAN BELUM DI-CLOSE*

Yth. Sdr/i *{adminNama}* ({kantor}),
Sistem memantau bahwa aduan dengan Ticket ID *{ticketId}* (Pelapor: {customer}, Subjek: {subjek}) masih berstatus OPEN di OCA Interaction.

Mohon kediaannya untuk luangkan waktu sejenak merespons atau mematikan (close) tiket tersebut agar tidak melewati batas waktu SLA layanan. Terima kasih banyak atas kerja keras Bapak/Ibu! 🙏`
  },

  template_reminder_kanwil: {
    title: '6. Peringatan Rutin (Japri Admin Kanwil)',
    description: 'Pesan peringatan pemantauan untuk Admin Kanwil pada tiket yang berulang kali dingatkan.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {reminderCount}',
    defaultText: `⚠️ *[INFO REMINDER KANWIL]*: Tiket #{ticketId} ({kantor} - {subjek}) masih berstatus OPEN. Saat ini sistem telah mengirimkan pengingat otomatis ke-{reminderCount}.`
  },

  template_eskalasi_ktu: {
    title: '7. Eskalasi Darurat > 1 Hari (Japri Kasubbag Tata Usaha Kantah)',
    description: 'Laporan kritis langsung ke HP Kasubbag TU Kantor Pertanahan setempat jika admin abai > 24 jam.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {tanggal}, {ktuNama}',
    defaultText: `🚨 *[ESKALASI DARURAT > 1 HARI: KASUBBAG TATA USAHA]* 🚨

Kepada Yth. *{ktuNama}* (Kasubbag Tata Usaha *{kantor}*),

Dengan hormat, izinkan kami melaporkan pemantauan sistem pengaduan: Terdapat aduan warga di lingkungan kantor Bapak/Ibu yang *TELAH LEWAT 1 HARI (24 JAM)* belum diselesaikan oleh Admin bertugas dan masih berstatus OPEN:

📋 *Ticket ID*: {ticketId}
👤 *Warga / Pelapor*: {customer}
🔖 *Subjek*: {subjek}
📅 *Tanggal Masuk*: {tanggal}

🔥 _Mohon bantuan serta atensi dari Bapak/Ibu Kasubbag Tata Usaha berkenan menginstruksikan petugas Admin terkait untuk segera memproses penyelesaian dan closing tiket pada Dashboard OCA Interaction agar aduan tertangani dengan baik._

Atas kerjasama dan arahan Bapak/Ibu, kami ucapkan terima kasih banyak. 🙏`
  },

  template_eskalasi_humas: {
    title: '8. Eskalasi Darurat > 1 Hari (Japri Kasubbag Umum & Humas Kanwil)',
    description: 'Laporan rekap kritis ke Kasubbag Umum & Humas tingkat Wilayah (Kanwil) saat ada pelanggaran waktu 24 jam.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {tanggal}, {reminderCount}',
    defaultText: `🚨 *[ESKALASI DARURAT > 1 HARI: KASUBBAG UMUM & HUMAS KANWIL]* 🚨

Yth. Bapak/Ibu Kasubbag Umum dan Hubungan Masyarakat Kanwil,

Laporan Pemantauan Otomatis: Terdapat pengaduan masyarakat yang *TELAH MELEWATI BATAS WAKTU 1 HARI (24 JAM)* dan belum disatukan/closed:

📋 *Ticket ID*: {ticketId}
🏢 *Kantor Tujuan*: {kantor}
👤 *Warga / Pelapor*: {customer}
🔖 *Subjek*: {subjek}
📅 *Tanggal Masuk*: {tanggal}
⏰ *Total Reminder*: {reminderCount} kali peringatan sistem

🔥 _Sistem telah melakukan eskalasi kepada Kasubbag Tata Usaha Kantah bersangkutan. Mohon perkenan atensi dan arahan lebih lanjut agar pelayanan tidak terhambat._`
  },

  template_closed_group: {
    title: '9. Apresiasi & Berhasil Closed (Group WhatsApp)',
    description: 'Pesan ucapan terima kasih dan selamat di Grup ketika admin berhasil menyelesaikan aduan warga.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {mentions}',
    defaultText: `🎉 *[APRESIASI PELAYANAN: PENGADUAN BERHASIL DI-CLOSE]* 🎉

Kabar gembira! Pengaduan berikut telah tuntas diselesaikan oleh tim bertugas:
📋 *Ticket ID*: {ticketId}
🏢 *Kantor*: {kantor}
👤 *Pelapor*: {customer}
💬 *Subjek*: {subjek}
👏 *Admin Penanggung Jawab*: {mentions}

Terima kasih yang sebesar-besarnya kepada Pimpinan dan Petugas Admin atas respons cepat dan dedikasi luar biasa. Terus pertahankan budaya pelayanan prima kepada masyarakat Aceh! 🏆🇮🇩`
  },

  template_manual_resend: {
    title: '10. Peringatan Manual dari Dashboard (Tombol Kirim Ulang)',
    description: 'Pesan peringatan khusus ketika admin kanwil mengeklik tombol "Kirim Ulang Peringatan" dari Dashboard web.',
    placeholders: '{ticketId}, {customer}, {kantor}, {subjek}, {tanggal}, {adminNama}',
    defaultText: `⚡ *[PERINGATAN KHUSUS DARI KANWIL BPN ACEH]* ⚡

Yth. Sdr/i *{adminNama}* (Admin *{kantor}*),

Pesan ini ditarik dan dikirim secara langsung melalui Dashboard Pengawasan Kanwil. Kami meminta perhatian segera untuk menyelesaikan tiket pengaduan berikut:

📋 *Ticket ID*: {ticketId}
👤 *Customer / Warga*: {customer}
💬 *Subjek*: {subjek}
📅 *Tanggal Masuk*: {tanggal}

Mohon saat ini juga membuka portal OCA Interaction dan melayani pengaduan tersebut. Atas kerja sama dan kecekatan Bapak/Ibu kami hargai, terima kasih! 🙏`
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
    '{kantor}': data.kantor || data.kantorPertanahan || data.kantor_pertanahan || 'Kanwil ATR/BPN Prov Aceh',
    '{subjek}': data.subjek || data.subject || data.category || '-',
    '{kategori}': data.kategori || data.category || '-',
    '{tanggal}': data.tanggal || data.createdDate || data.created_date || data.created_at || '-',
    '{mentions}': data.mentions || '',
    '{adminNama}': data.adminNama || data.nama || 'Admin Kantah',
    '{ktuNama}': data.ktuNama || data.nama_ktu || 'Kasubbag Tata Usaha',
    '{reminderCount}': data.reminderCount || '1',
  };

  for (const [placeholder, val] of Object.entries(replacements)) {
    // Replace all occurrences of placeholder
    text = text.split(placeholder).join(val);
  }

  return text;
}

module.exports = {
  TEMPLATE_DEFINITIONS,
  getAllTemplates,
  renderTemplate
};
