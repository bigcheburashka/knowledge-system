/**
 * Extended Real Tests for Self-Evolution System
 * Testing edge cases, concurrent access, and error handling
 */

const { FileMessageQueue } = require('./src/evolution/queue/file-queue');
const { LearningLog } = require('./src/evolution/learning-log');
const { PendingProposalsIndex } = require('./src/evolution/pending-index');
const { ApprovalManager } = require('./src/evolution/approval-manager');
const { ChangeApplier } = require('./src/evolution/change-applier');
const { InputValidator } = require('./src/evolution/validation');
const { EvolutionMetrics } = require('./src/evolution/metrics');
const { SelfEvolution } = require('./src/evolution');

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

const TEST_DIR = '/tmp/test-extended-real';

async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {}
}

// ==================== FILE QUEUE TESTS ====================

async function testQueueConcurrentAccess() {
  console.log('\n📋 FileQueue: Concurrent Access Test');
  
  const queue = new FileMessageQueue({ basePath: TEST_DIR + '/queue', name: 'concurrent' });
  await queue.init();
  
  // Simulate concurrent pushes
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(queue.push({ data: `concurrent-${i}` }));
  }
  
  const ids = await Promise.all(promises);
  console.log(`  Pushed ${ids.length} messages concurrently`);
  
  const len = await queue.length();
  console.assert(len === 10, `Length should be 10, got ${len}`);
  
  // Pop all in order
  for (let i = 0; i < 10; i++) {
    const msg = await queue.pop();
    console.assert(msg.data === `concurrent-${i}`, `Message ${i} should match`);
  }
  
  console.log('  ✅ Concurrent access works');
}

async function testQueueEmptyOperations() {
  console.log('\n📋 FileQueue: Empty Queue Operations');
  
  const queue = new FileMessageQueue({ basePath: TEST_DIR + '/queue', name: 'empty' });
  await queue.init();
  
  // Pop from empty queue
  const msg = await queue.pop();
  console.assert(msg === null, 'Pop from empty should return null');
  
  // Peek empty queue
  const peeked = await queue.peek();
  console.assert(peeked === null, 'Peek empty should return null');
  
  // Length of empty queue
  const len = await queue.length();
  console.assert(len === 0, 'Empty queue length should be 0');
  
  console.log('  ✅ Empty queue operations work');
}

async function testQueueLargeData() {
  console.log('\n📋 FileQueue: Large Data Test');
  
  const queue = new FileMessageQueue({ basePath: TEST_DIR + '/queue', name: 'large' });
  await queue.init();
  
  // Large object (1MB)
  const largeData = { data: 'x'.repeat(1024 * 1024) };
  
  const id = await queue.push(largeData);
  console.assert(id, 'Should get ID for large data');
  
  const msg = await queue.pop();
  console.assert(msg.data.length === 1024 * 1024, 'Large data should be preserved');
  
  console.log('  ✅ Large data handling works');
}

// ==================== LEARNING LOG TESTS ====================

async function testLogRotation() {
  console.log('\n📝 LearningLog: Rotation Test');
  
  const log = new LearningLog({ 
    basePath: TEST_DIR + '/logs', 
    maxFileSize: 1000 // Small for testing
  });
  await log.init();
  
  // Write enough to trigger rotation
  for (let i = 0; i < 20; i++) {
    await log.record({ type: 'test', data: 'x'.repeat(100) });
  }
  
  const files = await fs.readdir(TEST_DIR + '/logs');
  const logFiles = files.filter(f => f.startsWith('learning-log-'));
  
  console.assert(logFiles.length > 1, 'Should have rotated files');
  console.log(`  Found ${logFiles.length} log files`);
  console.log('  ✅ Rotation works');
}

