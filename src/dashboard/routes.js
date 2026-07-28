const express = require('express');
const { AdminModel, TicketModel, NotificationLogModel, ConfigModel } = require('../database/models');
const { sendPersonalMessage, sendGroupMessage } = require('../notifier/starsender');
const { buildTestMessage } = require('../notifier/message-builder');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');
const { formatPhoneNumber } = require('../utils/helpers');
const { getAuthStatus, startLoginInteractive, submitOtpInteractive } = require('../scraper/login-controller');
const { getAllTemplates, renderTemplate } = require('../notifier/templates');
const { getSlaMetrics } = require('../analytics/sla-service');
const { generateCsvReport, generateHtmlReport, generatePdfReport, sendExecutiveReportToKanwil } = require('../analytics/report-generator');

const log = createLogger('ROUTES');

function createRoutes() {
  const router = express.Router();

  // ============================================
  // StarSender API Health Check (Realtime)
  // ============================================

  router.get('/starsender/status', async (req, res) => {
    try {
      const apiKey = (() => {
        try {
          require('dotenv').config({ override: true });
          if (process.env.STARSENDER_API_KEY) config.starsender.apiKey = process.env.STARSENDER_API_KEY;
        } catch {}
        try {
          const dbKey = ConfigModel.get('starsender_api_key');
          if (dbKey) return dbKey;
        } catch {}
        return config.starsender.apiKey;
      })();

      if (!apiKey) {
        return res.json({ success: true, data: { status: 'no_key', message: 'API Key belum dikonfigurasi' } });
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(config.starsender.sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey,
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.status === 401 || response.status === 403) {
        res.json({ success: true, data: { status: 'error', message: 'API Key tidak valid atau expired', checkedAt: new Date().toISOString() } });
      } else {
        res.json({ success: true, data: { status: 'connected', message: 'StarSender API terkoneksi dan aktif', checkedAt: new Date().toISOString() } });
      }
    } catch (error) {
      res.json({ success: true, data: { status: 'disconnected', message: error.name === 'AbortError' ? 'Timeout: API tidak merespons' : error.message, checkedAt: new Date().toISOString() } });
    }
  });

  // ============================================
  // Dashboard Stats
  // ============================================

  router.get('/stats', (req, res) => {
    try {
      const ticketStats = TicketModel.getStats();
      const notifStats = NotificationLogModel.getStats();
      const sysConfig = ConfigModel.getAll();

      res.json({
        success: true,
        data: {
          tickets: ticketStats,
          notifications: notifStats,
          scraper: {
            status: sysConfig.scraper_status || 'unknown',
            lastScrape: sysConfig.last_scrape_time || '-',
            interval: config.app.scrapeInterval,
          },
          settings: {
            notificationEnabled: sysConfig.notification_enabled === '1',
            groupEnabled: sysConfig.group_notification_enabled === '1',
            personalEnabled: sysConfig.personal_notification_enabled === '1',
            waGroupId: sysConfig.wa_group_id || '',
            reminderInterval: sysConfig.reminder_interval_minutes || '0',
          },
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Admin CRUD
  // ============================================

  // Get all admins
  router.get('/admins', (req, res) => {
    try {
      const admins = AdminModel.getAll();
      res.json({ success: true, data: admins });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get admin by ID
  router.get('/admins/:id', (req, res) => {
    try {
      const admin = AdminModel.getById(parseInt(req.params.id));
      if (!admin) {
        return res.status(404).json({ success: false, error: 'Admin not found' });
      }
      res.json({ success: true, data: admin });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Create admin
  router.post('/admins', (req, res) => {
    try {
      const { nama, kantor_pertanahan, no_hp, jabatan = 'admin', nama_ktu = null, no_hp_ktu = null } = req.body;
      if (!nama || !kantor_pertanahan || !no_hp) {
        return res.status(400).json({ success: false, error: 'Nama, kantor pertanahan, dan no HP wajib diisi' });
      }
      const result = AdminModel.create({ 
        nama, 
        kantor_pertanahan, 
        no_hp: formatPhoneNumber(no_hp), 
        jabatan, 
        nama_ktu, 
        no_hp_ktu: no_hp_ktu ? formatPhoneNumber(no_hp_ktu) : null 
      });
      res.json({ success: true, data: { id: result.lastInsertRowid } });
    } catch (error) {
      if (error.message.includes('UNIQUE constraint')) {
        return res.status(400).json({ success: false, error: 'Kantor pertanahan sudah terdaftar' });
      }
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update admin
  router.put('/admins/:id', (req, res) => {
    try {
      const { nama, kantor_pertanahan, no_hp, jabatan = 'admin', nama_ktu = null, no_hp_ktu = null, is_active } = req.body;
      AdminModel.update(parseInt(req.params.id), {
        nama,
        kantor_pertanahan,
        no_hp: formatPhoneNumber(no_hp),
        jabatan,
        nama_ktu,
        no_hp_ktu: no_hp_ktu ? formatPhoneNumber(no_hp_ktu) : null,
        is_active: is_active !== undefined ? is_active : true,
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Delete admin
  router.delete('/admins/:id', (req, res) => {
    try {
      AdminModel.delete(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Kirim pesan WhatsApp custom ke kontak admin kantor pertanahan / KTU
  router.post('/admins/:id/send-message', async (req, res) => {
    try {
      const adminId = parseInt(req.params.id);
      const { message, targetType = 'all' } = req.body;

      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ success: false, error: 'Teks pesan tidak boleh kosong' });
      }

      const admin = AdminModel.getById(adminId);
      if (!admin) {
        return res.status(404).json({ success: false, error: 'Data admin tidak ditemukan' });
      }

      let sentCount = 0;
      const results = [];

      // Kirim ke Petugas Admin
      if ((targetType === 'all' || targetType === 'admin') && admin.no_hp) {
        const cleanPhone = formatPhoneNumber(admin.no_hp);
        if (cleanPhone) {
          const resAdmin = await sendPersonalMessage(cleanPhone, message.trim());
          NotificationLogModel.create({
            ticketId: 'CUSTOM-MSG',
            targetType: 'custom_admin_msg',
            targetName: `${admin.nama || 'Admin'} (${admin.kantor_pertanahan})`,
            targetNumber: cleanPhone,
            message: message.trim(),
            status: resAdmin && resAdmin.success ? 'sent' : 'failed',
            response: JSON.stringify(resAdmin),
          });
          if (resAdmin && resAdmin.success) sentCount++;
          results.push({ target: 'Petugas Admin', name: admin.nama, phone: cleanPhone, result: resAdmin });
        }
      }

      // Kirim ke Kasubbag TU
      if ((targetType === 'all' || targetType === 'ktu') && admin.no_hp_ktu) {
        const cleanKtuPhone = formatPhoneNumber(admin.no_hp_ktu);
        if (cleanKtuPhone) {
          const resKtu = await sendPersonalMessage(cleanKtuPhone, message.trim());
          NotificationLogModel.create({
            ticketId: 'CUSTOM-MSG',
            targetType: 'custom_ktu_msg',
            targetName: `${admin.nama_ktu || 'Kasubbag TU'} (${admin.kantor_pertanahan})`,
            targetNumber: cleanKtuPhone,
            message: message.trim(),
            status: resKtu && resKtu.success ? 'sent' : 'failed',
            response: JSON.stringify(resKtu),
          });
          if (resKtu && resKtu.success) sentCount++;
          results.push({ target: 'Kasubbag TU', name: admin.nama_ktu, phone: cleanKtuPhone, result: resKtu });
        }
      }

      if (sentCount > 0) {
        res.json({ success: true, message: `Pesan berhasil terkirim ke ${sentCount} kontak di ${admin.kantor_pertanahan}!`, details: results });
      } else {
        const errorDetails = results.map(r => `${r.target} (${r.phone}): ${r.result && r.result.error ? r.result.error : 'Gagal'}`).join(' | ');
        res.status(400).json({ 
          success: false, 
          error: errorDetails ? `Gagal mengirim ke StarSender API: ${errorDetails}` : `Tidak ada nomor telepon yang valid pada target yang dipilih untuk ${admin.kantor_pertanahan}.`, 
          details: results 
        });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Processed Tickets
  // ============================================

  router.get('/tickets', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const tickets = TicketModel.getRecent(limit);
      res.json({ success: true, data: tickets });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/tickets/refresh-live', async (req, res) => {
    try {
      if (typeof global.triggerManualScrape === 'function') {
        await global.triggerManualScrape();
        const limit = parseInt(req.query.limit) || 50;
        const tickets = TicketModel.getRecent(limit);
        res.json({ success: true, data: tickets, message: 'Data dan status tiket berhasil diperbarui secara live dari OCA!' });
      } else {
        res.status(503).json({ success: false, error: 'Sistem scraper belum siap' });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/tickets/export', (req, res) => {
    try {
      const tickets = TicketModel.getAll();
      const header = 'No,Ticket ID,Kantor Pertanahan,Customer,Priority,Status,Category,Subject,Created Date,Last Notified\n';
      const rows = tickets.map((t, idx) => {
        const clean = str => `"${(str || '').toString().replace(/"/g, '""')}"`;
        return `${idx + 1},${clean(t.ticket_id)},${clean(t.kantor_pertanahan)},${clean(t.customer)},${clean(t.priority)},${clean(t.status)},${clean(t.category)},${clean(t.subject)},${clean(t.created_date || t.created_at)},${clean(t.last_notified_at || t.notified_at)}`;
      }).join('\n');
      
      const csv = '\uFEFF' + header + rows; // Include BOM for Excel UTF-8 display
      const timestamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="Laporan_Tiket_Pengaduan_${timestamp}.csv"`);
      res.send(csv);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/tickets/:ticketId/resend', async (req, res) => {
    try {
      const ticketId = req.params.ticketId;
      const allTickets = TicketModel.getAll();
      const ticket = allTickets.find(t => t.ticket_id === ticketId);
      if (!ticket) {
        return res.status(404).json({ success: false, error: 'Tiket tidak ditemukan' });
      }

      const admins = AdminModel.findByKantor(ticket.kantor_pertanahan);
      const notifiedNumbers = new Set();
      let totalSent = 0;

      if (admins && admins.length > 0) {
        for (const admin of admins) {
          const cleanPhone = formatPhoneNumber(admin.no_hp);
          if (cleanPhone && !notifiedNumbers.has(cleanPhone)) {
            const msg = renderTemplate('template_manual_resend', {
              ticketId: ticket.ticket_id,
              customer: ticket.customer,
              kantor: ticket.kantor_pertanahan,
              kategori: ticket.category,
              subjek: ticket.subject || ticket.category,
              tanggal: ticket.created_date || ticket.created_at,
              lastUpdate: ticket.last_update || ticket.created_date || ticket.created_at,
              adminNama: admin.nama
            });
            const result = await sendPersonalMessage(cleanPhone, msg);
            notifiedNumbers.add(cleanPhone);
            totalSent++;
            NotificationLogModel.create({
              ticketId: ticket.ticket_id,
              targetType: 'personal_manual',
              targetName: admin.nama,
              targetNumber: cleanPhone,
              message: msg,
              status: result && result.success ? 'sent' : 'failed',
              response: JSON.stringify(result),
            });
          }

          const cleanKtuPhone = formatPhoneNumber(admin.no_hp_ktu);
          if (cleanKtuPhone && !notifiedNumbers.has(cleanKtuPhone)) {
            const ktuMsg = renderTemplate('template_manual_resend', {
              ticketId: ticket.ticket_id,
              customer: ticket.customer,
              kantor: ticket.kantor_pertanahan,
              kategori: ticket.category,
              subjek: ticket.subject || ticket.category,
              tanggal: ticket.created_date || ticket.created_at,
              lastUpdate: ticket.last_update || ticket.created_date || ticket.created_at,
              adminNama: admin.nama_ktu || 'Kasubbag Tata Usaha'
            });
            const ktuResult = await sendPersonalMessage(cleanKtuPhone, ktuMsg);
            notifiedNumbers.add(cleanKtuPhone);
            totalSent++;
            NotificationLogModel.create({
              ticketId: ticket.ticket_id,
              targetType: 'personal_manual_ktu',
              targetName: admin.nama_ktu || 'Kasubbag TU',
              targetNumber: cleanKtuPhone,
              message: ktuMsg,
              status: ktuResult && ktuResult.success ? 'sent' : 'failed',
              response: JSON.stringify(ktuResult),
            });
          }
        }
      }

      // Pastikan terkirim juga ke Admin Utama (Kanwil dari .env)
      if (config.kanwil && config.kanwil.phone) {
        const cleanKanwilPhone = formatPhoneNumber(config.kanwil.phone);
        if (cleanKanwilPhone && !notifiedNumbers.has(cleanKanwilPhone)) {
          const kanwilMsg = renderTemplate('template_manual_resend', {
            ticketId: ticket.ticket_id,
            customer: ticket.customer,
            kantor: ticket.kantor_pertanahan,
            kategori: ticket.category,
            subjek: ticket.subject || ticket.category,
            tanggal: ticket.created_date || ticket.created_at,
            lastUpdate: ticket.last_update || ticket.created_date || ticket.created_at,
            adminNama: 'Admin Utama (Kanwil)'
          });
          const kanwilResult = await sendPersonalMessage(cleanKanwilPhone, kanwilMsg);
          notifiedNumbers.add(cleanKanwilPhone);
          totalSent++;
          NotificationLogModel.create({
            ticketId: ticket.ticket_id,
            targetType: 'personal_manual_kanwil',
            targetName: 'Admin Utama (Kanwil)',
            targetNumber: cleanKanwilPhone,
            message: kanwilMsg,
            status: kanwilResult && kanwilResult.success ? 'sent' : 'failed',
            response: JSON.stringify(kanwilResult),
          });
        }
      }

      if (totalSent > 0) {
        res.json({ success: true, message: `Peringatan berhasil dikirim ke Admin tujuan (${ticket.kantor_pertanahan}) dan Admin Utama!` });
      } else {
        res.status(400).json({ success: false, error: `Belum ada admin atau nomor HP valid untuk kantor ${ticket.kantor_pertanahan}` });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Customizable Notification Templates
  // ============================================
  router.get('/templates', (req, res) => {
    try {
      const data = getAllTemplates();
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/templates', (req, res) => {
    try {
      const templates = req.body || {};
      for (const [key, val] of Object.entries(templates)) {
        if (val !== undefined && val !== null) {
          ConfigModel.set(key, val.toString());
        }
      }
      res.json({ success: true, message: 'Template bahasa notifikasi berhasil diperbarui!' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Notification Logs
  // ============================================

  router.get('/logs', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const logs = NotificationLogModel.getRecent(limit);
      res.json({ success: true, data: logs });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Settings
  // ============================================

  router.post('/settings', (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key) {
        return res.status(400).json({ success: false, error: 'Key is required' });
      }
      ConfigModel.set(key, String(value));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/settings', (req, res) => {
    try {
      const settings = ConfigModel.getAll();
      settings.wa_group_id = settings.wa_group_id || '';
      res.json({ success: true, data: settings });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Test Notification
  // ============================================

  router.post('/test-notification', async (req, res) => {
    try {
      const { type, target } = req.body;
      const message = buildTestMessage();

      let result;
      if (type === 'group') {
        result = await sendGroupMessage(target || config.wa.groupName, message);
      } else if (type === 'personal') {
        if (!target) {
          return res.status(400).json({ success: false, error: 'Nomor HP tujuan diperlukan' });
        }
        result = await sendPersonalMessage(target, message);
      } else {
        return res.status(400).json({ success: false, error: 'Type harus "group" atau "personal"' });
      }

      // Log the test
      NotificationLogModel.create({
        ticketId: 'TEST',
        targetType: type,
        targetName: type === 'group' ? (target || config.wa.groupName) : 'Test',
        targetNumber: type === 'personal' ? target : '',
        message,
        status: result.success ? 'sent' : 'failed',
        response: JSON.stringify(result),
      });

      res.json({ success: result.success, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/test-kanwil', async (req, res) => {
    try {
      if (!config.kanwil.phone) {
        return res.status(400).json({ success: false, error: 'Nomor HP Admin Kanwil belum dikonfigurasi di .env (KANWIL_ADMIN_PHONE)' });
      }
      const message = `🔔 *TEST PING KANWIL*\n\nHalo ${config.kanwil.name || 'Admin Kanwil'},\nIni adalah pesan tes ping dari sistem *Auto Notif Pengaduan*.\n\n_Jika pesan ini sampai, koneksi WhatsApp Bot untuk Admin Kanwil berfungsi normal._`;
      const result = await sendPersonalMessage(config.kanwil.phone, message);
      res.json({ success: result.success, data: result, error: result.error });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/test-group', async (req, res) => {
    try {
      const waGroupId = ConfigModel.get('wa_group_id') || config.wa.groupName;
      if (!waGroupId) {
        return res.status(400).json({ success: false, error: 'ID atau Nama Group WhatsApp belum dikonfigurasi' });
      }
      const message = `🔔 *TEST PING GROUP*\n\nIni adalah pesan tes ping ke Group dari sistem *Auto Notif Pengaduan*.\n\n_Jika pesan ini sampai, koneksi WhatsApp Bot ke group berfungsi normal._`;
      const result = await sendGroupMessage(waGroupId, message);
      res.json({ success: result.success, data: result, error: result.error });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/force-check', async (req, res) => {
    try {
      if (typeof global.triggerManualScrape === 'function') {
        global.triggerManualScrape();
        res.json({ success: true, message: 'Pengecekan tiket & pengingat (reminder) sedang dijalankan di latar belakang!' });
      } else {
        res.status(503).json({ success: false, error: 'Sistem scraper belum siap' });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Auth & Interactive Login
  // ============================================

  // Check auth status
  router.get('/auth/status', async (req, res) => {
    try {
      const status = await getAuthStatus();
      res.json({ success: true, data: status });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Start login
  router.post('/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password required' });
      }
      const result = await startLoginInteractive(email, password);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Submit OTP
  router.post('/auth/otp', async (req, res) => {
    try {
      const { otp } = req.body;
      if (!otp) {
        return res.status(400).json({ success: false, error: 'OTP code required' });
      }
      const result = await submitOtpInteractive(otp);
      if (result.error) {
        return res.status(400).json({ success: false, error: result.error });
      }
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // Level 6: Advanced SLA Analytics & Reports
  // ============================================

  router.get('/analytics/leaderboard', (req, res) => {
    try {
      const data = getSlaMetrics();
      res.json(data);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/analytics/report/html', (req, res) => {
    try {
      const html = generateHtmlReport();
      res.send(html);
    } catch (error) {
      res.status(500).send(`Error generating HTML report: ${error.message}`);
    }
  });

  router.get('/analytics/report/pdf', async (req, res) => {
    try {
      const result = await generatePdfReport();
      if (result.success && result.filePath) {
        res.download(result.filePath, 'Laporan_SLA_Pengawasan_BPN_Aceh.pdf');
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.get('/analytics/report/csv', (req, res) => {
    try {
      const result = generateCsvReport();
      if (result.success) {
        res.header('Content-Type', 'text/csv');
        res.attachment('Laporan_SLA_Pengawasan_BPN_Aceh.csv');
        res.send(result.content);
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post('/analytics/report/send', async (req, res) => {
    try {
      const { phone } = req.body || {};
      const result = await sendExecutiveReportToKanwil(phone);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = { createRoutes };
