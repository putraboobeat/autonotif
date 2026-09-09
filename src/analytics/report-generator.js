/**
 * Executive Report Generator (Level 6: Advanced SLA Analytics)
 * Generates official PDF and CSV reports for Kanwil BPN Provinsi Aceh.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { getSlaMetrics } = require('./sla-service');
const { sendPersonalMessage } = require('../notifier/starsender');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');

const log = createLogger('REPORT_GEN');
const REPORTS_DIR = path.join(__dirname, '../../data/reports');

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
}

/**
 * Generate CSV Report string and save to disk
 */
function generateCsvReport(metrics = null) {
  try {
    ensureReportsDir();
    const data = metrics || getSlaMetrics();
    const rows = [
      ['Kantor Pertanahan', 'Total Aduan', 'Selesai (Closed)', 'Belum Selesai (Open)', 'Eskalasi / Urgent', 'Tingkat Penyelesaian (%)', 'Rata-Rata Respon (Jam)', 'Status Kesiagaan', 'Admin Wilayah']
    ];

    data.allOffices.forEach(item => {
      rows.push([
        `"${item.kantor.replace(/"/g, '""')}"`,
        item.totalTickets,
        item.closedTickets,
        item.openTickets,
        item.escalatedTickets,
        item.resolutionRate,
        item.avgHours,
        `"${item.statusText}"`,
        `"${item.adminListText.replace(/"/g, '""')}"`
      ]);
    });

    const csvContent = rows.map(r => r.join(',')).join('\n');
    const filePath = path.join(REPORTS_DIR, 'laporan_sla_terakhir.csv');
    fs.writeFileSync(filePath, csvContent, 'utf8');
    log.info(`CSV report generated at ${filePath}`);
    return { success: true, filePath, content: csvContent };
  } catch (error) {
    log.error('Failed to generate CSV report', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Generate professional HTML template for printing / viewing
 */
function generateHtmlReport(metrics = null) {
  const data = metrics || getSlaMetrics();
  const dateStr = new Date().toLocaleDateString('id-ID', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const topHtml = data.topResponders.map((item, index) => `
    <div class="leaderboard-item top-item">
      <span class="rank">#${index + 1}</span>
      <div class="info">
        <strong>${item.kantor}</strong>
        <span>Selesai: ${item.closedTickets} dari ${item.totalTickets} aduan (${item.resolutionRate}%)</span>
      </div>
      <span class="badge badge-success">⚡ ${item.avgHours} Jam</span>
    </div>
  `).join('');

  const slowestHtml = data.slowestResponders ? data.slowestResponders.map((item, index) => `
    <div class="leaderboard-item attn-item">
      <span class="rank" style="background: rgba(245, 158, 11, 0.2); color: #d97706;">#${index + 1}</span>
      <div class="info">
        <strong>${item.kantor}</strong>
        <span>Selesai: ${item.closedTickets} dari ${item.totalTickets} aduan (${item.resolutionRate}%)</span>
      </div>
      <span class="badge" style="background: #fef3c7; color: #b45309;">⏱️ ${item.avgHours} Jam</span>
    </div>
  `).join('') : '';

  const attnHtml = data.attentionNeeded.length > 0 ? data.attentionNeeded.map((item, index) => `
    <div class="leaderboard-item attn-item">
      <span class="rank warning">!</span>
      <div class="info">
        <strong>${item.kantor}</strong>
        <span>Tertunda: ${item.openTickets} Open | ${item.escalatedTickets} Eskalasi</span>
      </div>
      <span class="badge badge-danger">Avg: ${item.avgHours} Jam</span>
    </div>
  `).join('') : '<p class="empty-msg">Seluruh Kantor Pertanahan berkinerja optimal tanpa penumpukan eskalasi.</p>';

  const tableRows = data.allOffices.map(item => `
    <tr>
      <td><strong>${item.kantor}</strong></td>
      <td style="text-align: center;">${item.totalTickets}</td>
      <td style="text-align: center; color: #10b981; font-weight: 600;">${item.closedTickets}</td>
      <td style="text-align: center; color: ${item.openTickets > 0 ? '#f59e0b' : '#64748b'}; font-weight: ${item.openTickets > 0 ? '700' : '400'};">${item.openTickets}</td>
      <td style="text-align: center; color: ${item.escalatedTickets > 0 ? '#ef4444' : '#64748b'}; font-weight: ${item.escalatedTickets > 0 ? '700' : '400'};">${item.escalatedTickets}</td>
      <td style="text-align: center;">${item.resolutionRate}%</td>
      <td style="text-align: center;">${item.avgHours} Jam</td>
      <td>
        <span class="status-pill status-${item.statusBadge.toLowerCase()}">${item.statusText}</span>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <title>Laporan Eksekutif SLA & Pengawasan Pelayanan</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; margin: 0; padding: 30px; background: #ffffff; line-height: 1.5; }
    .header { text-align: center; border-bottom: 3px solid #0f172a; padding-bottom: 20px; margin-bottom: 25px; }
    .header h1 { margin: 0; font-size: 20px; text-transform: uppercase; color: #0f172a; letter-spacing: 0.5px; }
    .header h2 { margin: 5px 0 0 0; font-size: 16px; font-weight: 500; color: #475569; }
    .meta-date { font-size: 13px; color: #64748b; margin-top: 8px; }
    .kpi-grid { display: flex; justify-content: space-between; gap: 15px; margin-bottom: 30px; }
    .kpi-box { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; text-align: center; }
    .kpi-box span { display: block; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600; margin-bottom: 5px; }
    .kpi-box strong { font-size: 22px; color: #0f172a; }
    .leaderboard-grid { display: flex; gap: 20px; margin-bottom: 30px; }
    .col-half { flex: 1; }
    .section-title { font-size: 14px; font-weight: 700; color: #0f172a; margin-bottom: 12px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
    .leaderboard-item { display: flex; align-items: center; justify-content: space-between; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; }
    .rank { width: 24px; height: 24px; border-radius: 50%; background: #e0e7ff; color: #3730a3; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; margin-right: 10px; }
    .rank.warning { background: #fee2e2; color: #991b1b; }
    .info { flex: 1; display: flex; flex-direction: column; }
    .info strong { font-size: 13px; color: #1e293b; }
    .info span { font-size: 11px; color: #64748b; }
    .badge { font-size: 11px; font-weight: bold; padding: 4px 8px; border-radius: 4px; }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-danger { background: #fee2e2; color: #991b1b; }
    .empty-msg { font-size: 12px; color: #166534; background: #dcfce7; padding: 12px; border-radius: 6px; text-align: center; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
    th { background: #0f172a; color: #ffffff; text-align: left; padding: 8px 10px; font-weight: 600; font-size: 11px; }
    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) { background: #f8fafc; }
    .status-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: bold; }
    .status-excellent { background: #dcfce7; color: #166534; }
    .status-good { background: #fef3c7; color: #92400e; }
    .status-critical { background: #fee2e2; color: #991b1b; }
    .status-idle { background: #f1f5f9; color: #64748b; }
    .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px; text-align: right; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="header">
    <h1>KANTOR WILAYAH BADAN PERTANAHAN NASIONAL PROVINSI ACEH</h1>
    <h2>Laporan Pengawasan Pelayanan & Monitoring SLA Pengaduan</h2>
    <div class="meta-date">Digenerate pada: ${dateStr}</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-box">
      <span>Total Aduan</span>
      <strong>${data.summary.totalTickets}</strong>
    </div>
    <div class="kpi-box">
      <span>Aduan Selesai</span>
      <strong style="color: #166534;">${data.summary.closedTickets}</strong>
    </div>
    <div class="kpi-box">
      <span>Tingkat Resolusi</span>
      <strong style="color: #2563eb;">${data.summary.globalResolutionRate}%</strong>
    </div>
    <div class="kpi-box">
      <span>Rata-Rata Waktu Respon</span>
      <strong>${data.summary.avgResolutionHours} Jam</strong>
    </div>
  </div>

  <div class="leaderboard-grid">
    <div class="col-half">
      <div class="section-title">🏆 10 Kantah Penyelesaian Tercepat</div>
      ${topHtml}
    </div>
    <div class="col-half">
      <div class="section-title">⏱️ 10 Kantah Penyelesaian Terlama</div>
      ${slowestHtml}
    </div>
  </div>

  ${data.attentionNeeded.length > 0 ? `
  <div style="margin-bottom: 30px;">
    <div class="section-title" style="color: #991b1b;">🚨 Perlu Pembinaan & Perhatian Khusus (Aduan Tertunda)</div>
    ${attnHtml}
  </div>
  ` : ''}

  <div class="section-title">📊 Matriks Kinerja 24 Kantor Pertanahan (Kabupaten/Kota)</div>
  <table>
    <thead>
      <tr>
        <th>Kantor Pertanahan</th>
        <th style="text-align: center;">Total</th>
        <th style="text-align: center;">Closed</th>
        <th style="text-align: center;">Open</th>
        <th style="text-align: center;">Eskalasi</th>
        <th style="text-align: center;">Penyelesaian</th>
        <th style="text-align: center;">Rata-Rata Waktu</th>
        <th>Status Kinerja</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>

  <div class="footer">
    Dokumen ini dihasilkan secara otomatis oleh <strong>Sistem Auto Notif Pengaduan Kanwil BPN Provinsi Aceh</strong> (Level 6 Intelligent Oversight).
  </div>
</body>
</html>`;
}

/**
 * Generate PDF Report using Puppeteer
 */
async function generatePdfReport(metrics = null) {
  let browser = null;
  try {
    ensureReportsDir();
    const html = generateHtmlReport(metrics);
    const filePath = path.join(REPORTS_DIR, 'laporan_sla_terakhir.pdf');

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      margin: { top: '25px', bottom: '25px', left: '25px', right: '25px' }
    });

    log.info(`PDF report generated successfully at ${filePath}`);
    return { success: true, filePath };
  } catch (error) {
    log.error('Failed to generate PDF report', { error: error.message });
    return { success: false, error: error.message };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Build professional executive summary message for WhatsApp
 */
function buildExecutiveSummaryMessage(metrics = null) {
  const data = metrics || getSlaMetrics();
  const now = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const lines = [
    `*Laporan Pengawasan & Kinerja Pelayanan (SLA) Kanwil BPN Prov. Aceh*`,
    `Tanggal: ${now}`,
    '',
    `Assalamualaikum Bapak/Ibu Pimpinan,`,
    '',
    `Berikut adalah ikhtisar pemantauan pengaduan masyarakat pada sistem OCA Interaction:`,
    '',
    `*Indikator Utama*:`,
    `• *Total Aduan Terdaftar*: ${data.summary.totalTickets} aduan`,
    `• *Berhasil Diselesaikan (Closed)*: ${data.summary.closedTickets} (${data.summary.globalResolutionRate}%)`,
    `• *Belum Diselesaikan (Open)*: ${data.summary.openTickets} aduan`,
    `• *Eskalasi / Melewati SLA (> 24 Jam)*: ${data.summary.escalatedTickets} aduan`,
    `• *Rata-Rata Kecepatan Respon*: ${data.summary.avgResolutionHours} Jam`,
    ''
  ];

  if (data.topResponders && data.topResponders.length > 0) {
    lines.push(`*3 Kantor Dengan Kinerja Respon Terbaik*:`);
    data.topResponders.slice(0, 3).forEach((item, idx) => {
      lines.push(`${idx + 1}. *${item.kantor}* (${item.resolutionRate}% selesai, rata-rata ${item.avgHours} Jam)`);
    });
    lines.push('');
  }

  if (data.attentionNeeded && data.attentionNeeded.length > 0) {
    lines.push(`*Kantor yang Memerlukan Pembinaan & Eskalasi*:`);
    data.attentionNeeded.slice(0, 3).forEach((item, idx) => {
      lines.push(`• *${item.kantor}* (${item.openTickets} aduan masih OPEN, rata-rata ${item.avgHours} Jam)`);
    });
    lines.push('');
  } else {
    lines.push(`Alhamdulillah, seluruh kantor pertanahan saat ini tidak memiliki tumpukan aduan melebihi batas SLA.`, '');
  }

  lines.push(
    `Laporan lengkap dalam format PDF & CSV kini tersedia melalui Dashboard Pengawasan Level 6.`,
    '',
    `Terima kasih,`,
    `_Sistem Auto Notif Pengaduan Kanwil BPN Prov. Aceh_`
  );

  return lines.join('\n');
}

/**
 * Send Executive Report Summary to Admin Kanwil & Kasubbag via WhatsApp
 */
async function sendExecutiveReportToKanwil(customPhone = null) {
  try {
    const data = getSlaMetrics();
    const msg = buildExecutiveSummaryMessage(data);
    const targetPhone = customPhone || config.kanwil.phone || (config.kasubbag_humas ? config.kasubbag_humas.phone : null);

    if (!targetPhone) {
      return { success: false, error: 'Tidak ada nomor tujuan Kanwil/Pimpinan terdaftar di sistem' };
    }

    log.info(`Sending Executive Summary Report to ${targetPhone}...`);
    const result = await sendPersonalMessage(targetPhone, msg);
    return { success: true, targetPhone, result };
  } catch (error) {
    log.error('Failed to send Executive Report via WhatsApp', { error: error.message });
    return { success: false, error: error.message };
  }
}

module.exports = {
  generateCsvReport,
  generateHtmlReport,
  generatePdfReport,
  buildExecutiveSummaryMessage,
  sendExecutiveReportToKanwil
};
