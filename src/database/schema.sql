-- ============================================
-- Auto Notif Pengaduan - Database Schema
-- ============================================

-- Tabel admin kantor pertanahan
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama VARCHAR(255) NOT NULL,
    kantor_pertanahan VARCHAR(255) NOT NULL,
    no_hp VARCHAR(20) NOT NULL,
    jabatan VARCHAR(50) DEFAULT 'admin',
    nama_ktu VARCHAR(255),
    no_hp_ktu VARCHAR(50),
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index untuk pencarian cepat berdasarkan kantor
CREATE INDEX IF NOT EXISTS idx_admins_kantor ON admins(kantor_pertanahan);

-- Tabel tiket yang sudah diproses (untuk tracking & deduplikasi)
CREATE TABLE IF NOT EXISTS processed_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id VARCHAR(50) NOT NULL UNIQUE,
    customer VARCHAR(255),
    agent VARCHAR(500),
    kantor_pertanahan VARCHAR(255),
    status VARCHAR(50),
    priority VARCHAR(50),
    category VARCHAR(100),
    sub_category VARCHAR(100),
    subject VARCHAR(255),
    created_date VARCHAR(100),
    notified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    notified_group INTEGER DEFAULT 0,
    notified_admin INTEGER DEFAULT 0
);

-- Index untuk pencarian berdasarkan ticket_id dan status
CREATE INDEX IF NOT EXISTS idx_tickets_status ON processed_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_notified_at ON processed_tickets(notified_at);

-- Log notifikasi terkirim
CREATE TABLE IF NOT EXISTS notification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id VARCHAR(50) NOT NULL,
    target_type VARCHAR(20) NOT NULL,
    target_name VARCHAR(255),
    target_number VARCHAR(50),
    message TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    response TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index untuk pencarian log
CREATE INDEX IF NOT EXISTS idx_notif_ticket ON notification_logs(ticket_id);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notification_logs(status);
CREATE INDEX IF NOT EXISTS idx_notif_sent_at ON notification_logs(sent_at);

-- Config sistem
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default config
INSERT OR IGNORE INTO system_config (key, value) VALUES ('notification_enabled', '1');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('group_notification_enabled', '1');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('personal_notification_enabled', '1');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('scrape_interval', '60000');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('last_scrape_time', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('scraper_status', 'stopped');
