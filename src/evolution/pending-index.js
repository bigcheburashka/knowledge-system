/**
 * PendingProposalsIndex - O(1) lookup for pending proposals
 */

const fs = require('fs').promises;
const path = require('path');

class PendingProposalsIndex {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge/logs';
    this.indexPath = path.join(this.basePath, 'pending-proposals.json');
  }

  async init() {
    await fs.mkdir(this.basePath, { recursive: true });
    try {
      await fs.access(this.indexPath);
    } catch {
      await fs.writeFile(this.indexPath, JSON.stringify({}));
    }
  }

  async add(proposal) {
    const index = await this.load();
    index[proposal.id] = {
      ...proposal,
      _indexedAt: Date.now()
    };
    await this.save(index);
    return proposal.id;
  }

  async get(id) {
    const index = await this.load();
    return index[id] || null;
  }

  async update(id, updates) {
    const index = await this.load();
    if (index[id]) {
      index[id] = { ...index[id], ...updates };
      await this.save(index);
      return true;
    }
    return false;
  }

  async remove(id) {
    const index = await this.load();
    const existed = !!index[id];
    delete index[id];
    await this.save(index);
    return existed;
  }

  async list(filters = {}) {
    const index = await this.load();
    let proposals = Object.values(index);
    
    if (filters.status) {
      proposals = proposals.filter(p => p.status === filters.status);
    }
    if (filters.level) {
      proposals = proposals.filter(p => p.level === filters.level);
    }
    
    return proposals;
  }

  async load() {
    try {
      const content = await fs.readFile(this.indexPath, 'utf8');
      const index = JSON.parse(content);
      
      // If index is empty, try to restore from approval queue
      const indexSize = Object.keys(index).length;
      if (indexSize === 0) {
        const restored = await this.restoreFromQueue();
        if (restored > 0) {
          return this.load(); // Reload after restore
        }
      }
      
      return index;
    } catch {
      // Try to restore from queue on error
      const restored = await this.restoreFromQueue();
      if (restored > 0) {
        return this.load();
      }
      return {};
    }
  }
  
  async restoreFromQueue() {
    try {
      const queuePath = path.join(this.basePath, 'approval-queue.jsonl');
      if (!await fs.access(queuePath).then(() => true).catch(() => false)) {
        return 0;
      }
      
      const content = await fs.readFile(queuePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      const pendingFromQueue = [];
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item.status === 'pending' && item.id) {
            pendingFromQueue.push(item);
          }
        } catch {}
      }
      
      if (pendingFromQueue.length === 0) {
        return 0;
      }
      
      console.log(`[PendingIndex] Restoring ${pendingFromQueue.length} proposals from queue...`);
      
      const restored = {};
      for (const item of pendingFromQueue) {
        restored[item.id] = {
          id: item.id,
          type: item.type,
          level: item.level,
          change: item.change,
          proposedAt: item.proposedAt,
          status: 'pending',
          _restoredFromQueue: new Date().toISOString()
        };
      }
      
      await this.save(restored);
      console.log(`[PendingIndex] ✅ Restored ${Object.keys(restored).length} proposals`);
      return Object.keys(restored).length;
    } catch (err) {
      console.error('[PendingIndex] Restore failed:', err.message);
      return 0;
    }
  }

  async save(index) {
    const tempPath = this.indexPath + '.tmp';
    await fs.writeFile(tempPath, JSON.stringify(index, null, 2));
    await fs.rename(tempPath, this.indexPath);
  }
}

module.exports = { PendingProposalsIndex };
