/**
 * Quick Edge Case Tests (non-blocking)
 */

const { FileMessageQueue } = require('./src/evolution/queue/file-queue');
const { LearningLog } = require('./src/evolution/learning-log');
const { PendingProposalsIndex } = require('./src/evolution/pending-index');
const { ChangeApplier } = require('./src/evolution/change-applier');
const { InputValidator } = require('./src/evolution/validation');
const { EvolutionMetrics } = require('./src/evolution/metrics');

const fs = require('fs').promises;
const path = require('path');

const TEST_DIR = '/tmp/test-quick';

async function cleanup() {
  try { await fs.rm(TEST_DIR, { recursive: true, force: true }); } catch {}
}

async function testFileQueue() {
  console.log('\n📋 FileQueue Tests');
  
  const queue = new FileMessageQueue({ basePath: TEST_DIR + '/queue', name: 'test' });
  await queue.init();
  
  // Empty operations
  console.assert(await queue.pop() === null, 'Pop empty should return null');
  console.assert(await queue.peek() === null, 'Peek empty should return null');
  console.assert(await queue.length() === 0, 'Empty length should be 0');
  
  // Push/pop
  const id1 = await queue.push({ data: 'msg1' });
  const id2 = await queue.push({ data: 'msg2' });
  console.assert(id1 && id2, 'Should return IDs');
  console.assert(await queue.length() === 2, 'Length should be 2');
  
  // Peek doesn't remove
  const peeked = await queue.peek();
  console.assert(peeked.data === 'msg1', 'Peek should return first');
  console.assert(await queue.length() === 2, 'Peek should not remove');
  
  // Pop removes
  const popped = await queue.pop();
  console.assert(popped.data === 'msg1', 'Pop should return first');
  console.assert(await queue.length() === 1, 'Pop should remove');
  
  // Recover from WAL
  await queue.push({ data: 'wal-test' });
  await fs.writeFile(queue.queuePath, ''); // Clear main queue
  const recovered = await queue.recover();
  console.assert(recovered.recovered === 2, 'Should recover from WAL');
  
  console.log('  ✅ FileQueue OK');
}

async function testLearningLog() {
  console.log('\n📝 LearningLog Tests');
  
  const log = new LearningLog({ basePath: TEST_DIR + '/logs' });
  await log.init();
  
  // Record
  const entry = await log.record({ type: 'test', data: 'value' });
  console.assert(entry.timestamp, 'Should have timestamp');
  
  // Query
  const results = await log.query({ type: 'test' });
  console.assert(results.length >= 1, 'Should find entries');
  
  // Skill history
  await log.record({ type: 'skill', skill: 'my-skill' });
  const history = await log.getSkillHistory('my-skill');
  console.assert(history.length >= 1, 'Should get skill history');
  
  // Recent
  const recent = await log.getRecent(7);
  console.assert(recent.length >= 1, 'Should get recent entries');
  
  console.log('  ✅ LearningLog OK');
}

async function testPendingIndex() {
  console.log('\n📇 PendingIndex Tests');
  
  const index = new PendingProposalsIndex({ basePath: TEST_DIR + '/pending' });
  await index.init();
  
  // Add
  await index.add({ id: 'p1', type: 'config', status: 'pending' });
  
  // Get
  const found = await index.get('p1');
  console.assert(found.id === 'p1', 'Should find by ID');
  console.assert(found._indexedAt, 'Should have indexed timestamp');
  
  // Update
  await index.update('p1', { status: 'approved' });
  const updated = await index.get('p1');
  console.assert(updated.status === 'approved', 'Should update');
  
  // List
  const all = await index.list();
  console.assert(all.length >= 1, 'Should list all');
  
  // List with filters
  const approved = await index.list({ status: 'approved' });
  console.assert(approved.length >= 1, 'Should filter by status');
  
  // Remove
  const removed = await index.remove('p1');
  console.assert(removed === true, 'Should return true on remove');
  console.assert(await index.get('p1') === null, 'Should be null after remove');
  
  console.log('  ✅ PendingIndex OK');
}

