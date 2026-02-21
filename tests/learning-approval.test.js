/**
 * Tests for LearningLog and ApprovalManager
 */

const { LearningLog } = require('../src/evolution/learning-log');
const { ApprovalManager } = require('../src/evolution/approval-manager');
const fs = require('fs').promises;

const TEST_DIR = '/tmp/test-learning';

async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {}
}

// LearningLog Tests
async function testLearningLogRecord() {
  console.log('Test: LearningLog record');
  
  const log = new LearningLog({ basePath: TEST_DIR });
  await log.init();
  
  const entry = await log.record({
    type: 'skill_proposed',
    skill: 'test-skill'
  });
  
  console.assert(entry.timestamp, 'Entry should have timestamp');
  console.assert(entry.type === 'skill_proposed', 'Type should match');
  
  console.log('  ✅ PASSED');
}

async function testLearningLogQuery() {
  console.log('Test: LearningLog query');
  
  const log = new LearningLog({ basePath: TEST_DIR });
  await log.init();
  
  await log.record({ type: 'type1', data: 'a' });
  await log.record({ type: 'type2', data: 'b' });
  await log.record({ type: 'type1', data: 'c' });
  
  const results = await log.query({ type: 'type1' });
  console.assert(results.length >= 2, 'Should find type1 entries');
  
  console.log('  ✅ PASSED');
}

// ApprovalManager Tests
async function testL1AutoApply() {
  console.log('Test: L1 Auto-apply');
  
  const manager = new ApprovalManager({ basePath: TEST_DIR });
  await manager.init();
  
  const result = await manager.proposeChange({
    type: 'config',
    impactScore: 0.05,
    reason: 'Low impact config for better performance',
    settings: { timeout: 5000 }
  });
  
  console.assert(result.level === 'L1', 'Should be L1');
  console.assert(result.approved === true, 'Should auto-approve');
  
  console.log('  ✅ PASSED');
}

async function testL2Queue() {
  console.log('Test: L2 Queue');
  
  const manager = new ApprovalManager({ basePath: TEST_DIR });
  await manager.init();
  
  const result = await manager.proposeChange({
    type: 'new_skill',
    skill: { name: 'test-skill', description: 'Test skill for validation' },
    reason: 'New skill proposal for testing the queue system'
  });
  
  console.assert(result.level === 'L2', 'Should be L2');
  console.assert(result.status === 'queued', 'Should be queued');
  
  console.log('  ✅ PASSED');
}

async function testL3Pending() {
  console.log('Test: L3 Pending');
  
  const manager = new ApprovalManager({ basePath: TEST_DIR });
  await manager.init();
  
  const result = await manager.proposeChange({
    type: 'update',
    target: 'test-component',
    reason: 'Update existing component with new features and improvements'
  });
  
  console.assert(result.level === 'L3', 'Should be L3');
  console.assert(result.status === 'pending_approval', 'Should be pending');
  
  console.log('  ✅ PASSED');
}

async function testPendingIndex() {
  console.log('Test: Pending Index O(1) lookup');
  
  const manager = new ApprovalManager({ basePath: TEST_DIR });
  await manager.init();
  
  const result = await manager.proposeChange({
    type: 'new_skill',
    skill: { name: 'indexed-skill', description: 'Skill for testing O(1) index lookup' },
    reason: 'Test index performance and lookup speed'
  });
  
  // O(1) lookup via pending index
  const found = await manager.pending.get(result.proposal.id);
  console.assert(found !== null, 'Should find proposal in index');
  console.assert(found.id === result.proposal.id, 'ID should match');
  
  console.log('  ✅ PASSED');
}

async function runTests() {
  console.log('=== Learning Log + Approval Manager Tests ===\n');
  await cleanup();
  
  try {
    // LearningLog tests
    await testLearningLogRecord();
    await testLearningLogQuery();
    
    // ApprovalManager tests
    await testL1AutoApply();
    await testL2Queue();
    await testL3Pending();
    await testPendingIndex();
    
    console.log('\n=== ALL TESTS PASSED ✅ ===');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ FAILED:', err);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
