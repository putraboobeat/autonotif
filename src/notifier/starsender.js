const { createLogger } = require('../utils/logger');
const { config } = require('../config');
const { sleep, retry, formatPhoneNumber, getRandomInt, humanlikeSleep } = require('../utils/helpers');
const { NotificationLogModel } = require('../database/models');

const log = createLogger('STARSENDER');

function getActiveApiKey() {
  try {
    require('dotenv').config({ override: true });
    if (process.env.STARSENDER_API_KEY) {
      config.starsender.apiKey = process.env.STARSENDER_API_KEY;
    }
  } catch {}
  try {
    const { ConfigModel } = require('../database/models');
    const dbKey = ConfigModel.get('starsender_api_key');
    if (dbKey) return dbKey;
  } catch {}
  return config.starsender.apiKey;
}

/**
 * 1000% Anti-Banned Message Enhancer & Uniqueness Engine:
 * - Menyisipkan kode unik hash kriptografik & timestamp detik pada bagian bawah setiap pesan.
 * - Menjamin setiap pengiriman memiliki hash string (MD5/SHA) yang 100% unik dan berbeda,
 *   sehingga algoritma anti-spam WhatsApp tidak mendeteksi sebagai robot broadcast berulang.
 */
function applyAntiBanProtection(message) {
  if (!message || typeof message !== 'string') return message;

  // Mencegah penambahan token ganda jika sudah ada
  if (message.includes('Ref. Verifikasi:') || message.includes('HumasKanwil')) {
    return message;
  }

  // Kode Unik Anti-Duplicate Hash (Alfanumerik Acak + Timestamp Lengkap dengan Detik)
  const now = new Date();
  const timestamp = now.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateCode = now.toISOString().slice(2, 10).replace(/-/g, ''); // YYMMDD
  const randomHash = Math.random().toString(36).substring(2, 6).toUpperCase() + Math.floor(100 + Math.random() * 900);

  const verificationFooter = `\n\n───\n_🔒 HumasKanwil | Ref. Verifikasi: *#ATR-${dateCode}-${randomHash}* (${timestamp} WIB)_`;

  return message + verificationFooter;
}

// ============================================
// GATEWAY EXECUTION LAYER
// ============================================

/**
 * Convert an Instagram / CDN image URL to a clean public .jpg URL.
 * Catatan penting:
 * 1. URL Instagram CDN berakhiran '_n.webp' membuat gateway WhatsApp mendeteksinya sebagai file Dokumen.
 * 2. Mengubah ekstensi di URL CDN langsung membuat HMAC signature Meta rusak (HTTP 403 Forbidden).
 * 3. Base64 Data URI ('data:image/...') tidak didukung oleh StarSender (harus public URL HTTP/HTTPS).
 * 4. Solusi: Unduh buffer gambar asli (yang sebenarnya berformat JPEG byte), lalu unggah
 *    sebagai file .jpg ke public host (Catbox / Litterbox / tmpfiles) agar StarSender menerima
 *    URL berakhiran .jpg murni dan WhatsApp menampilkannya sebagai FOTO TERBUKA PENUH (imageMessage).
 */
async function resolveImageAsJpgUrl(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return '';
  
  // Jika sudah URL .jpg bersih yang bukan dari cdninstagram, langsung gunakan
  if (imageUrl.endsWith('.jpg') && !imageUrl.includes('cdninstagram.com')) {
    return imageUrl;
  }
  
  try {
    const res = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(12000)
    });
    
    if (!res.ok) {
      log.warn(`[MEDIA] Gagal mengunduh gambar Instagram (HTTP ${res.status}): ${imageUrl}`);
      return imageUrl;
    }
    
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length < 100) {
      log.warn(`[MEDIA] Ukuran buffer gambar terlalu kecil (${buffer.length} bytes)`);
      return imageUrl;
    }

    // Provider 1: Catbox (https://catbox.moe)
    try {
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      form.append('fileToUpload', blob, 'post.jpg');
      
      const catboxRes = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(10000)
      });
      const catboxUrl = (await catboxRes.text()).trim();
      if (catboxUrl.startsWith('http')) {
        log.info(`[MEDIA] ✅ Gambar berhasil di-convert ke JPG via Catbox: ${catboxUrl}`);
        return catboxUrl;
      }
    } catch (e1) {
      log.warn(`[MEDIA] Catbox gagal: ${e1.message}, mencoba Litterbox...`);
    }

    // Provider 2: Litterbox (Temporary 24h retention)
    try {
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('time', '24h');
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      form.append('fileToUpload', blob, 'post.jpg');
      
      const litterRes = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(10000)
      });
      const litterUrl = (await litterRes.text()).trim();
      if (litterUrl.startsWith('http')) {
        log.info(`[MEDIA] ✅ Gambar berhasil di-convert ke JPG via Litterbox: ${litterUrl}`);
        return litterUrl;
      }
    } catch (e2) {
      log.warn(`[MEDIA] Litterbox gagal: ${e2.message}, mencoba tmpfiles...`);
    }

    // Provider 3: tmpfiles.org
    try {
      const form = new FormData();
      const blob = new Blob([buffer], { type: 'image/jpeg' });
      form.append('file', blob, 'post.jpg');
      
      const tmpRes = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(10000)
      });
      const tmpData = await tmpRes.json();
      if (tmpData?.data?.url) {
        const directUrl = tmpData.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
        log.info(`[MEDIA] ✅ Gambar berhasil di-convert ke JPG via tmpfiles: ${directUrl}`);
        return directUrl;
      }
    } catch (e3) {
      log.warn(`[MEDIA] tmpfiles gagal: ${e3.message}`);
    }

  } catch (err) {
    log.error(`[MEDIA] Gagal resolve image ke JPG: ${err.message}`);
  }

  return imageUrl;
}

