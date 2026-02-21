const { CheckpointStore } = require('./checkpoint-store');
const fs = require('fs').promises;

async function cleanup() {
  try {
    await fs.rm('/tmp/test-checkpoints', { recursive: true, force: true });
  } catch {}
}

async function testCheckpointSave() {
  console.log('Test: Checkpoint Save');
  
  const store = new CheckpointStore({ checkpointPath: '/tmp/test-checkpoints' });
  
  const checkpoint = {
    status: 'active',
    agent: 'research',
    data: { topic: 'AI' }
  };
  
  const id = await store.save(checkpoint);
  console.log('  Saved:', id);
  
  const loaded = await store.load(id);
  console.assert(loaded.status === 'active', 'Status should be preserved');
  console.assert(loaded.agent === 'research', 'Agent should be preserved');
  
  console.log('  ✅ PASSED\n');
}

async function testCheckpointList() {
  console.log('Test: Checkpoint List');
  
  const store = new CheckpointStore({ checkpointPath: '/tmp/test-checkpoints' });
  
  // Save multiple
  await store.save({ status: 'active', agent: 'research' });
  await store.save({ status: 'completed', agent: 'composer' });
  
  const list = await store.list();
  console.assert(list.length >= 2, 'Should have multiple checkpoints');
  
  console.log('  Found', list.length, 'checkpoints');
  console.log('  ✅ PASSED\n');
}

async function runTests() {
  console.log('=== Checkpoint Store Tests ===\n');
  
  await cleanup();
  
  try {
    await testCheckpointSave();
    await testCheckpointList();
    
    console.log('=== All Tests PASSED ✅ ===');
  } catch (err) {
    console.error('❌ FAILED:', err);
    process.exit(1);
  }
}

runTests();
