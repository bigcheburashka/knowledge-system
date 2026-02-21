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
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  async save(index) {
    const tempPath = this.indexPath + '.tmp';
    await fs.writeFile(tempPath, JSON.stringify(index, null, 2));
    await fs.rename(tempPath, this.indexPath);
  }
}

module.exports = { PendingProposalsIndex };
