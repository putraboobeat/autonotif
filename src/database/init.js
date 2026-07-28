const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('DATABASE');
const DB_PATH = path.join(__dirname, '../../data/database.sqlite');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db = null;

/**
 * Initialize database — create tables and seed defaults
 */
function initDatabase() {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    log.info('Created data directory', { path: dataDir });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Execute base schema
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  // Auto-migrate: Add reminder columns and admin jabatan column if they don't exist
  try {
    const columns = db.pragma('table_info(processed_tickets)');
    const hasLastNotifiedAt = columns.some(c => c.name === 'last_notified_at');
    
    if (!hasLastNotifiedAt) {
      log.info('Migrating database: Adding reminder columns to processed_tickets');
      db.exec(`
        ALTER TABLE processed_tickets ADD COLUMN last_notified_at DATETIME;
        ALTER TABLE processed_tickets ADD COLUMN reminder_count INTEGER DEFAULT 0;
      `);
    }

    const hasLastUpdate = columns.some(c => c.name === 'last_update');
    if (!hasLastUpdate) {
      log.info('Migrating database: Adding last_update column to processed_tickets');
      db.exec("ALTER TABLE processed_tickets ADD COLUMN last_update VARCHAR(100);");
    }

    const adminCols = db.pragma('table_info(admins)');
    const hasJabatan = adminCols.some(c => c.name === 'jabatan');
    if (!hasJabatan) {
      log.info('Migrating database: Adding jabatan column to admins table');
      db.exec("ALTER TABLE admins ADD COLUMN jabatan VARCHAR(50) DEFAULT 'admin';");
    }
    const hasNamaKtu = adminCols.some(c => c.name === 'nama_ktu');
    if (!hasNamaKtu) {
      log.info('Migrating database: Adding nama_ktu and no_hp_ktu columns to admins table');
      db.exec(`
        ALTER TABLE admins ADD COLUMN nama_ktu VARCHAR(255);
        ALTER TABLE admins ADD COLUMN no_hp_ktu VARCHAR(50);
      `);
    }
  } catch (err) {
    log.error('Migration failed', { error: err.message });
  }

  // Auto-normalize existing admin phone numbers in database to 628xxx format (prevent +852 Hong Kong error)
  try {
    const { formatPhoneNumber } = require('../utils/helpers');
    const allAdmins = db.prepare('SELECT id, no_hp, no_hp_ktu FROM admins').all();
    const updatePhoneStmt = db.prepare('UPDATE admins SET no_hp = ?, no_hp_ktu = ? WHERE id = ?');
    for (const adm of allAdmins) {
      const cleanHp = adm.no_hp ? formatPhoneNumber(adm.no_hp) : null;
      const cleanKtu = adm.no_hp_ktu ? formatPhoneNumber(adm.no_hp_ktu) : null;
      if (cleanHp !== adm.no_hp || cleanKtu !== adm.no_hp_ktu) {
        updatePhoneStmt.run(cleanHp, cleanKtu, adm.id);
      }
    }
  } catch (err) {
    log.error('Phone normalization failed', { error: err.message });
  }

  // Auto-normalize existing admin kantor_pertanahan names in database to standard dropdown format
  try {
    const adminRows = db.prepare('SELECT id, kantor_pertanahan FROM admins').all();
    const updateKantorStmt = db.prepare('UPDATE admins SET kantor_pertanahan = ? WHERE id = ?');
    for (const adm of adminRows) {
      let k = (adm.kantor_pertanahan || '').trim();
      let clean = k;
      if (/kanwil|provinsi\s+aceh/i.test(k)) clean = 'Kanwil ATR/BPN Prov Aceh';
      else if (/aceh\s+barat\s+daya|abdya/i.test(k)) clean = 'Kantah Kab Aceh Barat Daya - Prov Aceh';
      else if (/aceh\s+barat/i.test(k) && !/daya/i.test(k)) clean = 'Kantah Kab Aceh Barat - Prov Aceh';
      else if (/aceh\s+besar/i.test(k)) clean = 'Kantah Kab Aceh Besar - Prov Aceh';
      else if (/aceh\s+jaya/i.test(k) && !/pidie/i.test(k)) clean = 'Kantah Kab Aceh Jaya - Prov Aceh';
      else if (/aceh\s+selatan/i.test(k)) clean = 'Kantah Kab Aceh Selatan - Prov Aceh';
      else if (/aceh\s+singkil/i.test(k)) clean = 'Kantah Kab Aceh Singkil - Prov Aceh';
      else if (/aceh\s+tamiang/i.test(k)) clean = 'Kantah Kab Aceh Tamiang - Prov Aceh';
      else if (/aceh\s+tenggara/i.test(k)) clean = 'Kantah Kab Aceh Tenggara - Prov Aceh';
      else if (/aceh\s+tengah/i.test(k)) clean = 'Kantah Kab Aceh Tengah - Prov Aceh';
      else if (/aceh\s+timur/i.test(k)) clean = 'Kantah Kab Aceh Timur - Prov Aceh';
      else if (/aceh\s+utara/i.test(k)) clean = 'Kantah Kab Aceh Utara - Prov Aceh';
      else if (/bener\s+meriah/i.test(k)) clean = 'Kantah Kab Bener Meriah - Prov Aceh';
      else if (/bireuen|biereun/i.test(k)) clean = 'Kantah Kab Bireuen - Prov Aceh';
      else if (/gayo\s+lues/i.test(k)) clean = 'Kantah Kab Gayo Lues - Prov Aceh';
      else if (/nagan\s+raya/i.test(k)) clean = 'Kantah Kab Nagan Raya - Prov Aceh';
      else if (/pidie\s+jaya|pijay/i.test(k)) clean = 'Kantah Kab Pidie Jaya - Prov Aceh';
      else if (/pidie/i.test(k) && !/jaya/i.test(k)) clean = 'Kantah Kab Pidie - Prov Aceh';
      else if (/simeu/i.test(k)) clean = 'Kantah Kab Simeuleu - Prov Aceh';
      else if (/lhokseumawe/i.test(k)) clean = 'Kantah Kota Lhokseumawe - Prov Aceh';
      else if (/subulussalam/i.test(k)) clean = 'Kantah Kota Subulussalam - Prov Aceh';
      else if (/langsa/i.test(k)) clean = 'Kantah Kota Langsa - Prov Aceh';
      else if (/sabang/i.test(k)) clean = 'Kantah Kota Sabang - Prov Aceh';
      else if (/banda\s+aceh/i.test(k)) clean = 'Kantah Kota Banda Aceh - Prov Aceh';

      if (clean !== k) {
        updateKantorStmt.run(clean, adm.id);
      }
    }
  } catch (err) {
    log.error('Kantor normalization failed', { error: err.message });
  }

  log.info('Database initialized successfully', { path: DB_PATH });
  return db;
}

/**
 * Get database instance
 */
function getDb() {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close database connection
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    log.info('Database connection closed');
  }
}

module.exports = { initDatabase, getDb, closeDatabase };