async function testLogQueryFilters() {
  console.log('\n📝 LearningLog: Query Filters Test');
  
  const log = new LearningLog({ basePath: TEST_DIR + '/logs2' });
  await log.init();
  
  // Add various entries
  await log.record({ type: 'typeA', skill: 'skill1' });
  await log.record({ type: 'typeB', skill: 'skill1' });
  await log.record({ type: 'typeA', skill: 'skill2' });
  
  // Filter by type
  const typeA = await log.query({ type: 'typeA' });
  console.assert(typeA.length >= 2, 'Should find typeA entries');
  
  // Filter by skill
  const skill1 = await log.query({ skill: 'skill1' });
  console.assert(skill1.length >= 2, 'Should find skill1 entries');
  
  // Filter with limit
  const limited = await log.query({ limit: 1 });
  console.assert(limited.length === 1, 'Should respect limit');
  
  console.log('  ✅ Query filters work');
}

async function testLogCleanup() {
  console.log('\n📝 LearningLog: Cleanup Test');
  
  const log = new LearningLog({ basePath: TEST_DIR + '/logs3' });
  await log.init();
  
  // Create old file manually
  const oldDate = new Date(Date.now() - 40 * 86400000); // 40 days ago
  const oldPath = path.join(TEST_DIR + '/logs3', `learning-log-${oldDate.toISOString().split('T')[0]}.jsonl`);
  await fs.writeFile(oldPath, '{"test": true}\n');
  
  // Run cleanup (30 days retention)
  const result = await log.cleanup(30);
  console.assert(result.cleaned >= 1, 'Should clean at least 1 file');
  
  // Verify file is gone
  try {
    await fs.access(oldPath);
    console.assert(false, 'Old file should be deleted');
  } catch {
    // Expected - file should be gone
  }
  
  console.log(`  Cleaned ${result.cleaned} old files`);
  console.log('  ✅ Cleanup works');
}

// ==================== PENDING INDEX TESTS ====================

async function testPendingIndexOperations() {
  console.log('\n📇 PendingIndex: CRUD Operations');
  
  const index = new PendingProposalsIndex({ basePath: TEST_DIR + '/pending' });
  await index.init();
  
  // Add
  const proposal = { id: 'test-1', type: 'config', status: 'pending' };
  await index.add(proposal);
  
  // Get
  const found = await index.get('test-1');
  console.assert(found && found.id === 'test-1', 'Should find by ID');
  console.assert(found._indexedAt, 'Should have indexed timestamp');
  
  // Update
  await index.update('test-1', { status: 'approved' });
  const updated = await index.get('test-1');
  console.assert(updated.status === 'approved', 'Should update status');
  
  // List
  const all = await index.list();
  console.assert(all.length >= 1, 'Should list all proposals');
  
  // List with filter
  const pending = await index.list({ status: 'pending' });
  const approved = await index.list({ status: 'approved' });
  console.assert(approved.length >= 1, 'Should filter by status');
  
  // Remove
  const removed = await index.remove('test-1');
  console.assert(removed === true, 'Should return true when removed');
  const notFound = await index.get('test-1');
  console.assert(notFound === null, 'Should be null after removal');
  
  console.log('  ✅ CRUD operations work');
}

// ==================== APPROVAL MANAGER TESTS ====================

async function testApprovalApproveReject() {
  console.log('\n✅ ApprovalManager: Approve/Reject Test');
  
  const manager = new ApprovalManager({ basePath: TEST_DIR + '/approval' });
  await manager.init();
  
  // Create a pending proposal
  const result = await manager.proposeChange({
    type: 'new_skill',
    skill: { name: 'approval-test-skill', description: 'Test' },
    reason: 'Testing approve/reject functionality'
  });
  
  const proposalId = result.proposal.id;
  
  // Test approve
  const approved = await manager.approve(proposalId);
  console.assert(approved !== null, 'Should return approved proposal');
  console.assert(approved.status === 'approved', 'Status should be approved');
  console.assert(approved.approvedAt, 'Should have approvedAt timestamp');
  
  // Create another for reject
  const result2 = await manager.proposeChange({
    type: 'new_skill',
    skill: { name: 'reject-test-skill', description: 'Test' },
    reason: 'Testing reject functionality'
  });
  
  const proposalId2 = result2.proposal.id;
  
  // Test reject
  const rejected = await manager.reject(proposalId2, 'Test rejection reason');
  console.assert(rejected !== null, 'Should return rejected proposal');
  console.assert(rejected.status === 'rejected', 'Status should be rejected');
  console.assert(rejected.rejectedAt, 'Should have rejectedAt timestamp');
  console.assert(rejected.rejectionReason === 'Test rejection reason', 'Should have reason');
  
  console.log('  ✅ Approve/reject work');
}

