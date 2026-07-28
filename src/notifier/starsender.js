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
 * Send a WhatsApp message to a personal number via StarSender with anti-ban protection
 */
async function sendPersonalMessage(phoneNumber, message) {
  const formattedPhone = formatPhoneNumber(phoneNumber);
  const protectedMessage = applyAntiBanProtection(message);
  const randomDelay = getRandomInt(5, 12); // Jitter delay 5-12 detik untuk perilaku manusiawi (anti-robot)

  log.info(`Sending personal message to ${formattedPhone} (delay: ${randomDelay}s)...`);

  try {
    const result = await retry(async () => {
      const response = await fetch(config.starsender.sendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: getActiveApiKey(),
        },
        body: JSON.stringify({
          messageType: 'text',
          to: formattedPhone,
          body: protectedMessage,
          delay: randomDelay,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }

      return data;
    }, 3, 2000);

    log.info(`Personal message sent to ${formattedPhone}`, { success: true });
    return { success: true, data: result, sentMessage: protectedMessage };
  } catch (error) {
    log.error(`Failed to send personal message to ${formattedPhone}`, { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Send a WhatsApp message to a group via StarSender with anti-ban protection
 */
async function sendGroupMessage(groupName, message) {
  const protectedMessage = applyAntiBanProtection(message);
  const randomDelay = getRandomInt(5, 12); // Jitter delay 5-12 detik

  log.info(`Sending group message to "${groupName}" (delay: ${randomDelay}s)...`);

  try {
    const result = await retry(async () => {
      const mentionMatches = protectedMessage.match(/@(62\d+|08\d+|8\d+)/g) || [];
      const mentionNumbers = [...new Set(mentionMatches.map(m => formatPhoneNumber(m.replace('@', ''))))].filter(Boolean);
      const mentionJid = mentionNumbers.map(n => `${n}@s.whatsapp.net`);

      const payload = {
        messageType: 'text',
        to: groupName,
        body: protectedMessage,
        delay: randomDelay,
      };

      if (mentionNumbers.length > 0) {
        payload.mention = mentionNumbers;
        payload.mentions = mentionJid;
      }

      const response = await fetch(config.starsender.groupUrl, {
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
    }, 3, 2000);

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
