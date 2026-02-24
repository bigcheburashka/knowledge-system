/**
 * Sync pending index with approval queue
 * Восстанавливает pending-proposals.json из approval-queue.jsonl при несоответствии
 */

const fs = require('fs');
const path = require('path');

const BASE_PATH = process.env.KNOWLEDGE_LOG_PATH || '/var/lib/knowledge/logs';
const QUEUE_FILE = path.join(BASE_PATH, 'approval-queue.jsonl');
const INDEX_FILE = path.join(BASE_PATH, 'pending-proposals.json');

function loadQueue() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    const content = fs.readFileSync(QUEUE_FILE, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(item => item !== null);
  } catch (e) {
    console.error('[Sync] Error loading queue:', e.message);
    return [];
  }
}

function loadIndex() {
  try {
    if (!fs.existsSync(INDEX_FILE)) return {};
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch (e) {
    console.error('[Sync] Error loading index:', e.message);
    return {};
  }
}

function saveIndex(index) {
  try {
    const tempPath = INDEX_FILE + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(index, null, 2));
    fs.renameSync(tempPath, INDEX_FILE);
    return true;
  } catch (e) {
    console.error('[Sync] Error saving index:', e.message);
    return false;
  }
}

async function syncPendingWithQueue() {
  console.log('[Sync] Checking pending index vs approval queue...');
  
  const queue = loadQueue();
  const index = loadIndex();
  
  const pendingInQueue = queue.filter(item => item.status === 'pending');
  const pendingInIndex = Object.values(index).filter(item => item.status === 'pending');
  
  console.log(`[Sync] Queue has ${pendingInQueue.length} pending proposals`);
  console.log(`[Sync] Index has ${pendingInIndex.length} pending proposals`);
  
  // If index is empty but queue has items, restore from queue
  if (pendingInIndex.length === 0 && pendingInQueue.length > 0) {
    console.log('[Sync] ⚠️  Index empty but queue has data. Restoring...');
    
    const restored = {};
    for (const item of pendingInQueue) {
      if (item.id && item.status === 'pending') {
        restored[item.id] = {
          id: item.id,
          type: item.type,
          level: item.level,
          change: item.change,
          proposedAt: item.proposedAt,
          status: 'pending',
          _restoredAt: new Date().toISOString()
        };
      }
    }
    
    if (saveIndex(restored)) {
      console.log(`[Sync] ✅ Restored ${Object.keys(restored).size} proposals to index`);
      return Object.keys(restored).length;
    }
  }
  
  // If queue has items not in index, add them
  const queueIds = new Set(pendingInQueue.map(item => item.id));
  const indexIds = new Set(Object.keys(index));
  const missingInIndex = [...queueIds].filter(id => !indexIds.has(id));
  
  if (missingInIndex.length > 0) {
    console.log(`[Sync] ⚠️  ${missingInIndex.length} proposals in queue but not in index. Adding...`);
    
    for (const id of missingInIndex) {
      const item = pendingInQueue.find(p => p.id === id);
      if (item) {
        index[id] = {
          id: item.id,
          type: item.type,
          level: item.level,
          change: item.change,
          proposedAt: item.proposedAt,
          status: 'pending',
          _syncedAt: new Date().toISOString()
        };
      }
    }
    
    if (saveIndex(index)) {
      console.log(`[Sync] ✅ Added ${missingInIndex.length} missing proposals to index`);
      return missingInIndex.length;
    }
  }
  
  console.log('[Sync] ✅ Index is synchronized');
  return 0;
}

// Run if called directly
if (require.main === module) {
  syncPendingWithQueue().then(count => {
    process.exit(count > 0 ? 0 : 0);
  }).catch(err => {
    console.error('[Sync] Error:', err);
    process.exit(1);
  });
}

module.exports = { syncPendingWithQueue };