/**
 * Execute send via StarSender API
 */
async function executeStarSender(to, text, isGroup = false, options = {}) {
  const url = isGroup ? config.starsender.groupUrl : config.starsender.sendUrl;
  let fileData = '';
  
  if (options.videoUrl) {
    // Media berupa video reels / MP4 asli
    fileData = options.videoUrl;
    log.info(`[MEDIA] 🎬 Mengirim video reels: ${fileData.substring(0, 80)}...`);
  } else if (options.imageUrl) {
    let rawImg = options.imageUrl;
    if (rawImg.startsWith('http')) {
      fileData = await resolveImageAsJpgUrl(rawImg);
    } else {
      fileData = rawImg;
    }
  }

  const payload = {
    messageType: fileData ? 'media' : 'text',
    to: to,
    delay: 2,
  };
  
  if (fileData) {
    payload.file = fileData;
    payload.body = text;
  } else {
    payload.body = text;
  }

  if (isGroup) {
    const mentionMatches = text.match(/@(62\d+|08\d+|8\d+)/g) || [];
    const mentionNumbers = [...new Set(mentionMatches.map(m => formatPhoneNumber(m.replace('@', ''))))].filter(Boolean);
    if (mentionNumbers.length > 0) {
      payload.mention = mentionNumbers;
      payload.mentions = mentionNumbers.map(n => `${n}@s.whatsapp.net`);
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: getActiveApiKey(),
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || `StarSender HTTP ${response.status}`);
  }
  return { ...data, _provider: 'starsender' };
}

/**
 * Execute send via GoWA (aldinokemal/go-whatsapp-web-multidevice) REST API
 * GoWA bisa kirim ke nomor manapun tanpa harus punya riwayat chat — sakti untuk cold numbers.
 */
async function executeGoWA(to, text, isGroup = false, options = {}) {
  // GoWA image endpoint differs or takes different payload
  // Assume generic GoWA JSON format: { phone, message, image: url } or similar
  const url = isGroup ? config.gateway.gowaGroupUrl : config.gateway.gowaSendUrl;
  const headers = { 'Content-Type': 'application/json' };
  if (config.gateway.gowaApiKey) {
    headers['Authorization'] = `Bearer ${config.gateway.gowaApiKey}`;
  }

  const payload = isGroup ? { group: to, message: text } : { phone: to, message: text };
  if (options.videoUrl) {
    payload.image = options.videoUrl;
  } else if (options.imageUrl) {
    payload.image = options.imageUrl;
  }

  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  
  if (!response.ok || (data.code && data.code !== 'SUCCESS' && data.code !== 200)) {
    throw new Error(data.message || data.error || `GoWA Error: ${data.code || response.status}`);
  }
  return { ...data, _provider: 'gowa' };
}

/**
 * Unified gateway executor — routes to the correct provider
 */
async function executeGatewaySend(to, text, isGroup = false, forceProvider = null, options = {}) {
  const provider = forceProvider || (config.gateway && config.gateway.provider ? config.gateway.provider : 'starsender');

  if (provider === 'gowa') {
    return executeGoWA(to, text, isGroup, options);
  } else {
    return executeStarSender(to, text, isGroup, options);
  }
}

// ============================================
// COLD NUMBER DETECTION
// ============================================

