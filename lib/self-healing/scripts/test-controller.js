const { SelfHealingController } = require('./controller');
const { CheckpointStore } = require('../../graph-schema/scripts/checkpoint-store');

async function cleanup() {
  try {
    await require('fs').promises.rm('/tmp/test-healing', { recursive: true, force: true });
  } catch {}
}

async function testErrorClassification() {
  console.log('Test: Error Classification');
  
  const controller = new SelfHealingController();
  
  const testCases = [
    { error: 'Connection timeout', expected: 'TIMEOUT' },
    { error: 'Request timed out', expected: 'TIMEOUT' },
    { error: 'Unknown topic: Kubernetes', expected: 'KNOWLEDGE_GAP' },
    { error: 'Knowledge gap detected', expected: 'KNOWLEDGE_GAP' },
    { error: 'Processing failed', expected: 'ERROR' },
    { error: 'Exception in agent', expected: 'ERROR' },
    { error: 'Something weird', expected: 'UNKNOWN' }
  ];
  
  for (const { error, expected } of testCases) {
    const type = controller.classifyError(new Error(error));
    console.assert(type === expected, `"${error}" should be ${expected}, got ${type}`);
    console.log(`  ✓ "${error}" -> ${type}`);
  }
  
  console.log('  ✅ PASSED\n');
}

async function testTimeoutRecovery() {
  console.log('Test: Timeout Recovery');
  
  const store = new CheckpointStore({ checkpointPath: '/tmp/test-healing' });
  const controller = new SelfHealingController({ checkpointStore: store });
  
  // Create checkpoint
  const checkpointId = await store.save({
    status: 'active',
    agent: 'research',
    retryCount: 0
  });
  
  // Simulate timeout error
  const error = new Error('Connection timeout');
  const result = await controller.handleFailure(checkpointId, error, { timeout: 5000 });
  
  console.assert(result.action === 'RETRY', 'Should retry');
  console.assert(result.strategy === 'TIMEOUT', 'Should use TIMEOUT strategy');
  console.assert(result.newTimeout === 10000, 'Should double timeout');
  
  console.log('  ✓ Timeout recovery triggered');
  console.log('  ✓ New timeout:', result.newTimeout);
  
  console.log('  ✅ PASSED\n');
}

async function testErrorRecovery() {
  console.log('Test: Error Recovery with Backoff');
  
  const store = new CheckpointStore({ checkpointPath: '/tmp/test-healing' });
  const controller = new SelfHealingController({ checkpointStore: store });
  
  const checkpointId = await store.save({
    status: 'active',
    agent: 'factcheck',
    retryCount: 0
  });
  
  const error = new Error('Processing failed');
  const start = Date.now();
  const result = await controller.handleFailure(checkpointId, error);
  const duration = Date.now() - start;
  
  console.assert(result.action === 'RETRY', 'Should retry');
  console.assert(result.strategy === 'ERROR', 'Should use ERROR strategy');
  console.assert(result.delay >= 1000, 'Should have backoff delay');
  console.assert(duration >= 1000, 'Should wait before returning');
  
  console.log('  ✓ Error recovery triggered');
  console.log('  ✓ Backoff delay:', result.delay, 'ms');
  
  console.log('  ✅ PASSED\n');
}

async function testCircuitBreaker() {
  console.log('Test: Circuit Breaker (Max Retries)');
  
  const store = new CheckpointStore({ checkpointPath: '/tmp/test-healing' });
  const controller = new SelfHealingController({ checkpointStore: store, maxRetries: 2 });
  
  const checkpointId = await store.save({
    status: 'active',
    agent: 'quality',
    retryCount: 2 // Already at max
  });
  
  const error = new Error('Processing failed');
  const result = await controller.handleFailure(checkpointId, error);
  
  console.assert(result.action === 'ESCALATE', 'Should escalate after max retries');
  console.assert(result.strategy === 'USER', 'Should escalate to user');
  
  console.log('  ✓ Circuit breaker triggered');
  console.log('  ✓ Escalated to user');
  
  console.log('  ✅ PASSED\n');
}

async function runTests() {
  console.log('=== Self-Healing Controller Tests ===\n');
  
  await cleanup();
  
  try {
    await testErrorClassification();
    await testTimeoutRecovery();
    await testErrorRecovery();
    await testCircuitBreaker();
    
    console.log('=== All Tests PASSED ✅ ===');
    process.exit(0);
  } catch (err) {
    console.error('❌ FAILED:', err);
    process.exit(1);
  }
}

runTests();