async function testChangeApplier() {
  console.log('\n🔧 ChangeApplier Tests');
  
  const applier = new ChangeApplier({ 
    basePath: TEST_DIR + '/applier',
    configPath: TEST_DIR + '/applier/config',
    skillsPath: TEST_DIR + '/applier/skills',
    backupPath: TEST_DIR + '/applier/backups'
  });
  await applier.init();
  
  // Config
  const configResult = await applier.applyConfig({
    settings: { timeout: 5000, retries: 3 }
  });
  console.assert(configResult.applied === true, 'Config should apply');
  
  // Verify config file
  const configContent = await fs.readFile(TEST_DIR + '/applier/config/evolution.yml', 'utf8');
  console.assert(configContent.includes('timeout: 5000'), 'Config should have timeout');
  
  // New skill
  const skillResult = await applier.applyNewSkill({
    skill: { name: 'quick-skill', description: 'Quick test' }
  }, { id: 'test', level: 'L2' });
  console.assert(skillResult.applied === true, 'Skill should be created');
  console.assert(skillResult.skill === 'quick-skill', 'Should return skill name');
  
  // Verify skill files
  const skillFiles = await fs.readdir(TEST_DIR + '/applier/skills/quick-skill');
  console.assert(skillFiles.includes('SKILL.md'), 'Should have SKILL.md');
  console.assert(skillFiles.includes('package.json'), 'Should have package.json');
  
  // Backup
  const proposal = { id: 'backup-test', level: 'L3', type: 'config' };
  await fs.writeFile(TEST_DIR + '/applier/config/evolution.yml', 'backup: true\n');
  await applier.createBackup(proposal);
  
  const backupDir = TEST_DIR + '/applier/backups/backup-test';
  const backups = await fs.readdir(backupDir);
  console.assert(backups.length > 0, 'Should create backup');
  
  // Rollback
  await fs.writeFile(TEST_DIR + '/applier/config/evolution.yml', 'modified: true\n');
  const rollback = await applier.rollback(proposal);
  console.assert(rollback.rolledBack === true, 'Should rollback');
  
  const restored = await fs.readFile(TEST_DIR + '/applier/config/evolution.yml', 'utf8');
  console.assert(restored.includes('backup: true'), 'Should restore backup');
  
  console.log('  ✅ ChangeApplier OK');
}

async function testValidation() {
  console.log('\n🛡️ Validation Tests');
  
  // Valid proposals
  const valid1 = InputValidator.validateProposal({
    type: 'config', reason: 'Valid reason here', settings: {}
  });
  console.assert(valid1.valid === true, 'Valid config should pass');
  
  const valid2 = InputValidator.validateProposal({
    type: 'new_skill', 
    skill: { name: 'valid-skill', description: 'Test' },
    reason: 'Valid reason here'
  });
  console.assert(valid2.valid === true, 'Valid skill should pass');
  
  // Invalid - missing type
  const invalid1 = InputValidator.validateProposal({ reason: 'Valid reason' });
  console.assert(invalid1.valid === false, 'Missing type should fail');
  
  // Invalid - short reason
  const invalid2 = InputValidator.validateProposal({
    type: 'config', reason: 'Short', settings: {}
  });
  console.assert(invalid2.valid === false, 'Short reason should fail');
  
  // Invalid - bad skill name
  const invalid3 = InputValidator.validateProposal({
    type: 'new_skill', 
    skill: { name: 'Invalid Name', description: 'Test' },
    reason: 'Valid reason here'
  });
  console.assert(invalid3.valid === false, 'Invalid skill name should fail');
  
  // Invalid - unsafe self-mod
  const invalid4 = InputValidator.validateProposal({
    type: 'self_modification',
    component: 'test',
    reason: 'Valid reason here',
    modification: { safe: false }
  });
  console.assert(invalid4.valid === false, 'Unsafe self-mod should fail');
  
  // Valid ID check
  console.assert(InputValidator.isValidId('valid-id_123') === true, 'Valid ID');
  console.assert(InputValidator.isValidId('invalid id!') === false, 'Invalid ID');
  
  // Sanitize
  const sanitized = InputValidator.sanitizeString('  hello\x00\x01world  ');
  console.assert(sanitized === 'helloworld', 'Should sanitize');
  
  console.log('  ✅ Validation OK');
}

async function testMetrics() {
  console.log('\n📊 Metrics Tests');
  
  const metrics = new EvolutionMetrics({ basePath: TEST_DIR + '/metrics' });
  await metrics.init();
  
  // Counter
  metrics.increment('counter1');
  metrics.increment('counter1', 5);
  
  // Gauge
  metrics.gauge('gauge1', 10);
  metrics.gauge('gauge1', 20);
  
  // Timer
  metrics.timer('timer1', 100);
  metrics.timer('timer1', 200);
  
  // Get metrics
  const data = metrics.getMetrics();
  console.assert(data.counters.counter1 === 6, 'Counter should be 6');
  console.assert(data.gauges.gauge1 === 20, 'Gauge should be 20');
  console.assert(data.timers.timer1.count === 2, 'Timer should have 2 entries');
  console.assert(data.timers.timer1.avg === 150, 'Average should be 150');
  
  // Alerts
  metrics.gauge('pending_proposals', 15); // High
  const alerts = metrics.checkAlerts();
  const hasHighPending = alerts.some(a => a.metric === 'pending_proposals');
  console.assert(hasHighPending, 'Should alert on high pending');
  
  // Report
  const report = metrics.getReport();
  console.assert(report.summary !== undefined, 'Should have summary');
  console.assert(report.alerts !== undefined, 'Should have alerts');
  
  // Save
  await metrics.save();
  const saved = await fs.readFile(TEST_DIR + '/metrics/metrics.json', 'utf8');
  console.assert(saved.includes('counter1'), 'Should save metrics');
  
  console.log('  ✅ Metrics OK');
}

async function runTests() {
  console.log('========================================');
  console.log('Quick Edge Case Tests');
  console.log('========================================');
  
  await cleanup();
  
  try {
    await testFileQueue();
    await testLearningLog();
    await testPendingIndex();
    await testChangeApplier();
    await testValidation();
    await testMetrics();
    
    console.log('\n========================================');
    console.log('ALL TESTS PASSED ✅');
    console.log('========================================');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ FAILED:', err);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
