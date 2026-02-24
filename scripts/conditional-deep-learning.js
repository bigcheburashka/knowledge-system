#!/usr/bin/env node
/**
 * Conditional Deep Learning
 * Запускает deep learning только если есть >10 тем в очереди
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const QUEUE_FILE = path.join(__dirname, '../data/learning-queue.json');
const THRESHOLD = 10;

function main() {
  console.log('[Conditional DL] Checking queue...');
  
  // Check if queue file exists
  if (!fs.existsSync(QUEUE_FILE)) {
    console.log('[Conditional DL] No queue file, creating empty queue');
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({ pending: [], processing: [] }, null, 2));
    return;
  }
  
  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch (e) {
    console.log('[Conditional DL] Invalid queue file, resetting');
    queue = { pending: [], processing: [] };
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  }
  
  const pendingCount = queue.pending?.length || 0;
  
  console.log(`[Conditional DL] Pending topics: ${pendingCount}`);
  
  if (pendingCount >= THRESHOLD) {
    console.log(`[Conditional DL] Threshold met (${THRESHOLD}), running deep learning...`);
    try {
      execSync('node scripts/deep-learning.js', { 
        cwd: '/root/.openclaw/workspace/knowledge-system',
        stdio: 'inherit'
      });
      console.log('[Conditional DL] Complete');
    } catch (err) {
      console.error('[Conditional DL] Error:', err.message);
      process.exit(1);
    }
  } else {
    console.log(`[Conditional DL] Below threshold (${THRESHOLD}), skipping`);
  }
}

main();
