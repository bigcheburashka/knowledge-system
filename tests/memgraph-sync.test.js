/**
 * Tests for MemgraphSync Worker
 */

const { MemgraphSyncWorker } = require('../src/evolution/memgraph-sync');
const fs = require('fs').promises;
const path = require('path');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    return false;
  }
}

async function runTests() {
  console.log('\n=== MemgraphSync Worker Tests ===\n');
  
  const basePath = '/tmp/test-memgraph-sync-' + Date.now();
  let worker;
  let passed = 0;
  let failed = 0;
  
  // Setup
  try {
    await fs.mkdir(basePath, { recursive: true });
    await fs.mkdir(path.join(basePath, 'queue'), { recursive: true });
    await fs.mkdir(path.join(basePath, 'logs'), { recursive: true });
    
    worker = new MemgraphSyncWorker({ basePath });
    await worker.init();
  } catch (err) {
    console.error('Setup failed:', err);
    process.exit(1);
  }
  
  // Test 1: Initialize
  if (await test('Initialize worker', async () => {
    if (!worker.queue) throw new Error('Queue not initialized');
    if (!worker.log) throw new Error('Log not initialized');
  })) passed++; else failed++;
  
  // Test 2: Add sync task
  if (await test('Add sync task to queue', async () => {
    await worker.addSyncTask({
      name: 'TestEntity',
      type: 'technology',
      description: 'Test description',
      related: ['Related1', 'Related2'],
      bestPractices: ['Practice 1'],
      commonMistakes: ['Mistake 1']
    }, 'CREATE');
    
    const task = await worker.queue.peek();
    if (!task) throw new Error('Task not added');
    if (task.type !== 'MEMGRAPH_SYNC') throw new Error('Wrong task type');
  })) passed++; else failed++;
  
  // Test 3: Audit logging
  if (await test('Write audit log', async () => {
    await worker.audit('TEST_ACTION', { test: true });
    
    const auditContent = await fs.readFile(worker.auditLog, 'utf8');
    const entries = auditContent.trim().split('\n');
    const lastEntry = JSON.parse(entries[entries.length - 1]);
    
    if (lastEntry.action !== 'TEST_ACTION') throw new Error('Audit not written');
  })) passed++; else failed++;
  
  // Test 4: Task structure
  if (await test('Task has correct structure', async () => {
    await worker.addSyncTask({ name: 'Test2', type: 'technology' }, 'CREATE');
    const task = await worker.queue.pop();
    
    if (!task.entity) throw new Error('Missing entity');
    if (!task.operation) throw new Error('Missing operation');
    if (!task.timestamp) throw new Error('Missing timestamp');
  })) passed++; else failed++;
  
  // Test 5: Retry logic
  if (await test('Retry configuration', async () => {
    if (worker.maxRetries !== 3) throw new Error('Wrong maxRetries');
    if (worker.retryDelay !== 5000) throw new Error('Wrong retryDelay');
  })) passed++; else failed++;
  
  // Test 6: Consistency check (without actual DB)
  if (await test('Consistency check structure', async () => {
    // This will fail to connect but should return structure
    const result = await worker.checkConsistency();
    
    if (typeof result.qdrantCount !== 'number') throw new Error('Missing qdrantCount');
    if (typeof result.memgraphCount !== 'number') throw new Error('Missing memgraphCount');
    if (typeof result.diff !== 'number') throw new Error('Missing diff');
  })) passed++; else failed++;
  
  // Cleanup
  try {
    await fs.rm(basePath, { recursive: true, force: true });
  } catch {}
  
  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
