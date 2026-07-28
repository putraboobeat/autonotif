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

/**
 * Helper internal untuk eksekusi API Gateway (StarSender atau GoWA)
 */
async function executeGatewaySend(to, text, isGroup = false) {
  const provider = config.gateway && config.gateway.provider ? config.gateway.provider : 'starsender';

  if (provider === 'gowa') {
    // Pengiriman melalui GoWA (Golang WhatsApp / whatsmeow) yang sakti untuk nomor baru
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
    return data;
  } else {
    // Default: Pengiriman via StarSender API
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
      throw new Error(data.message || `HTTP ${response.status}`);
    }
    return data;
  }
}

/**
 * Send a WhatsApp message to a personal number via StarSender or GoWA with anti-ban & ice-breaker protection
 */
async function sendPersonalMessage(phoneNumber, message, options = {}) {
  const formattedPhone = formatPhoneNumber(phoneNumber);
  
  // TRIK SAKTI 1000% ANTI-BANNED & BYPASS COLD NUMBER WHATSAPP META (ICE-BREAKER 2-TAHAP)
  // Memancing pembukuan sesi E2E WhatsApp untuk nomor baru yang belum pernah berinteraksi sebelumnya
  if (options && options.useIceBreaker) {
    const greetingName = options.recipientName ? `Pak/Bu ${options.recipientName.split(' ')[0]}` : 'Bapak/Ibu';
    const iceBreakerMsg = `Assalamualaikum ${greetingName}, selamat pagi/siang. Mohon izin bersurat dari *Humas Kanwil BPN Provinsi Aceh* 🙏`;
    
    log.info(`[ICE-BREAKER] Sending simple handshake greeting first to unlock E2E WhatsApp session for cold number ${formattedPhone}...`);
    try {
      await retry(() => executeGatewaySend(formattedPhone, iceBreakerMsg, false), 2, 1500);
      // Jeda alami layaknya manusia mengetik (3.5 - 5 detik) agar WhatsApp membuka sesi chat dengan aman
      await humanlikeSleep(3500, 5000);
    } catch (e) {
      log.warn(`[ICE-BREAKER] Handshake greeting encountered warning: ${e.message}, proceeding with main message.`);
    }
  }

  const protectedMessage = applyAntiBanProtection(message);
  const provider = config.gateway && config.gateway.provider ? config.gateway.provider.toUpperCase() : 'STARSENDER';
  log.info(`Sending personal message to ${formattedPhone} via ${provider}...`);

  try {
    const result = await retry(() => executeGatewaySend(formattedPhone, protectedMessage, false), 3, 2000);

    log.info(`Personal message sent to ${formattedPhone}`, { success: true });
    return { success: true, data: result, sentMessage: protectedMessage };
  } catch (error) {
    log.error(`Failed to send personal message to ${formattedPhone}`, { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Send a WhatsApp message to a group via StarSender or GoWA with anti-ban protection
 */
async function sendGroupMessage(groupName, message) {
  const protectedMessage = applyAntiBanProtection(message);
  const provider = config.gateway && config.gateway.provider ? config.gateway.provider.toUpperCase() : 'STARSENDER';

  log.info(`Sending group message to "${groupName}" via ${provider}...`);

  try {
    const result = await retry(() => executeGatewaySend(groupName, protectedMessage, true), 3, 2000);

    log.info(`Group message sent to "${groupName}"`, { success: true });
    return { success: true, data: result, sentMessage: protectedMessage };
  } catch (error) {
    log.error(`Failed to send group message to "${groupName}"`, { error: error.message });
    return { success: false, error: error.message };
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
    const result = await sendPersonalMessage(admin.no_hp, message);

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
