/**
 * Concurrent Access Test - Two Processes
 */
const { FileMessageQueue } = require('./src/evolution/queue/file-queue');

const TEST_DIR = '/tmp/test-concurrent';
const processId = process.argv[2] || '1';

async function run() {
  const queue = new FileMessageQueue({ 
    basePath: TEST_DIR, 
    name: 'concurrent' 
  });
  await queue.init();
  
  console.log(`[Process ${processId}] Starting...`);
  
  // Each process pushes 5 messages
  for (let i = 0; i < 5; i++) {
    const id = await queue.push({ 
      process: processId, 
      msg: i,
      time: Date.now()
    });
    console.log(`[Process ${processId}] Pushed message ${i}: ${id}`);
    await new Promise(r => setTimeout(r, 50)); // Small delay
  }
  
  console.log(`[Process ${processId}] Done pushing`);
  
  // Try to pop some
  for (let i = 0; i < 3; i++) {
    const msg = await queue.pop();
    if (msg) {
      console.log(`[Process ${processId}] Popped: ${msg.process}-${msg.msg}`);
    } else {
      console.log(`[Process ${processId}] Queue empty`);
    }
  }
  
  const len = await queue.length();
  console.log(`[Process ${processId}] Final queue length: ${len}`);
  console.log(`[Process ${processId}] Done`);
}

run().catch(console.error);