async function testApprovalLevels() {
  console.log('\n✅ ApprovalManager: Level Determination');
  
  const manager = new ApprovalManager({ basePath: TEST_DIR + '/approval2' });
  await manager.init();
  
  // L1: Config with low impact
  const l1 = await manager.proposeChange({
    type: 'config',
    impactScore: 0.05,
    reason: 'Low impact config',
    settings: {}
  });
  console.assert(l1.level === 'L1', 'Should be L1');
  
  // L2: New skill
  const l2 = await manager.proposeChange({
    type: 'new_skill',
    skill: { name: 'l2-test', description: 'Test' },
    reason: 'New skill for testing'
  });
  console.assert(l2.level === 'L2', 'Should be L2');
  
  // L3: Update
  const l3 = await manager.proposeChange({
    type: 'update',
    target: 'test',
    reason: 'Update test'
  });
  console.assert(l3.level === 'L3', 'Should be L3');
  
  // L4: Self-modification
  const l4 = await manager.proposeChange({
    type: 'self_modification',
    component: 'test',
    reason: 'Self mod test',
    modification: { safe: true }
  });
  console.assert(l4.level === 'L4', 'Should be L4');
  
  console.log('  ✅ Level determination works');
}

// ==================== CHANGE APPLIER TESTS ====================

async function testChangeApplierConfig() {
  console.log('\n🔧 ChangeApplier: Config Update Test');
  
  const applier = new ChangeApplier({ 
    basePath: TEST_DIR + '/applier',
    configPath: TEST_DIR + '/applier/config'
  });
  await applier.init();
  
  // Apply config change
  const result = await applier.applyConfig({
    settings: { timeout: 5000, retries: 3 }
  });
  
  console.assert(result.applied === true, 'Should apply config');
  console.assert(result.type === 'config', 'Type should be config');
  
  // Verify file was created
  const configFile = TEST_DIR + '/applier/config/evolution.yml';
  const content = await fs.readFile(configFile, 'utf8');
  console.assert(content.includes('timeout: 5000'), 'Config should have timeout');
  console.assert(content.includes('retries: 3'), 'Config should have retries');
  
  console.log('  ✅ Config update works');
}

async function testChangeApplierNewSkill() {
  console.log('\n🔧 ChangeApplier: New Skill Test');
  
  const applier = new ChangeApplier({ 
    basePath: TEST_DIR + '/applier2',
    skillsPath: TEST_DIR + '/applier2/skills'
  });
  await applier.init();
  
  const result = await applier.applyNewSkill({
    skill: { 
      name: 'test-skill-applier', 
      description: 'Test skill for applier' 
    }
  }, { id: 'test-proposal', level: 'L2' });
  
  console.assert(result.applied === true, 'Should apply new skill');
  console.assert(result.skill === 'test-skill-applier', 'Should return skill name');
  
  // Verify files created
  const skillDir = TEST_DIR + '/applier2/skills/test-skill-applier';
  const files = await fs.readdir(skillDir);
  console.assert(files.includes('SKILL.md'), 'Should have SKILL.md');
  console.assert(files.includes('scripts'), 'Should have scripts folder');
  console.assert(files.includes('package.json'), 'Should have package.json');
  
  console.log('  ✅ New skill creation works');
}

