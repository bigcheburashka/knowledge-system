#!/usr/bin/env node
/**
 * Sync Topics to Queue
 * Синхронизирует high и medium priority темы из custom-topics.json в learning-queue.json
 */

const fs = require('fs');
const path = require('path');

const CUSTOM_TOPICS_FILE = path.join(__dirname, '..', 'custom-topics.json');
const QUEUE_FILE = path.join(__dirname, '..', 'data', 'learning-queue.json');
const SYNC_LOG_FILE = path.join(__dirname, '..', 'data', 'sync-log.jsonl');

function loadJSON(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`Error loading ${file}:`, e.message);
  }
  return null;
}

function saveJSON(file, data) {
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error(`Error saving ${file}:`, e.message);
    return false;
  }
}

function logSync(stats) {
  const entry = {
    timestamp: new Date().toISOString(),
    ...stats
  };
  fs.appendFileSync(SYNC_LOG_FILE, JSON.stringify(entry) + '\n');
}

function main() {
  console.log('=== SYNC TOPICS TO QUEUE ===\n');
  
  // Load files
  const topicsData = loadJSON(CUSTOM_TOPICS_FILE);
  const queueData = loadJSON(QUEUE_FILE) || { pending: [], processing: [] };
  
  if (!topicsData) {
    console.error('❌ Cannot load custom-topics.json');
    process.exit(1);
  }
  
  const topics = topicsData.topics || [];
  const queueNames = new Set([
    ...queueData.pending.map(t => t.name),
    ...queueData.processing.map(t => t.name)
  ]);
  
  console.log(`Total topics in custom-topics.json: ${topics.length}`);
  console.log(`Topics already in queue: ${queueNames.size}`);
  
  // Find high and medium priority topics not in queue
  const topicsToAdd = topics.filter(t => 
    (t.priority === 'high' || t.priority === 'medium') && 
    !queueNames.has(t.name)
  );
  
  const highPriority = topicsToAdd.filter(t => t.priority === 'high');
  const mediumPriority = topicsToAdd.filter(t => t.priority === 'medium');
  
  console.log(`\nTopics to add:`);
  console.log(`  High priority: ${highPriority.length}`);
  console.log(`  Medium priority: ${mediumPriority.length}`);
  console.log(`  Total: ${topicsToAdd.length}`);
  
  if (topicsToAdd.length === 0) {
    console.log('\n✅ All high and medium priority topics are already in queue!');
    logSync({ 
      highAdded: 0, 
      mediumAdded: 0, 
      totalAdded: 0, 
      totalPending: queueData.pending.length,
      totalProcessing: queueData.processing.length
    });
    return;
  }
  
  // Add to queue
  let added = 0;
  for (const topic of topicsToAdd) {
    queueData.pending.push({
      name: topic.name,
      type: topic.type || 'technology',
      priority: topic.priority,
      description: topic.description || '',
      source: topic.source || 'sync',
      addedAt: new Date().toISOString()
    });
    added++;
    
    if (added <= 10) {
      console.log(`  + ${topic.name} (${topic.priority}, ${topic.source || 'unknown'})`);
    } else if (added === 11) {
      console.log(`  ... and ${topicsToAdd.length - 10} more`);
    }
  }
  
  // Save queue
  if (saveJSON(QUEUE_FILE, queueData)) {
    console.log(`\n✅ Added ${added} topics to learning-queue.json`);
    console.log(`📊 Total in queue: ${queueData.pending.length} pending, ${queueData.processing.length} processing`);
    
    // Log sync
    logSync({
      highAdded: highPriority.length,
      mediumAdded: mediumPriority.length,
      totalAdded: added,
      totalPending: queueData.pending.length,
      totalProcessing: queueData.processing.length
    });
  } else {
    console.error('\n❌ Failed to save queue');
    process.exit(1);
  }
}

main();
