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
    last_update VARCHAR(100),
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
CREATE INDEX IF NOT EXISTS idx_notif_target_status ON notification_logs(target_number, status);

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
INSERT OR IGNORE INTO system_config (key, value) VALUES ('holiday_wa_group_id', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('holiday_admin_number', '');

-- Tabel Hari Besar (Holidays)
CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    event_date DATE NOT NULL,
    target_group VARCHAR(255),
    target_admins VARCHAR(255),
    is_active INTEGER DEFAULT 1,
    notified_h3_year INTEGER DEFAULT 0,
    notified_h2_year INTEGER DEFAULT 0,
    notified_h1_year INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(event_date);

-- ============================================
-- Instagram Auto Notif
-- ============================================

-- Tabel rule pemetaan kode ke target WA
CREATE TABLE IF NOT EXISTS ig_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(100) NOT NULL UNIQUE,
    target_group VARCHAR(255) NOT NULL,
    target_admin VARCHAR(255),
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ig_rules_code ON ig_rules(code);

-- Tabel post IG yang sudah diproses (mencegah duplikat)
CREATE TABLE IF NOT EXISTS processed_ig_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shortcode VARCHAR(50) NOT NULL UNIQUE,
    link VARCHAR(255),
    caption TEXT,
    matched_code VARCHAR(100),
    notified_group VARCHAR(255),
    status VARCHAR(50) DEFAULT 'success',
    error_msg TEXT,
    post_date DATETIME,
    image_url TEXT,
    video_url TEXT,
    account_username VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ig_posts_shortcode ON processed_ig_posts(shortcode);

-- Insert default config untuk Instagram
INSERT OR IGNORE INTO system_config (key, value) VALUES ('ig_enabled', '0');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('ig_username', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('ig_scrape_interval', '300000'); -- default 5 menit
INSERT OR IGNORE INTO system_config (key, value) VALUES ('ig_scraper_status', 'stopped');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('last_ig_scrape_time', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('ig_template_msg', '📸 *INFO POSTINGAN BARU* 📸\n\nAda postingan Instagram terbaru (@{{username}}) yang terkait dengan instansi Anda.\n\n*Kode:* {{kode}}\n*Caption:* {{caption}}\n\n*Link:* {{link}}');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('ig_watermark', '_Pesan otomatis dari Auto Notif Pengaduan_');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('anti_ban_footer_enabled', '1');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('anti_ban_footer_text', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('anti_ban_footer_label', 'HumasKanwil');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('anti_ban_footer_prefix', 'ATR');

-- ============================================
-- Web to WP Scraper
-- ============================================

CREATE TABLE IF NOT EXISTS website_articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url VARCHAR(255) NOT NULL UNIQUE,
    title VARCHAR(500),
    post_date VARCHAR(100),
    category VARCHAR(100),
    wp_post_url VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending',
    error_msg TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_website_articles_url ON website_articles(url);
CREATE INDEX IF NOT EXISTS idx_website_articles_status ON website_articles(status);

-- Insert default config for Web to WP
INSERT OR IGNORE INTO system_config (key, value) VALUES ('web_enabled', '0');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('web_source_url', 'https://www.atrbpn.go.id/berita');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('web_wp_url', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('web_wp_username', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('web_wp_password', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('web_wp_status', 'draft');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('web_auto_fetch', '0');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('web_auto_post', '0');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('web_interval_minutes', '60');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('last_web_fetch_time', '');
INSERT OR IGNORE INTO system_config (key, value) VALUES ('web_scraper_status', 'stopped');
