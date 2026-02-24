#!/usr/bin/env node
/**
 * Recovery for stuck processing topics
 * Возвращает "зависшие" темы из processing в pending
 */

const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, '..', 'data', 'learning-queue.json');
const STUCK_TIMEOUT_HOURS = 2; // Тема считается зависшей после 2 часов

function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading queue:', e.message);
  }
  return { pending: [], processing: [] };
}

function saveQueue(queue) {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
    return true;
  } catch (e) {
    console.error('Error saving queue:', e.message);
    return false;
  }
}

function main() {
  console.log('=== PROCESSING RECOVERY ===\n');
  
  const queue = loadQueue();
  const now = new Date();
  const stuckTimeout = STUCK_TIMEOUT_HOURS * 60 * 60 * 1000; // 2 hours in ms
  
  const recovered = [];
  const stillProcessing = [];
  
  for (const topic of queue.processing || []) {
    const startedAt = topic.startedAt ? new Date(topic.startedAt) : null;
    
    if (!startedAt) {
      // No startedAt - definitely stuck
      console.log(`⚠️  ${topic.name}: no startedAt, recovering`);
      recovered.push({ ...topic, recoveredAt: now.toISOString(), reason: 'no_start_time' });
      continue;
    }
    
    const elapsed = now - startedAt;
    
    if (elapsed > stuckTimeout) {
      // Stuck for too long
      const hours = Math.round(elapsed / 3600000 * 10) / 10;
      console.log(`⏰ ${topic.name}: stuck for ${hours}h, recovering`);
      recovered.push({ 
        ...topic, 
        recoveredAt: now.toISOString(), 
        reason: `stuck_${hours}h`,
        previousStartedAt: topic.startedAt
      });
    } else {
      // Still processing normally
      stillProcessing.push(topic);
    }
  }
  
  // Move recovered to pending
  if (recovered.length > 0) {
    queue.pending = queue.pending || [];
    for (const topic of recovered) {
      // Remove startedAt to allow re-processing
      delete topic.startedAt;
      queue.pending.push(topic);
    }
    console.log(`\n✅ Recovered ${recovered.length} stuck topics to pending`);
  } else {
    console.log('\n✅ No stuck topics found');
  }
  
  // Update processing list
  queue.processing = stillProcessing;
  
  if (saveQueue(queue)) {
    console.log(`📊 Processing: ${stillProcessing.length}, Pending: ${queue.pending.length}`);
    
    // Save recovery log
    const logEntry = {
      timestamp: now.toISOString(),
      recovered: recovered.length,
      stillProcessing: stillProcessing.length,
      recoveredTopics: recovered.map(t => t.name)
    };
    
    const logFile = path.join(__dirname, '..', 'data', 'recovery-log.jsonl');
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    
    return recovered.length;
  } else {
    console.error('❌ Failed to save queue');
    return 0;
  }
}

const recoveredCount = main();
process.exit(recoveredCount > 0 ? 0 : 0);
