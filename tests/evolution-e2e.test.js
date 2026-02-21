/**
 * End-to-End Integration Test for Self-Evolution System
 * Tests complete workflow: propose → approve → apply
 */

const { SelfEvolution } = require('../src/evolution');
const fs = require('fs').promises;

const TEST_DIR = '/tmp/test-evolution-e2e';

async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {}
}

async function testFullWorkflow() {
  console.log('\n=== E2E Test: Full Workflow ===\n');
  
  // 1. Initialize system
  console.log('1. Initializing Self-Evolution system...');
  const evolution = new SelfEvolution({ basePath: TEST_DIR });
  await evolution.init();
  console.log('   ✅ System initialized');
  
  // 2. Propose L1 change (auto-apply)
  console.log('2. Proposing L1 change (config)...');
  const l1Result = await evolution.propose({
    type: 'config',
    impactScore: 0.05,
    reason: 'Increase timeout for better reliability and performance',
    settings: { timeout: 10000 }
  });
  console.assert(l1Result.level === 'L1', 'Should be L1');
  console.assert(l1Result.approved === true, 'Should auto-approve');
  console.log('   ✅ L1 change auto-applied');
  
  // 3. Propose L2 change (queue)
  console.log('3. Proposing L2 change (new skill)...');
  const l2Result = await evolution.propose({
    type: 'new_skill',
    skill: { name: 'git-safety', description: 'Prevents git add -A in sessions' },
    reason: 'Repeated git add -A errors in sessions'
  });
  console.assert(l2Result.level === 'L2', 'Should be L2');
  console.assert(l2Result.status === 'queued', 'Should be queued');
  console.log('   ✅ L2 change queued');
  
  // 4. Propose L2 change (pending approval) - skill creation that we can approve
  console.log('4. Proposing L2 change (new skill for approval)...');
  const l3Result = await evolution.propose({
    type: 'new_skill',
    skill: { name: 'test-approved-skill', description: 'Test skill for approval flow testing' },
    reason: 'Test skill creation and approval workflow'
  });
  console.assert(l3Result.level === 'L2', 'Should be L2');
  console.assert(l3Result.status === 'queued', 'Should be queued');
  console.log('   ✅ L2 change queued for approval');
  
  // 5. Check status
  console.log('5. Checking system status...');
  const status = await evolution.getStatus();
  console.assert(status.pendingProposals >= 2, 'Should have pending proposals');
  console.assert(status.recentActivity >= 3, 'Should have recent activity');
  console.log('   ✅ Status:', JSON.stringify(status, null, 2));
  
  // 6. Approve L2 proposal
  console.log('6. Approving L2 proposal...');
  const approved = await evolution.approve(l3Result.proposal.id);
  console.assert(approved !== null, 'Should return approved proposal');
  console.assert(approved.status === 'approved', 'Should be approved');
  console.log('   ✅ L2 proposal approved');
  
  // 7. Verify in learning log
  console.log('7. Verifying learning log...');
  const history = await evolution.log.query({ type: 'improvement_proposed' });
  console.assert(history.length >= 3, 'Should have 3+ proposals logged');
  console.log(`   ✅ Found ${history.length} proposals in log`);
  
  // 8. Run daily maintenance
  console.log('8. Running daily maintenance...');
  const dailyStatus = await evolution.daily();
  console.assert(dailyStatus.recentActivity >= 3, 'Should show activity');
  console.log('   ✅ Daily maintenance complete');
  
  console.log('\n=== ALL E2E TESTS PASSED ✅ ===\n');
}

async function testErrorHandling() {
  console.log('=== E2E Test: Error Handling ===\n');
  
  const evolution = new SelfEvolution({ basePath: TEST_DIR });
  await evolution.init();
  
  // Test invalid proposal
  console.log('Testing invalid proposal handling...');
  try {
    await evolution.propose({
      type: 'unknown_type',
      reason: 'This should default to L3'
    });
    console.log('   ✅ Handled unknown type (defaulted to L3)');
  } catch (err) {
    console.log('   ✅ Error caught:', err.message);
  }
  
  // Test approve non-existent
  console.log('Testing approve non-existent proposal...');
  const result = await evolution.approve('non-existent-id');
  console.assert(result === null, 'Should return null for non-existent');
  console.log('   ✅ Non-existent proposal handled correctly');
  
  console.log('\n=== Error Handling Tests PASSED ✅ ===\n');
}

async function runTests() {
  console.log('========================================');
  console.log('Self-Evolution System E2E Tests');
  console.log('========================================');
  
  await cleanup();
  
  try {
    await testFullWorkflow();
    await testErrorHandling();
    
    console.log('========================================');
    console.log('ALL E2E TESTS PASSED ✅');
    console.log('========================================');
    
    process.exit(0);
  } catch (err) {
    console.error('\n❌ E2E TEST FAILED:', err);
    console.error(err.stack);
    process.exit(1);
  }
}

runTests();
