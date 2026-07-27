# 🔔 Auto Notif Pengaduan

Sistem otomatis yang memantau tiket pengaduan dari **OCA Interaction** dan mengirimkan notifikasi **WhatsApp** ke admin kantor pertanahan menggunakan **StarSender API**.

## ✨ Fitur

- 🔄 **Auto Scraping** — Memantau tiket OCA Interaction setiap 1 menit
- 🔍 **Deteksi Otomatis** — Mendeteksi tiket baru berstatus "Open"
- 📱 **Notifikasi WA Group** — Kirim notifikasi ke group WhatsApp
- 👤 **Notifikasi WA Personal** — Kirim notifikasi ke admin kantor pertanahan terkait
- 🖥️ **Admin Dashboard** — Web UI untuk kelola data admin dan monitor sistem
- 🔐 **Auto Login** — Login otomatis ke OCA Interaction dengan session persistence
- 🖥️ **Headless Browser** — Berjalan di background tanpa tampilan GUI (cocok untuk VPS)
- 🔄 **Auto Restart** — PM2 process manager untuk auto-restart saat crash

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Konfigurasi

```bash
cp .env.example .env
nano .env  # Edit sesuai kredensial Anda
```

Isi environment variables berikut:

| Variable | Keterangan |
|----------|-----------|
| `OCA_EMAIL` | Email login OCA Interaction |
| `OCA_PASSWORD` | Password OCA Interaction |
| `STARSENDER_API_KEY` | API Key dari StarSender |
| `WA_GROUP_NAME` | Nama group WhatsApp tujuan |
| `OCA_DEPARTMENT_FILTER` | Filter department (opsional) |

### 3. Jalankan

```bash
# Development
npm start

# Dengan PM2 (Production)
pm2 start ecosystem.config.js
```

### 4. Akses Dashboard

Buka browser: **http://localhost:3000**

## 📁 Struktur Project

```
auto-notif-pengaduan/
├── src/
│   ├── index.js                 # Main entry point
│   ├── config.js                # Environment config
│   ├── scraper/
│   │   ├── browser.js           # Puppeteer browser manager
│   │   ├── login.js             # OCA login handler
│   │   └── ticket-scraper.js    # Ticket data extraction
│   ├── detector/
│   │   └── ticket-detector.js   # New ticket detection
│   ├── notifier/
│   │   ├── starsender.js        # StarSender API client
│   │   └── message-builder.js   # WhatsApp message formatter
│   ├── database/
│   │   ├── init.js              # Database initialization
│   │   ├── models.js            # Data access layer
│   │   └── schema.sql           # SQLite schema
│   ├── dashboard/
│   │   ├── server.js            # Express.js server
│   │   ├── routes.js            # API routes
│   │   └── public/              # Dashboard UI files
│   └── utils/
│       ├── logger.js            # Logging utility
│       └── helpers.js           # Common helpers
├── ecosystem.config.js          # PM2 config
├── .env.example                 # Environment template
└── package.json
```

## 🖥️ Deploy ke VPS Linux

```bash
# 1. Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Install Chromium dependencies
sudo apt-get install -y fonts-liberation libasound2 libatk-bridge2.0-0 \
  libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
  libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libxcomposite1 \
  libxdamage1 libxrandr2 libxrender1 libxss1 libxtst6 xdg-utils

# 3. Clone & setup
cd /opt
git clone <repo-url> auto-notif-pengaduan
cd auto-notif-pengaduan
npm install

# 4. Configure
cp .env.example .env
nano .env

# 5. Start with PM2
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Auto-start saat reboot

# 6. Monitor
pm2 logs auto-notif-pengaduan
```

## 🔧 API Endpoints (Dashboard)

| Method | Endpoint | Keterangan |
|--------|----------|-----------|
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/admins` | List semua admin |
| POST | `/api/admins` | Tambah admin baru |
| PUT | `/api/admins/:id` | Update admin |
| DELETE | `/api/admins/:id` | Hapus admin |
| GET | `/api/tickets` | List tiket terpantau |
| GET | `/api/logs` | Log notifikasi |
| POST | `/api/test-notification` | Test kirim notifikasi |
| GET/POST | `/api/settings` | Pengaturan sistem |

## 📝 License

ISC
