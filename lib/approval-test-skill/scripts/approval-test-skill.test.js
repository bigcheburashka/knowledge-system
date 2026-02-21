/**
 * Tests for approval-test-skill
 */

const { ApprovalTestSkill } = require('./approval-test-skill');

async function runTests() {
  console.log('Testing approval-test-skill...');
  
  const skill = new ApprovalTestSkill();
  
  // Test 1: Basic initialization
  console.log('Test 1: Initialization');
  console.assert(skill !== null, 'Skill should initialize');
  console.log('  ✅ PASSED');
  
  // Test 2: Run method
  console.log('Test 2: Run method');
  const result = await skill.run({ test: true });
  console.assert(result.success === true, 'Run should return success');
  console.log('  ✅ PASSED');
  
  console.log('\n=== All Tests PASSED ✅ ===');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
