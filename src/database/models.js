const { getDb } = require('./init');
const { createLogger } = require('../utils/logger');

const log = createLogger('MODELS');

// ============================================
// Admin CRUD Operations
// ============================================

const AdminModel = {
  /**
   * Get all active admins
   */
  getAll() {
    const db = getDb();
    return db.prepare('SELECT * FROM admins ORDER BY kantor_pertanahan ASC').all();
  },

  /**
   * Get all active admins only
   */
  getActive() {
    const db = getDb();
    return db.prepare('SELECT * FROM admins WHERE is_active = 1 ORDER BY kantor_pertanahan ASC').all();
  },

  /**
   * Get admin by ID
   */
  getById(id) {
    const db = getDb();
    return db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  },

  /**
   * Find admin(s) matching a kantor pertanahan name
   * Uses LIKE for fuzzy matching
   */
  findByKantor(kantorName) {
    const db = getDb();
    const allAdmins = db.prepare('SELECT * FROM admins WHERE is_active = 1').all();
    if (!allAdmins.length) return [];
    
    const normalize = (s) => (s || '').toString().toLowerCase()
      .replace(/(\s*-\s*prov.*)$/i, '')
      .replace(/kantor\s+pertanahan/g, '')
      .replace(/kantah/g, '')
      .replace(/kabupaten/g, '')
      .replace(/provinsi/g, '')
      .replace(/prov/g, '')
      .replace(/kab\./g, '')
      .replace(/kab\s+/g, '')
      .replace(/kota/g, '')
      .replace(/atr\/bpn/g, '')
      .replace(/\s+-\s+/g, ' ')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const target = normalize(kantorName);
    
    const results = allAdmins.filter(admin => {
      // Selalu sertakan Admin Utama / Kanwil dalam setiap notifikasi pengaduan
      if (admin.kantor_pertanahan.toLowerCase().includes('kanwil') || admin.kantor_pertanahan.toLowerCase().includes('admin utama')) {
        return true;
      }
      if (!target) return false;
      
      const source = normalize(admin.kantor_pertanahan);
      if (source === target && source !== '') return true;
      if (source && target && (source.includes(target) || target.includes(source))) {
        // Cegah salah cocok (misal Pidie dicocokkan ke Pidie Jaya, atau Aceh Barat ke Aceh Barat Daya)
        if ((source === 'pidie' || target === 'pidie') && (source.includes('jaya') || target.includes('jaya'))) return false;
        if ((source.includes('aceh barat') && !source.includes('daya')) && target.includes('aceh barat daya')) return false;
        if ((target.includes('aceh barat') && !target.includes('daya')) && source.includes('aceh barat daya')) return false;
        return true;
      }
      return false;
    });

    return results;
  },

  /**
   * Create a new admin
   */
  create({ nama, kantor_pertanahan, no_hp, jabatan = 'admin', nama_ktu = null, no_hp_ktu = null }) {
    const db = getDb();
    const stmt = db.prepare(
      'INSERT INTO admins (nama, kantor_pertanahan, no_hp, jabatan, nama_ktu, no_hp_ktu) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const result = stmt.run(nama, kantor_pertanahan, no_hp, jabatan || 'admin', nama_ktu || null, no_hp_ktu || null);
    log.info('Admin created', { id: result.lastInsertRowid, nama, kantor_pertanahan, nama_ktu });
    return result;
  },

  /**
   * Update an existing admin
   */
  update(id, { nama, kantor_pertanahan, no_hp, jabatan = 'admin', nama_ktu = null, no_hp_ktu = null, is_active }) {
    const db = getDb();
    const stmt = db.prepare(
      'UPDATE admins SET nama = ?, kantor_pertanahan = ?, no_hp = ?, jabatan = ?, nama_ktu = ?, no_hp_ktu = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    );
    const result = stmt.run(nama, kantor_pertanahan, no_hp, jabatan || 'admin', nama_ktu || null, no_hp_ktu || null, is_active ? 1 : 0, id);
    log.info('Admin updated', { id, nama, nama_ktu });
    return result;
  },

  /**
   * Delete an admin
   */
  delete(id) {
    const db = getDb();
    const stmt = db.prepare('DELETE FROM admins WHERE id = ?');
    const result = stmt.run(id);
    log.info('Admin deleted', { id });
    return result;
  },
};

// ============================================
// Processed Tickets
// ============================================

const TicketModel = {
  /**
   * Check if a ticket has been processed, and return its data if so
   * @param {string} ticketId 
   * @returns {object|null} Returns ticket data if processed, null otherwise
   */
  isProcessed(ticketId) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM processed_tickets WHERE ticket_id = ?');
    const result = stmt.get(ticketId);
    return result || null;
  },

  /**
   * Save a processed ticket
   */
  save(ticket) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO processed_tickets 
      (ticket_id, customer, agent, kantor_pertanahan, status, priority, category, sub_category, subject, created_date, last_update, notified_group, notified_admin, last_notified_at, reminder_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(ticket_id) DO UPDATE SET
        status = excluded.status,
        priority = excluded.priority,
        customer = excluded.customer,
        agent = excluded.agent,
        kantor_pertanahan = excluded.kantor_pertanahan,
        category = excluded.category,
        sub_category = excluded.sub_category,
        subject = excluded.subject,
        last_update = excluded.last_update
    `);
    return stmt.run(
      ticket.ticketId,
      ticket.customer,
      ticket.agent,
      ticket.kantorPertanahan,
      ticket.status,
      ticket.priority,
      ticket.category,
      ticket.subCategory,
      ticket.subject,
      ticket.createdDate,
      ticket.lastUpdate || ticket.createdDate || '-',
      ticket.notifiedGroup ? 1 : 0,
      ticket.notifiedAdmin ? 1 : 0,
      new Date().toISOString()
    );
  },

  /**
   * Update ticket status and metadata (e.g. when closed or modified on OCA)
   * IMPORTANT: kantor_pertanahan is LOCKED after first save — never overwritten
   * to prevent kantah assignment from drifting on subsequent scrapes.
   */
  updateInfo(ticket) {
    const db = getDb();
    // Cek apakah kantor_pertanahan sudah terisi di database
    const existing = db.prepare('SELECT kantor_pertanahan FROM processed_tickets WHERE ticket_id = ?').get(ticket.ticketId);
    const existingKantor = existing ? (existing.kantor_pertanahan || '').trim() : '';
    // Hanya update kantor jika sebelumnya kosong
    const finalKantor = existingKantor !== '' ? existingKantor : (ticket.kantorPertanahan || '');

    const stmt = db.prepare(`
      UPDATE processed_tickets 
      SET status = ?, priority = ?, customer = ?, agent = ?, kantor_pertanahan = ?, category = ?, sub_category = ?, subject = ?, last_update = ?
      WHERE ticket_id = ?
    `);
    return stmt.run(
      ticket.status,
      ticket.priority || '',
      ticket.customer || '',
      ticket.agent || '',
      finalKantor,
      ticket.category || '',
      ticket.subCategory || '',
      ticket.subject || '',
      ticket.lastUpdate || ticket.createdDate || '-',
      ticket.ticketId
    );
  },

  /**
   * Update notification status for a ticket, updating the last notified time and incrementing reminder count
   */
  updateNotificationStatus(ticketId, { notifiedGroup, notifiedAdmin, isReminder = false }) {
    const db = getDb();
    
    if (isReminder) {
      const stmt = db.prepare(`
        UPDATE processed_tickets 
        SET notified_group = ?, notified_admin = ?, last_notified_at = ?, reminder_count = reminder_count + 1
        WHERE ticket_id = ?
      `);
      return stmt.run(notifiedGroup ? 1 : 0, notifiedAdmin ? 1 : 0, new Date().toISOString(), ticketId);
    } else {
      const stmt = db.prepare(`
        UPDATE processed_tickets 
        SET notified_group = ?, notified_admin = ?, last_notified_at = ?
        WHERE ticket_id = ?
      `);
      return stmt.run(notifiedGroup ? 1 : 0, notifiedAdmin ? 1 : 0, new Date().toISOString(), ticketId);
    }
  },

  /**
   * Get recent processed tickets
   */
  getRecent(limit = 50) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM processed_tickets ORDER BY notified_at DESC LIMIT ?'
    ).all(limit);
  },

  /**
   * Get all processed tickets (for Excel / CSV export)
   */
  getAll() {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM processed_tickets ORDER BY notified_at DESC'
    ).all();
  },

  /**
   * Get ticket count by status
   */
  getStats() {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as count FROM processed_tickets').get();
    const today = db.prepare(
      "SELECT COUNT(*) as count FROM processed_tickets WHERE date(notified_at) = date('now', 'localtime')"
    ).get();
    return { total: total.count, today: today.count };
  },
};

// ============================================
// Notification Logs
// ============================================

const NotificationLogModel = {
  /**
   * Log a notification
   */
  create({ ticketId, targetType, targetName, targetNumber, message, status, response }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO notification_logs 
      (ticket_id, target_type, target_name, target_number, message, status, response)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(ticketId, targetType, targetName, targetNumber, message, status, response || '');
  },

  /**
   * Get recent logs
   */
  getRecent(limit = 100) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM notification_logs ORDER BY sent_at DESC LIMIT ?'
    ).all(limit);
  },

  /**
   * Get logs by ticket ID
   */
  getByTicket(ticketId) {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM notification_logs WHERE ticket_id = ? ORDER BY sent_at DESC'
    ).all(ticketId);
  },

  /**
   * Get notification stats
   */
  getStats() {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as count FROM notification_logs').get();
    const sent = db.prepare("SELECT COUNT(*) as count FROM notification_logs WHERE status = 'sent'").get();
    const failed = db.prepare("SELECT COUNT(*) as count FROM notification_logs WHERE status = 'failed'").get();
    const today = db.prepare(
      "SELECT COUNT(*) as count FROM notification_logs WHERE date(sent_at) = date('now', 'localtime')"
    ).get();
    return {
      total: total.count,
      sent: sent.count,
      failed: failed.count,
      today: today.count,
    };
  },

  /**
   * Prune notification logs older than specified days
   */
  pruneOldLogs(days = 60) {
    const db = getDb();
    return db.prepare(
      "DELETE FROM notification_logs WHERE sent_at <= date('now', '-' || ? || ' days')"
    ).run(days);
  },
};

// ============================================
// System Config
// ============================================

const ConfigModel = {
  /**
   * Get a config value
   */
  get(key) {
    const db = getDb();
    const row = db.prepare('SELECT value FROM system_config WHERE key = ?').get(key);
    return row ? row.value : null;
  },

  /**
   * Set a config value
   */
  set(key, value) {
    const db = getDb();
    const stmt = db.prepare(
      'INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP'
    );
    return stmt.run(key, value, value);
  },

  /**
   * Get all config
   */
  getAll() {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM system_config').all();
    const config = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    return config;
  },
};

module.exports = {
  AdminModel,
  TicketModel,
  NotificationLogModel,
  ConfigModel,
};
