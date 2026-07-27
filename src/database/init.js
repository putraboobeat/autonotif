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

  // Auto-migrate: Add reminder columns if they don't exist
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
  } catch (err) {
    log.error('Migration failed', { error: err.message });
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