/**
 * Cek apakah nomor ini pernah berhasil menerima pesan sebelumnya.
 * Jika pernah ada log 'sent' ke nomor ini → dianggap "warm" (bukan cold number).
 * Jika belum pernah ada → "cold" (nomor baru, belum pernah di-chat).
 */
function isKnownNumber(phoneNumber) {
  try {
    const { getDb } = require('../database/init');
    const db = getDb();
    const row = db.prepare(
      "SELECT COUNT(*) as cnt FROM notification_logs WHERE target_number = ? AND status = 'sent' LIMIT 1"
    ).get(phoneNumber);
    return row && row.cnt > 0;
  } catch (err) {
    log.warn(`Cold number check failed for ${phoneNumber}: ${err.message}, treating as cold.`);
    return false;
  }
}

/**
 * Cek apakah GoWA tersedia dan terkonfigurasi
 */
function isGowaAvailable() {
  return !!(config.gateway && config.gateway.gowaSendUrl && config.gateway.fallbackEnabled);
}

// ============================================
// INTELLIGENT ROUTING ENGINE
// ============================================

/**
 * Menentukan provider mana yang dipakai berdasarkan:
 * 1. coldNumberStrategy dari config
 * 2. Riwayat pengiriman ke nomor ini
 * 3. Ketersediaan GoWA
 *
 * Returns: 'starsender' | 'gowa'
 */
function resolveProvider(phoneNumber) {
  const mainProvider = config.gateway && config.gateway.provider ? config.gateway.provider : 'starsender';

  // Jika main provider sudah GoWA, langsung pakai GoWA
  if (mainProvider === 'gowa') return 'gowa';

  // Jika GoWA tidak available, tetap pakai StarSender
  if (!isGowaAvailable()) return 'starsender';

  const strategy = config.gateway.coldNumberStrategy || 'gowa_first';

  switch (strategy) {
    case 'gowa_only':
      // Semua pengiriman personal lewat GoWA
      return 'gowa';

    case 'gowa_first': {
      // Nomor baru (cold) → GoWA, nomor lama (warm) → StarSender
      const known = isKnownNumber(phoneNumber);
      if (known) {
        log.info(`[ROUTING] ${phoneNumber} is WARM (known) → StarSender`);
        return 'starsender';
      } else {
        log.info(`[ROUTING] ${phoneNumber} is COLD (new) → GoWA`);
        return 'gowa';
      }
    }

    case 'starsender_first':
    default:
      // Selalu coba StarSender dulu (fallback ke GoWA nanti jika gagal)
      return 'starsender';
  }
}

// ============================================
// PUBLIC API: SEND MESSAGES
// ============================================

/**
 * Send a WhatsApp message to a personal number with intelligent hybrid routing.
 * 
 * Flow:
 * 1. Resolve provider (StarSender or GoWA) berdasarkan strategi cold number
 * 2. Kirim ice-breaker greeting (jika diperlukan)
 * 3. Kirim pesan utama via resolved provider
 * 4. Jika gagal dan fallback enabled → retry via provider lain (GoWA / StarSender)
 */
async function sendPersonalMessage(phoneNumber, message, options = {}) {
  const formattedPhone = formatPhoneNumber(phoneNumber);
  const resolvedProvider = options.forceProvider || resolveProvider(formattedPhone);
  const fallbackProvider = resolvedProvider === 'gowa' ? 'starsender' : 'gowa';


  const protectedMessage = applyAntiBanProtection(message);
  log.info(`[SEND] Sending personal message to ${formattedPhone} via ${resolvedProvider.toUpperCase()}...`);

  // === ATTEMPT 1: Kirim via resolved provider ===
  try {
    const result = await retry(() => executeGatewaySend(formattedPhone, protectedMessage, false, resolvedProvider, options), 3, 2000);
    log.info(`[SEND] ✅ Message sent to ${formattedPhone} via ${resolvedProvider.toUpperCase()}`, { success: true });
    return { success: true, data: result, sentMessage: protectedMessage, provider: result._provider || resolvedProvider };
  } catch (primaryError) {
    log.warn(`[SEND] ❌ ${resolvedProvider.toUpperCase()} failed for ${formattedPhone}: ${primaryError.message}`);

    // === ATTEMPT 2: Fallback ke provider lain ===
    // Jangan fallback ke StarSender jika pengiriman utama (GoWA) gagal.
    // StarSender selalu memberikan "fake success" untuk nomor baru yang gagal terkirim,
    // sehingga akan menutupi pesan error asli dan menggagalkan fitur "Kirim Manual" (Click-to-chat).
    if (fallbackProvider === 'gowa' && config.gateway.fallbackEnabled && isGowaAvailable()) {
      log.info(`[FALLBACK] Retrying ${formattedPhone} via ${fallbackProvider.toUpperCase()}...`);
      try {
        const fallbackResult = await retry(() => executeGatewaySend(formattedPhone, protectedMessage, false, fallbackProvider, options), 2, 2000);
        log.info(`[FALLBACK] ✅ Message sent to ${formattedPhone} via ${fallbackProvider.toUpperCase()} (fallback)`, { success: true });
        return { success: true, data: fallbackResult, sentMessage: protectedMessage, provider: fallbackResult._provider || fallbackProvider, wasFallback: true };
      } catch (fallbackError) {
        log.error(`[FALLBACK] ❌ ${fallbackProvider.toUpperCase()} also failed for ${formattedPhone}: ${fallbackError.message}`);
        return { success: false, error: `Primary (${resolvedProvider}): ${primaryError.message} | Fallback (${fallbackProvider}): ${fallbackError.message}`, provider: 'both_failed' };
      }
    }

    // Tidak ada fallback
    return { success: false, error: primaryError.message, provider: resolvedProvider };
  }
}

