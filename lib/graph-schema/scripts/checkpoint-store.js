/**
 * Checkpoint Store
 * Hybrid: Filesystem + Memgraph indexing
 */

const fs = require('fs').promises;
const path = require('path');

class CheckpointStore {
  constructor(options = {}) {
    this.checkpointPath = options.checkpointPath || '/knowledge-system/checkpoints';
    this.memgraph = options.memgraph; // Neo4j driver
  }

  async init() {
    await fs.mkdir(this.checkpointPath, { recursive: true });
  }

  /**
   * Save checkpoint atomically
   */
  async save(checkpoint) {
    await this.init();
    
    const id = checkpoint.id || this.generateId();
    const tempPath = path.join('/tmp', `checkpoint-${id}.tmp`);
    const finalPath = path.join(this.checkpointPath, `${id}.json`);
    
    // Write to temp first (atomic)
    await fs.writeFile(tempPath, JSON.stringify({
      ...checkpoint,
      id,
      savedAt: Date.now()
    }, null, 2));
    
    // Atomic rename
    await fs.rename(tempPath, finalPath);
    
    // Index in Memgraph (if available)
    if (this.memgraph) {
      await this.indexInGraph(id, checkpoint);
    }
    
    return id;
  }

  /**
   * Load checkpoint by ID
   */
  async load(id) {
    const filePath = path.join(this.checkpointPath, `${id}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  }

  /**
   * List all checkpoints
   */
  async list() {
    await this.init();
    
    const files = await fs.readdir(this.checkpointPath);
    const checkpoints = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const id = file.replace('.json', '');
        const data = await this.load(id);
        checkpoints.push(data);
      }
    }
    
    return checkpoints.sort((a, b) => b.savedAt - a.savedAt);
  }

  /**
   * Index checkpoint in Memgraph
   */
  async indexInGraph(id, checkpoint) {
    if (!this.memgraph) return;
    
    const session = this.memgraph.session();
    try {
      await session.run(`
        CREATE (c:Checkpoint {
          id: $id,
          status: $status,
          agent: $agent,
          created: datetime(),
          path: $path
        })
      `, {
        id,
        status: checkpoint.status || 'active',
        agent: checkpoint.agent || 'unknown',
        path: path.join(this.checkpointPath, `${id}.json`)
      });
    } finally {
      await session.close();
    }
  }

  generateId() {
    return `cp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = { CheckpointStore };
