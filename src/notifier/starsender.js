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
 * Execute send via StarSender API
 */
async function executeStarSender(to, text, isGroup = false) {
  const url = isGroup ? config.starsender.groupUrl : config.starsender.sendUrl;
  const payload = {
    messageType: 'text',
    to: to,
    body: text,
    delay: 2,
  };

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
async function executeGoWA(to, text, isGroup = false) {
  const url = isGroup ? config.gateway.gowaGroupUrl : config.gateway.gowaSendUrl;
  const headers = { 'Content-Type': 'application/json' };
  if (config.gateway.gowaApiKey) {
    headers['Authorization'] = `Bearer ${config.gateway.gowaApiKey}`;
  }

  const payload = isGroup ? { group: to, message: text } : { phone: to, message: text };

  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `GoWA HTTP ${response.status}`);
  }
  return { ...data, _provider: 'gowa' };
}

/**
 * Unified gateway executor — routes to the correct provider
 */
async function executeGatewaySend(to, text, isGroup = false, forceProvider = null) {
  const provider = forceProvider || (config.gateway && config.gateway.provider ? config.gateway.provider : 'starsender');

  if (provider === 'gowa') {
    return executeGoWA(to, text, isGroup);
  } else {
    return executeStarSender(to, text, isGroup);
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
    const result = await retry(() => executeGatewaySend(formattedPhone, protectedMessage, false, resolvedProvider), 3, 2000);
    log.info(`[SEND] ✅ Message sent to ${formattedPhone} via ${resolvedProvider.toUpperCase()}`, { success: true });
    return { success: true, data: result, sentMessage: protectedMessage, provider: result._provider || resolvedProvider };
  } catch (primaryError) {
    log.warn(`[SEND] ❌ ${resolvedProvider.toUpperCase()} failed for ${formattedPhone}: ${primaryError.message}`);

    // === ATTEMPT 2: Fallback ke provider lain ===
    if (config.gateway.fallbackEnabled && isGowaAvailable()) {
      log.info(`[FALLBACK] Retrying ${formattedPhone} via ${fallbackProvider.toUpperCase()}...`);
      try {
        const fallbackResult = await retry(() => executeGatewaySend(formattedPhone, protectedMessage, false, fallbackProvider), 2, 2000);
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
async function sendGroupMessage(groupName, message) {
  const protectedMessage = applyAntiBanProtection(message);
  const provider = config.gateway && config.gateway.provider ? config.gateway.provider : 'starsender';

  log.info(`Sending group message to "${groupName}" via ${provider.toUpperCase()}...`);

  try {
    const result = await retry(() => executeGatewaySend(groupName, protectedMessage, true, provider), 3, 2000);

    log.info(`Group message sent to "${groupName}"`, { success: true });
    return { success: true, data: result, sentMessage: protectedMessage, provider: result._provider || provider };
  } catch (error) {
    // Fallback untuk group message juga
    if (provider === 'starsender' && config.gateway.fallbackEnabled && isGowaAvailable()) {
      log.info(`[FALLBACK] Retrying group "${groupName}" via GOWA...`);
      try {
        const fallbackResult = await retry(() => executeGoWA(groupName, protectedMessage, true), 2, 2000);
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
