const { HolidayModel, ConfigModel, NotificationLogModel } = require('../database/models');
const { buildHolidayReminderMessage } = require('../notifier/message-builder');
const { sendGroupMessage, sendPersonalMessage } = require('../notifier/starsender');
const { config } = require('../config');
const { createLogger } = require('../utils/logger');
const { formatPhoneNumber } = require('../utils/helpers');

const log = createLogger('HOLIDAY_DETECTOR');

async function checkAndSendHolidayReminders() {
  log.info('Checking for upcoming holidays...');
  try {
    const holidays = HolidayModel.getActive();
    if (!holidays || holidays.length === 0) {
      log.info('No active holidays found in database.');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentYear = today.getFullYear();

    for (const holiday of holidays) {
      const eventDate = new Date(holiday.event_date);
      
      // Calculate difference in days
      const diffTime = eventDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let shouldSend = false;
      let hMin = 0;
      let typeStr = '';

      if (diffDays === 3 && holiday.notified_h3_year !== currentYear) {
        shouldSend = true; hMin = 3; typeStr = 'h3';
      } else if (diffDays === 2 && holiday.notified_h2_year !== currentYear) {
        shouldSend = true; hMin = 2; typeStr = 'h2';
      } else if (diffDays === 1 && holiday.notified_h1_year !== currentYear) {
        shouldSend = true; hMin = 1; typeStr = 'h1';
      }

      if (shouldSend) {
        log.info(`Holiday "${holiday.name}" is ${diffDays} days away. Triggering H-${hMin} notification...`);
        
        const message = buildHolidayReminderMessage(holiday, hMin);
        const groupTarget = holiday.target_group || ConfigModel.get('holiday_wa_group_id') || config.starsender.defaultGroupId;
        const adminTarget = holiday.target_admins || ''; // No fallback to Kanwil for holidays unless set

        let groupSuccess = false;
        let adminSuccess = false;

        // Send to Group
        if (groupTarget) {
          log.info(`Sending holiday reminder to group ${groupTarget}`);
          const groupRes = await sendGroupMessage(groupTarget, message);
          if (groupRes && groupRes.success) {
            groupSuccess = true;
          }
          NotificationLogModel.create({
            ticketId: `HOLIDAY_${holiday.id}_H${hMin}`,
            targetType: 'group',
            targetName: groupTarget,
            targetNumber: groupTarget,
            message: message,
            status: groupRes && groupRes.success ? 'sent' : 'failed',
            response: JSON.stringify(groupRes),
          });
        }

        // Send to Admin
        if (adminTarget) {
          const adminNumbers = adminTarget.split(',').map(n => n.trim()).filter(Boolean);
          for (const num of adminNumbers) {
            const cleanNum = formatPhoneNumber(num);
            if (cleanNum) {
              log.info(`Sending holiday reminder to admin ${cleanNum}`);
              const adminRes = await sendPersonalMessage(cleanNum, message, { useIceBreaker: true, recipientName: 'Admin' });
              if (adminRes && adminRes.success) {
                adminSuccess = true;
              }
              NotificationLogModel.create({
                ticketId: `HOLIDAY_${holiday.id}_H${hMin}`,
                targetType: 'personal',
                targetName: 'Admin Hari Besar',
                targetNumber: cleanNum,
                message: message,
                status: adminRes && adminRes.success ? 'sent' : 'failed',
                response: JSON.stringify(adminRes),
              });
            }
          }
        }

        // Mark as notified for this year if at least one sending succeeded
        if (groupSuccess || adminSuccess) {
          HolidayModel.markNotified(holiday.id, currentYear, typeStr);
          log.info(`Holiday "${holiday.name}" marked as notified (${typeStr}) for year ${currentYear}`);
        }
      }
    }
  } catch (error) {
    log.error('Error in checkAndSendHolidayReminders', { error: error.message, stack: error.stack });
  }
}

module.exports = {
  checkAndSendHolidayReminders
};
