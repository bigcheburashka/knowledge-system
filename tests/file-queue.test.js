/**
 * Tests for FileMessageQueue
 */

const { FileMessageQueue } = require('../src/evolution/queue/file-queue');
const fs = require('fs').promises;
const path = require('path');

const TEST_DIR = '/tmp/test-file-queue';

async function cleanup() {
  try {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  } catch {}
}

async function testPushPop() {
  console.log('Test: Push and Pop');
  
  const queue = new FileMessageQueue({ basePath: TEST_DIR, name: 'test' });
  await queue.init();
  
  await queue.push({ type: 'TEST', data: 'message1' });
  await queue.push({ type: 'TEST', data: 'message2' });
  
  const len1 = await queue.length();
  console.assert(len1 === 2, `Length should be 2, got ${len1}`);
  
  const msg1 = await queue.pop();
  console.assert(msg1.data === 'message1', 'First message should be message1');
  console.assert(msg1._id, 'Message should have _id');
  console.assert(msg1._timestamp, 'Message should have _timestamp');
  
  const msg2 = await queue.pop();
  console.assert(msg2.data === 'message2', 'Second message should be message2');
  
  const len2 = await queue.length();
  console.assert(len2 === 0, 'Queue should be empty');
  
  console.log('  ✅ PASSED');
}

async function testPeek() {
  console.log('Test: Peek');
  
  const queue = new FileMessageQueue({ basePath: TEST_DIR, name: 'peek' });
  await queue.init();
  
  await queue.push({ data: 'peek-test' });
  
  const peeked = await queue.peek();
  console.assert(peeked.data === 'peek-test', 'Peek should return first message');
  
  const len = await queue.length();
  console.assert(len === 1, 'Queue should still have 1 message after peek');
  
  console.log('  ✅ PASSED');
}

async function testRecovery() {
  console.log('Test: Recovery from WAL');
  
  const queue = new FileMessageQueue({ basePath: TEST_DIR, name: 'recovery' });
  await queue.init();
  
  await queue.push({ data: 'important1' });
  await queue.push({ data: 'important2' });
  
  // Simulate corruption by clearing main queue
  await fs.writeFile(queue.queuePath, '');
  
  const result = await queue.recover();
  console.assert(result.recovered === 2, 'Should recover 2 messages');
  
  const msg1 = await queue.pop();
  console.assert(msg1.data === 'important1', 'Recovered message 1 should match');
  
  const msg2 = await queue.pop();
  console.assert(msg2.data === 'important2', 'Recovered message 2 should match');
  
  console.log('  ✅ PASSED');
}

async function testLocking() {
  console.log('Test: Locking (single process)');
  
  const queue = new FileMessageQueue({ basePath: TEST_DIR, name: 'lock' });
  await queue.init();
  
  // Multiple operations should work with locking
  await queue.push({ data: 'lock-test-1' });
  await queue.push({ data: 'lock-test-2' });
  await queue.push({ data: 'lock-test-3' });
  
  const len = await queue.length();
  console.assert(len === 3, 'Should have 3 messages');
  
  // Pop all
  for (let i = 1; i <= 3; i++) {
    const msg = await queue.pop();
    console.assert(msg.data === `lock-test-${i}`, `Message ${i} should match`);
  }
  
  console.log('  ✅ PASSED');
}

async function runTests() {
  console.log('=== File Queue Tests ===\n');
  await cleanup();
  
  try {
    await testPushPop();
    await testPeek();
    await testRecovery();
    await testLocking();
    
    console.log('\n=== ALL TESTS PASSED ✅ ===');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ FAILED:', err);
    process.exit(1);
  }
}

runTests();
