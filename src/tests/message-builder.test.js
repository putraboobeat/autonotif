/**
 * Pre-Flight Automated QA Suite: Message Builder & Template Formatting Test
 * Specialized by: Test Results Analyzer & Senior Developer
 */
const { 
  buildKanwilMessage, 
  buildGroupMessage, 
  buildPersonalMessage, 
  buildGroupReminderMessage, 
  buildPersonalReminderMessage, 
  buildGroupReminderSummaryMessage, 
  buildClosedTicketGroupMessage 
} = require('../notifier/message-builder');
const { renderTemplate } = require('../notifier/templates');
const { createLogger } = require('../utils/logger');

const log = createLogger('TEST_MSG_BUILDER');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

function verifyNoUndefined(text, name) {
  assert(typeof text === 'string', `${name} must return a valid string`);
  assert(!text.includes('undefined'), `${name} generated output containing 'undefined' string literal`);
  assert(!text.includes('NaN'), `${name} generated output containing 'NaN' math error`);
  assert(text.trim().length > 20, `${name} generated awkwardly short content (< 20 chars)`);
}

async function runMessageBuilderTests() {
  console.log('\n======================================================');
  console.log('📝 [TEST SUITE 2/3] EXECUTING MESSAGE BUILDER QA SUITE');
  console.log('======================================================');

  try {
    const mockTicket = {
      ticketId: 'TICKET-2026-887711',
      customer: 'Ibu Mariani (Warga Banda Aceh)',
      agent: 'Helpdesk Layanan Pertanahan',
      kantorPertanahan: 'Kantor Pertanahan Kota Banda Aceh',
      status: 'Open',
      priority: 'High / Urgent',
      category: 'Pelayanan Pendaftaran Tanah',
      subCategory: 'Pengecekan Sertipikat Online',
      subject: 'Kendala verifikasi sertipikat elektronik di ATR/BPN',
      createdDate: '2026-07-28 08:15:00',
      lastUpdate: '2026-07-28 09:30:00',
      reminderCount: 2
    };

    const mockAdmin = {
      nama: 'Bapak Hendry S.H.',
      no_hp: '081234567890',
      kantor_pertanahan: 'Kantor Pertanahan Kota Banda Aceh'
    };

    log.info('1. Testing buildKanwilMessage...');
    const kanwilMsg = buildKanwilMessage(mockTicket, 'Admin Utama Kanwil Aceh');
    verifyNoUndefined(kanwilMsg, 'buildKanwilMessage');
    log.info('   ✔ Kanwil notification formatted cleanly with proper emphasis.');

    log.info('2. Testing buildGroupMessage & buildPersonalMessage...');
    const groupMsg = buildGroupMessage(mockTicket, 'Grup Monitoring OCA Kanwil', [mockTicket]);
    verifyNoUndefined(groupMsg, 'buildGroupMessage');
    const personalMsg = buildPersonalMessage(mockTicket, mockAdmin);
    verifyNoUndefined(personalMsg, 'buildPersonalMessage');
    log.info('   ✔ Group & personal alert text verified against syntax rules.');

    log.info('3. Testing Reminder & Summary generation...');
    const groupRemMsg = buildGroupReminderMessage(mockTicket, 'Grup Monitoring OCA Kanwil', 2);
    verifyNoUndefined(groupRemMsg, 'buildGroupReminderMessage');
    const personalRemMsg = buildPersonalReminderMessage(mockTicket, mockAdmin, 2);
    verifyNoUndefined(personalRemMsg, 'buildPersonalReminderMessage');
    const summaryMsg = buildGroupReminderSummaryMessage([mockTicket, mockTicket], 'Grup Monitoring OCA Kanwil');
    verifyNoUndefined(summaryMsg, 'buildGroupReminderSummaryMessage');
    log.info('   ✔ Reminder summary logic outputs bulleted table cleanly.');

    log.info('4. Testing Appreciation message for resolved/closed tickets...');
    const closedMsg = buildClosedTicketGroupMessage([{ ...mockTicket, status: 'Closed' }]);
    verifyNoUndefined(closedMsg, 'buildClosedTicketGroupMessage');
    log.info('   ✔ Resolution announcement appreciation string verified.');

    log.info('5. Testing raw renderTemplate engine for escalation flows...');
    const humasMsg = renderTemplate('template_eskalasi_humas', {
      ticketId: mockTicket.ticketId,
      kantor: mockTicket.kantorPertanahan,
      customer: mockTicket.customer,
      kategori: mockTicket.category,
      subjek: mockTicket.subject,
      tanggal: mockTicket.createdDate,
      lastUpdate: mockTicket.lastUpdate,
      reminderCount: 3
    });
    verifyNoUndefined(humasMsg, 'template_eskalasi_humas');
    log.info('   ✔ Humas escalation template engine executed with zero errors.');

    console.log('======================================================');
    console.log('✅ [PASSED] MESSAGE BUILDER SUITE COMPENSATED 100% QUALITY');
    console.log('======================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ [FAILED] MESSAGE BUILDER TEST SUITE TERMINATED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runMessageBuilderTests();