/**
 * Send a WhatsApp message to a group via StarSender or GoWA with anti-ban protection
 */
async function sendGroupMessage(groupName, message, options = {}) {
  const protectedMessage = applyAntiBanProtection(message);
  const provider = config.gateway && config.gateway.provider ? config.gateway.provider : 'starsender';

  log.info(`Sending group message to "${groupName}" via ${provider.toUpperCase()}...`);

  try {
    const result = await retry(() => executeGatewaySend(groupName, protectedMessage, true, provider, options), 3, 2000);

    log.info(`Group message sent to "${groupName}"`, { success: true });
    return { success: true, data: result, sentMessage: protectedMessage, provider: result._provider || provider };
  } catch (error) {
    // Fallback untuk group message juga
    if (provider === 'starsender' && config.gateway.fallbackEnabled && isGowaAvailable()) {
      log.info(`[FALLBACK] Retrying group "${groupName}" via GOWA...`);
      try {
        const fallbackResult = await retry(() => executeGatewaySend(groupName, protectedMessage, true, 'gowa', options), 2, 2000);
        log.info(`[FALLBACK] ✅ Group message sent to "${groupName}" via GOWA (fallback)`);
        return { success: true, data: fallbackResult, sentMessage: protectedMessage, provider: 'gowa', wasFallback: true };
      } catch (fallbackError) {
        log.error(`[FALLBACK] ❌ GOWA also failed for group "${groupName}": ${fallbackError.message}`);
      }
    }

    log.error(`Failed to send group message to "${groupName}"`, { error: error.message });
    return { success: false, error: error.message, provider };
  }
}

/**
 * Send notification for a new ticket — both group and personal
 */
async function sendTicketNotification(ticket, groupName, groupMessage, personalMessages) {
  const results = {
    group: null,
    personal: [],
  };

  // 1. Send to group
  if (groupName && groupMessage) {
    results.group = await sendGroupMessage(groupName, groupMessage);

    // Log notification
    NotificationLogModel.create({
      ticketId: ticket.ticketId,
      targetType: 'group',
      targetName: groupName,
      targetNumber: '',
      message: results.group.sentMessage || groupMessage,
      status: results.group.success ? 'sent' : 'failed',
      response: JSON.stringify(results.group),
    });

    await humanlikeSleep(4000, 8500); // Jitter random delay antar pesan agar 100% alami seperti manusia
  }

  // 2. Send to each matching admin
  for (const { admin, message } of personalMessages) {
    const result = await sendPersonalMessage(admin.no_hp, message, { useIceBreaker: true, recipientName: admin.nama });

    results.personal.push({
      admin: admin.nama,
      phone: admin.no_hp,
      ...result,
    });

    // Log notification
    NotificationLogModel.create({
      ticketId: ticket.ticketId,
      targetType: 'personal',
      targetName: admin.nama,
      targetNumber: admin.no_hp,
      message: result.sentMessage || message,
      status: result.success ? 'sent' : 'failed',
      response: JSON.stringify(result),
    });

    await humanlikeSleep(4000, 8500); // Jitter random delay antar pengiriman pesan admin
  }

  return results;
}

module.exports = {
  sendPersonalMessage,
  sendGroupMessage,
  sendTicketNotification,
};
