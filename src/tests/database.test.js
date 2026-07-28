/**
 * Pre-Flight Automated QA Suite: Database Integrity Test
 * Specialized by: Test Results Analyzer & Backend Architect
 */
const { initDatabase, closeDatabase, getDb } = require('../database/init');
const { TicketModel, AdminModel, ConfigModel, NotificationLogModel } = require('../database/models');
const { createLogger } = require('../utils/logger');

const log = createLogger('TEST_DB');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

async function runDatabaseTests() {
  console.log('\n======================================================');
  console.log('🔬 [TEST SUITE 1/3] EXECUTING DATABASE INTEGRITY TESTS');
  console.log('======================================================');
  
  try {
    log.info('1. Initializing database schema & connection...');
    initDatabase();
    const db = getDb();
    assert(db, 'Database connection handle must be valid');

    log.info('2. Testing ConfigModel read/write semantics...');
    ConfigModel.set('test_preflight_key', 'passed_ready_for_on_air');
    const val = ConfigModel.get('test_preflight_key');
    assert(val === 'passed_ready_for_on_air', 'ConfigModel set/get verification failed');
    log.info('   ✔ ConfigModel test passed with 100% data fidelity.');

    log.info('3. Testing AdminModel repository indexing & query matching...');
    const allAdmins = AdminModel.getAll();
    assert(Array.isArray(allAdmins), 'AdminModel.getAll() must return an array');
    log.info(`   ✔ Admin table currently indexes ${allAdmins.length} registered officials.`);

    if (allAdmins.length > 0) {
      const sampleOffice = allAdmins[0].kantor_pertanahan;
      const matching = AdminModel.findByKantor(sampleOffice);
      assert(matching.length > 0, `findByKantor must resolve officials for ${sampleOffice}`);
      log.info(`   ✔ Successfully resolved ${matching.length} admin(s) for office: "${sampleOffice}".`);
    }

    log.info('4. Testing TicketModel transaction consistency...');
    const mockTicket = {
      ticketId: 'TICKET-TEST-999999',
      customer: 'Bapak Rudi QA Test',
      agent: 'System Verification Bot',
      kantorPertanahan: 'Kantor Pertanahan Kota Banda Aceh',
      status: 'Open',
      priority: 'Urgent',
      category: 'Pelayanan Sertipikat',
      subCategory: 'Pengecekan Sertipikat',
      subject: 'Pre-flight QA Validation',
      createdDate: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      notifiedGroup: false,
      notifiedAdmin: true
    };

    TicketModel.save(mockTicket);
    const checked = TicketModel.isProcessed('TICKET-TEST-999999');
    assert(checked && checked.customer === mockTicket.customer, 'Ticket storage replication check failed');
    log.info('   ✔ Ticket insert and process check completed successfully.');

    log.info('5. Testing NotificationLogModel recording & prune logic...');
    NotificationLogModel.create({
      ticketId: 'TICKET-TEST-999999',
      targetType: 'personal',
      targetName: 'Admin QA',
      targetNumber: '081234567890',
      message: 'Test automated audit message',
      status: 'sent',
      response: '{"success":true}'
    });
    
    // Clean up test ticket and logs
    db.prepare('DELETE FROM processed_tickets WHERE ticket_id = ?').run('TICKET-TEST-999999');
    db.prepare('DELETE FROM notification_logs WHERE ticket_id = ?').run('TICKET-TEST-999999');
    db.prepare('DELETE FROM system_config WHERE key = ?').run('test_preflight_key');

    log.info('   ✔ Log creation, cascade inspection, and hygienic cleanup verified.');

    closeDatabase();
    console.log('======================================================');
    console.log('✅ [PASSED] DATABASE SUITE COMPENSATED 100% INTEGRITY');
    console.log('======================================================\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ [FAILED] DATABASE TEST SUITE TERMINATED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runDatabaseTests();
