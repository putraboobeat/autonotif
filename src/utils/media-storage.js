const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../config');
const { createLogger } = require('./logger');

const log = createLogger('MEDIA-STORAGE');

const UPLOADS_DIR = path.join(__dirname, '..', 'dashboard', 'public', 'uploads');

/**
 * Ensure the uploads directory exists
 */
function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

/**
 * Simpan buffer media ke folder lokal uploads dan return public URL jika APP_BASE_URL disetel.
 * 
 * @param {Buffer} buffer - Buffer data media (JPEG / MP4)
 * @param {string} extension - Ekstensi file ('jpg', 'mp4', dll)
 * @param {string} [customFilename] - Nama file kustom (misal 'ig_C8ABC123.jpg')
 * @returns {string|null} - Public URL jika APP_BASE_URL ada, atau null jika tidak ada
 */
function saveMediaBufferLocally(buffer, extension = 'jpg', customFilename = null) {
  try {
    ensureUploadsDir();

    const filename = customFilename || `media_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extension.replace(/^\./, '')}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    fs.writeFileSync(filePath, buffer);
    log.info(`[STORAGE] 💾 File tersimpan lokal: ${filename} (${buffer.length} bytes)`);

    const baseUrl = (config.app && config.app.baseUrl) ? config.app.baseUrl.replace(/\/+$/, '') : '';
    if (baseUrl) {
      const publicUrl = `${baseUrl}/uploads/${filename}`;
      log.info(`[STORAGE] 🌐 Public Cloudflare/Host URL: ${publicUrl}`);
      return publicUrl;
    }

    return null;
  } catch (err) {
    log.error(`[STORAGE] Gagal menyimpan file media lokal: ${err.message}`);
    return null;
  }
}

/**
 * Pembersih otomatis: Hapus file di folder uploads yang umurnya > maxAgeHours (default 24 jam)
 */
function cleanupExpiredMedia(maxAgeHours = 24) {
  try {
    ensureUploadsDir();
    const files = fs.readdirSync(UPLOADS_DIR);
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    let deletedCount = 0;

    for (const file of files) {
      if (file === '.gitkeep') continue;
      const filePath = path.join(UPLOADS_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        if (stats.isFile()) {
          const ageMs = now - stats.mtimeMs;
          if (ageMs > maxAgeMs) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        }
      } catch (fErr) {
        // Abaikan file yang sedang diakses atau sudah terhapus
      }
    }

    if (deletedCount > 0) {
      log.info(`[CLEANUP] 🧹 Berhasil membersihkan ${deletedCount} file media kedaluwarsa (> ${maxAgeHours} jam)`);
    }
  } catch (err) {
    log.warn(`[CLEANUP] Gagal menjalankan pembersihan media: ${err.message}`);
  }
}

let cleanupTimer = null;

/**
 * Jalankan cron pembersihan media setiap 1 jam secara berkala
 */
function startMediaCleanupCron() {
  if (cleanupTimer) return;

  // Jalankan langsung sekali saat startup
  cleanupExpiredMedia(24);

  // Jadwalkan setiap 1 jam (3600000 ms)
  cleanupTimer = setInterval(() => {
    cleanupExpiredMedia(24);
  }, 60 * 60 * 1000);

  if (cleanupTimer.unref) {
    cleanupTimer.unref(); // Tidak memblokir process shutdown
  }

  log.info('[CLEANUP] ⏰ Media auto-cleanup cron aktif (retensi 24 jam, cek tiap 1 jam)');
}

module.exports = {
  UPLOADS_DIR,
  ensureUploadsDir,
  saveMediaBufferLocally,
  cleanupExpiredMedia,
  startMediaCleanupCron,
};
