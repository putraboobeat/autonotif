const { createLogger } = require('../utils/logger');
const { config } = require('../config');
const { sleep, retry, formatPhoneNumber } = require('../utils/helpers');
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
 * Send a WhatsApp message to a personal number via StarSender
 */
async function sendPersonalMessage(phoneNumber, message) {
  const formattedPhone = formatPhoneNumber(phoneNumber);

  log.info(`Sending personal message to ${formattedPhone}...`);

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
          body: message,
          delay: 2,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }

      return data;
    }, 3, 2000);

    log.info(`Personal message sent to ${formattedPhone}`, { success: true });
    return { success: true, data: result };
  } catch (error) {
    log.error(`Failed to send personal message to ${formattedPhone}`, { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Send a WhatsApp message to a group via StarSender
 */
async function sendGroupMessage(groupName, message) {
  log.info(`Sending group message to "${groupName}"...`);

  try {
    const result = await retry(async () => {
      const mentionMatches = message.match(/@(62\d+|08\d+)/g) || [];
      const mentionNumbers = [...new Set(mentionMatches.map(m => m.replace('@', '')))];
      const mentionJid = mentionNumbers.map(n => n.startsWith('0') ? `62${n.slice(1)}@s.whatsapp.net` : `${n}@s.whatsapp.net`);

      const payload = {
        messageType: 'text',
        to: groupName,
        body: message,
        delay: 2,
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
    return { success: true, data: result };
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
      message: groupMessage,
      status: results.group.success ? 'sent' : 'failed',
      response: JSON.stringify(results.group),
    });

    await sleep(2000); // Delay between messages
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
      message: message,
      status: result.success ? 'sent' : 'failed',
      response: JSON.stringify(result),
    });

    await sleep(2000); // Delay between messages
  }

  return results;
}

module.exports = {
  sendPersonalMessage,
  sendGroupMessage,
  sendTicketNotification,
};