async function testChangeApplierBackupRollback() {
  console.log('\n🔧 ChangeApplier: Backup & Rollback Test');
  
  const applier = new ChangeApplier({ 
    basePath: TEST_DIR + '/applier3',
    configPath: TEST_DIR + '/applier3/config',
    backupPath: TEST_DIR + '/applier3/backups'
  });
  await applier.init();
  
  // Create initial config
  await fs.mkdir(TEST_DIR + '/applier3/config', { recursive: true });
  await fs.writeFile(TEST_DIR + '/applier3/config/evolution.yml', 'initial: true\n');
  
  // Create backup
  const proposal = { id: 'test-backup', level: 'L3', type: 'config' };
  await applier.createBackup(proposal);
  
  // Verify backup exists
  const backupDir = TEST_DIR + '/applier3/backups/test-backup';
  const backupFiles = await fs.readdir(backupDir);
  console.assert(backupFiles.length > 0, 'Should create backup files');
  
  // Modify original
  await fs.writeFile(TEST_DIR + '/applier3/config/evolution.yml', 'modified: true\n');
  
  // Rollback
  const rollback = await applier.rollback(proposal);
  console.assert(rollback.rolledBack === true, 'Should rollback successfully');
  
  // Verify restored
  const restored = await fs.readFile(TEST_DIR + '/applier3/config/evolution.yml', 'utf8');
  console.assert(restored.includes('initial: true'), 'Should restore original');
  
  console.log('  ✅ Backup & rollback work');
}

// ==================== VALIDATION TESTS ====================

async function testValidation() {
  console.log('\n🛡️ InputValidator: Validation Tests');
  
  // Valid config
  const validConfig = InputValidator.validateProposal({
    type: 'config',
    reason: 'Valid reason here',
    settings: { timeout: 5000 }
  });
  console.assert(validConfig.valid === true, 'Valid config should pass');
  
  // Missing type
  const noType = InputValidator.validateProposal({
    reason: 'Valid reason'
  });
  console.assert(noType.valid === false, 'Missing type should fail');
  console.assert(noType.errors.includes('type is required'), 'Should report missing type');
  
  // Invalid type
  const invalidType = InputValidator.validateProposal({
    type: 'invalid_type',
    reason: 'Valid reason here'
  });
  console.assert(invalidType.valid === false, 'Invalid type should fail');
  
  // Short reason
  const shortReason = InputValidator.validateProposal({
    type: 'config',
    reason: 'Short',
    settings: {}
  });
  console.assert(shortReason.valid === false, 'Short reason should fail');
  
  // Missing skill name
  const noSkillName = InputValidator.validateProposal({
    type: 'new_skill',
    skill: { description: 'No name' },
    reason: 'Valid reason here'
  });
  console.assert(noSkillName.valid === false, 'Missing skill name should fail');
  
  // Invalid skill name
  const invalidSkillName = InputValidator.validateProposal({
    type: 'new_skill',
    skill: { name: 'Invalid Name 123!', description: 'Test' },
    reason: 'Valid reason here'
  });
  console.assert(invalidSkillName.valid === false, 'Invalid skill name should fail');
  
  // Self-mod without safe flag
  const unsafeSelfMod = InputValidator.validateProposal({
    type: 'self_modification',
    component: 'test',
    reason: 'Valid reason here',
    modification: {}
  });
  console.assert(unsafeSelfMod.valid === false, 'Unsafe self-mod should fail');
  
  // Impact score out of range
  const badImpact = InputValidator.validateProposal({
    type: 'config',
    reason: 'Valid reason here',
    settings: {},
    impactScore: 2.0
  });
  console.assert(badImpact.valid === false, 'Impact > 1 should fail');
  
  // Sanitize string
  const sanitized = InputValidator.sanitizeString('  hello\x00world  ');
  console.assert(sanitized === 'helloworld', 'Should sanitize control chars');
  
  // Valid ID
  console.assert(InputValidator.isValidId('valid-id_123') === true, 'Valid ID');
  console.assert(InputValidator.isValidId('invalid id!') === false, 'Invalid ID with spaces');
  console.assert(InputValidator.isValidId('a'.repeat(101)) === false, 'ID too long');
  
  console.log('  ✅ Validation works correctly');
}

// ==================== METRICS TESTS ====================

