const { FileQueue } = require('../scripts/file-queue');
const fs = require('fs').promises;
const path = require('path');

async function cleanup() {
  const basePath = '/tmp/test-queues';
  try {
    await fs.rm(basePath, { recursive: true, force: true });
  } catch {}
}

async function testPushPop() {
  console.log('Test: Push and Pop');
  
  const queue = new FileQueue('test-push-pop', '/tmp/test-queues');
  await queue.init();
  
  // Push messages
  const id1 = await queue.push({ type: 'A', data: 'first' });
  const id2 = await queue.push({ type: 'B', data: 'second' });
  
  console.log('  Pushed:', id1, id2);
  
  // Check length
  const len = await queue.length();
  console.assert(len === 2, `Expected length 2, got ${len}`);
  console.log('  ✓ Length correct:', len);
  
  // Pop first
  const msg1 = await queue.pop();
  console.assert(msg1.type === 'A', 'Expected type A');
  console.log('  ✓ Pop correct:', msg1.data);
  
  // Check length after pop
  const len2 = await queue.length();
  console.assert(len2 === 1, `Expected length 1, got ${len2}`);
  console.log('  ✓ Length after pop:', len2);
  
  console.log('  ✅ PASSED\n');
}

async function testRecover() {
  console.log('Test: Crash Recovery');
  
  const queueName = 'test-recover';
  const basePath = '/tmp/test-queues';
  const queue = new FileQueue(queueName, basePath);
  
  // Push messages
  await queue.push({ type: 'RECOVER', data: 'msg1' });
  await queue.push({ type: 'RECOVER', data: 'msg2' });
  
  console.log('  Pushed 2 messages');
  
  // Simulate crash: clear queue but keep WAL
  const queuePath = path.join(basePath, `${queueName}.jsonl`);
  await fs.writeFile(queuePath, '');
  
  console.log('  Simulated crash (queue cleared)');
  
  // Recover
  const result = await queue.recover();
  console.log('  Recovered:', result.recovered, 'messages');
  
  // Check messages restored
  const len = await queue.length();
  console.assert(len === 2, `Expected 2 messages after recover, got ${len}`);
  console.log('  ✓ Messages restored:', len);
  
  // Pop and verify
  const msg = await queue.pop();
  console.assert(msg.data === 'msg1', 'Expected msg1');
  console.log('  ✓ First message correct');
  
  console.log('  ✅ PASSED\n');
}

async function testDurability() {
  console.log('Test: WAL Durability');
  
  const queue = new FileQueue('test-durability', '/tmp/test-queues');
  
  // Push without reading (WAL should have entry)
  await queue.push({ type: 'DURABLE', data: 'important' });
  
  // Check WAL exists
  const walPath = path.join('/tmp/test-queues', 'test-durability.wal');
  const walContent = await fs.readFile(walPath, 'utf8');
  console.assert(walContent.includes('DURABLE'), 'WAL should contain message');
  console.log('  ✓ WAL written');
  
  // Recover should clear WAL
  await queue.recover();
  const walAfter = await fs.readFile(walPath, 'utf8');
  console.assert(walAfter === '', 'WAL should be cleared after recover');
  console.log('  ✓ WAL cleared after recover');
  
  console.log('  ✅ PASSED\n');
}

async function testEmptyQueue() {
  console.log('Test: Empty Queue');
  
  const queue = new FileQueue('test-empty', '/tmp/test-queues');
  
  const msg = await queue.pop();
  console.assert(msg === null, 'Expected null from empty queue');
  console.log('  ✓ Pop from empty returns null');
  
  const len = await queue.length();
  console.assert(len === 0, 'Expected length 0');
  console.log('  ✓ Length is 0');
  
  console.log('  ✅ PASSED\n');
}

async function runAllTests() {
  console.log('=== FileQueue Tests ===\n');
  
  await cleanup();
  
  try {
    await testPushPop();
    await testRecover();
    await testDurability();
    await testEmptyQueue();
    
    console.log('=== All Tests PASSED ✅ ===');
    process.exit(0);
  } catch (err) {
    console.error('Test FAILED ❌:', err);
    process.exit(1);
  }
}

runAllTests();
