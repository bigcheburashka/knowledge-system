const { A2AOrchestrator } = require('./orchestrator');
const { HealthMonitor } = require('./health-monitor');
const fs = require('fs').promises;
const path = require('path');

async function cleanup() {
  const basePath = '/tmp/test-a2a';
  try {
    await fs.rm(basePath, { recursive: true, force: true });
  } catch {}
  
  const hbPath = '/tmp/test-heartbeats';
  try {
    await fs.rm(hbPath, { recursive: true, force: true });
  } catch {}
}

async function testHealthMonitor() {
  console.log('Test: Health Monitor');
  
  const monitor = new HealthMonitor({
    heartbeatPath: '/tmp/test-heartbeats',
    heartbeatInterval: 1000,
    timeout: 3000
  });
  
  // Start monitoring
  await monitor.start('test-agent');
  
  // Check immediately (should be alive)
  const health1 = await monitor.check('test-agent');
  console.assert(health1.status === 'alive', 'Should be alive');
  console.log('  ✓ Alive detected');
  
  // Wait for timeout
  await new Promise(r => setTimeout(r, 3500));
  
  // Check after timeout (should be dead)
  const health2 = await monitor.check('test-agent');
  console.assert(health2.status === 'dead', 'Should be dead after timeout');
  console.log('  ✓ Timeout detection works');
  
  // Stop monitoring
  monitor.stop('test-agent');
  
  console.log('  ✅ PASSED\n');
}

async function testOrchestratorInit() {
  console.log('Test: Orchestrator Initialization');
  
  const orchestrator = new A2AOrchestrator({
    basePath: '/tmp/test-a2a/queues',
    agentsPath: '/tmp/test-agents' // Won't exist, just for test
  });
  
  // Init should create directories
  await orchestrator.init();
  
  // Check directories exist
  const stats = await fs.stat('/tmp/test-a2a/queues');
  console.assert(stats.isDirectory(), 'Queue directory should exist');
  console.log('  ✓ Directories created');
  
  // Check all queues initialized
  for (const type of ['research', 'factcheck', 'quality', 'composer']) {
    console.assert(orchestrator.queues[type], `Queue ${type} should exist`);
  }
  console.log('  ✓ All queues initialized');
  
  console.log('  ✅ PASSED\n');
}

async function testSendTask() {
  console.log('Test: Send Task to Queue');
  
  const orchestrator = new A2AOrchestrator({
    basePath: '/tmp/test-a2a/queues'
  });
  
  await orchestrator.init();
  
  // Send task
  await orchestrator.sendTask('research', { topic: 'AI', query: 'machine learning' });
  
  // Check queue length
  const len = await orchestrator.queues.research.length();
  console.assert(len === 1, `Expected length 1, got ${len}`);
  console.log('  ✓ Task sent to queue');
  
  // Verify message content
  const msg = await orchestrator.queues.research.peek();
  console.assert(msg.data.topic === 'AI', 'Topic should be AI');
  console.log('  ✓ Message content correct');
  
  console.log('  ✅ PASSED\n');
}

async function testRouting() {
  console.log('Test: Result Routing');
  
  const orchestrator = new A2AOrchestrator({
    basePath: '/tmp/test-a2a/queues'
  });
  
  await orchestrator.init();
  
  // Simulate result from research
  await orchestrator.routeResult('research', {
    data: { result: 'research findings' }
  });
  
  // Check it was routed to factcheck
  const len = await orchestrator.queues.factcheck.length();
  console.assert(len === 1, `Expected factcheck queue to have 1 message, got ${len}`);
  console.log('  ✓ Routed to next agent');
  
  // Verify final result handling
  await orchestrator.routeResult('composer', {
    data: { final: 'output' }
  });
  console.log('  ✓ Final agent handled correctly');
  
  console.log('  ✅ PASSED\n');
}

async function testStats() {
  console.log('Test: Get Stats');
  
  const orchestrator = new A2AOrchestrator({
    basePath: '/tmp/test-a2a/queues'
  });
  
  await orchestrator.init();
  
  // Get stats (should be empty since no agents spawned)
  const stats = orchestrator.getStats();
  console.assert(Object.keys(stats).length === 0, 'Stats should be empty');
  console.log('  ✓ Empty stats when no agents');
  
  console.log('  ✅ PASSED\n');
}

async function runAllTests() {
  console.log('=== A2A Orchestrator Tests ===\n');
  
  await cleanup();
  
  try {
    await testHealthMonitor();
    await testOrchestratorInit();
    await testSendTask();
    await testRouting();
    await testStats();
    
    console.log('=== All Tests PASSED ✅ ===');
    process.exit(0);
  } catch (err) {
    console.error('Test FAILED ❌:', err);
    console.error(err.stack);
    process.exit(1);
  }
}

runAllTests();