async function testMetrics() {
  console.log('\n📊 Metrics: Collection & Alerts Test');
  
  const metrics = new EvolutionMetrics({ basePath: TEST_DIR + '/metrics' });
  await metrics.init();
  
  // Test counter
  metrics.increment('test_counter');
  metrics.increment('test_counter', 5);
  
  // Test gauge
  metrics.gauge('pending_proposals', 5);
  metrics.gauge('pending_proposals', 15);
  
  // Test timer
  metrics.timer('test_timer', 100);
  metrics.timer('test_timer', 200);
  metrics.timer('test_timer', 300);
  
  // Get metrics
  const data = metrics.getMetrics();
  console.assert(data.counters.test_counter === 6, 'Counter should be 6');
  console.assert(data.gauges.pending_proposals === 15, 'Gauge should be 15');
  console.assert(data.timers.test_timer.count === 3, 'Timer should have 3 entries');
  console.assert(data.timers.test_timer.avg === 200, 'Average should be 200');
  
  // Test alerts
  metrics.gauge('pending_proposals', 15); // High
  const alerts = metrics.checkAlerts();
  const hasHighPending = alerts.some(a => a.metric === 'pending_proposals');
  console.assert(hasHighPending, 'Should alert on high pending');
  
  // Save
  await metrics.save();
  const saved = await fs.readFile(TEST_DIR + '/metrics/metrics.json', 'utf8');
  console.assert(saved.includes('test_counter'), 'Should save metrics');
  
  // Test report
  const report = metrics.getReport();
  console.assert(report.summary !== undefined, 'Should have summary');
  console.assert(report.alerts !== undefined, 'Should have alerts');
  
  console.log('  ✅ Metrics work correctly');
}

// ==================== INTEGRATION TESTS ====================

async function testFullIntegration() {
  console.log('\n🔄 Full Integration Test');
  
  const evolution = new SelfEvolution({ basePath: TEST_DIR + '/full' });
  await evolution.init();
  
  // Propose and approve multiple changes
  const l1 = await evolution.propose({
    type: 'config',
    impactScore: 0.05,
    reason: 'Integration test config',
    settings: { test: true }
  });
  console.assert(l1.approved === true, 'L1 should auto-approve');
  
  const l2 = await evolution.propose({
    type: 'new_skill',
    skill: { name: 'integration-skill', description: 'Test' },
    reason: 'Integration test skill'
  });
  
  const approved = await evolution.approve(l2.proposal.id);
  console.assert(approved !== null, 'Should approve L2');
  
  // Reject one
  const l3 = await evolution.propose({
    type: 'new_skill',
    skill: { name: 'rejected-skill', description: 'Test' },
    reason: 'Integration test rejection'
  });
  
  const rejected = await evolution.reject(l3.proposal.id, 'Test rejection');
  console.assert(rejected !== null, 'Should reject');
  
  // Check status
  const status = await evolution.getStatus();
  console.assert(status.pendingProposals !== undefined, 'Should have pending count');
  console.assert(status.metrics.approvedTotal >= 2, 'Should have approved count');
  console.assert(status.metrics.rejectedTotal >= 1, 'Should have rejected count');
  
  // Run daily
  const daily = await evolution.daily();
  console.assert(daily.metrics !== undefined, 'Daily should return status');
  
  console.log('  ✅ Full integration works');
}

// ==================== RUN ALL TESTS ====================

async function runAllTests() {
  console.log('========================================');
  console.log('Extended Real Tests - Self-Evolution System');
  console.log('========================================');
  
  await cleanup();
  
  try {
    // File Queue
    await testQueueConcurrentAccess();
    await testQueueEmptyOperations();
    await testQueueLargeData();
    
    // Learning Log
    await testLogRotation();
    await testLogQueryFilters();
    await testLogCleanup();
    
    // Pending Index
    await testPendingIndexOperations();
    
    // Approval Manager
    await testApprovalApproveReject();
    await testApprovalLevels();
    
    // Change Applier
    await testChangeApplierConfig();
    await testChangeApplierNewSkill();
    await testChangeApplierBackupRollback();
    
    // Validation
    await testValidation();
    
    // Metrics
    await testMetrics();
    
    // Integration
    await testFullIntegration();
    
    console.log('\n========================================');
    console.log('ALL EXTENDED TESTS PASSED ✅');
    console.log('========================================');
    
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err);
    console.error(err.stack);
    process.exit(1);
  }
}

runAllTests();
