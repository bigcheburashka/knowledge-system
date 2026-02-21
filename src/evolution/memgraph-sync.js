/**
 * MemgraphSync Worker
 * Async synchronization between Qdrant and Memgraph
 * Processes queue tasks with retry logic
 */

const { FileMessageQueue } = require('./queue/file-queue');
const { LearningLog } = require('./learning-log');
const fs = require('fs').promises;
const path = require('path');

class MemgraphSyncWorker {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge';
    this.queue = new FileMessageQueue({ 
      basePath: `${this.basePath}/queue`, 
      name: 'memgraph-sync' 
    });
    this.log = new LearningLog({ basePath: `${this.basePath}/logs` });
    this.auditLog = path.join(this.basePath, 'logs', 'audit.log');
    this.isRunning = false;
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
    
    // Dead letter queue for failed tasks
    this.dlq = new FileMessageQueue({
      basePath: `${this.basePath}/queue`,
      name: 'memgraph-sync-dlq'
    });
  }

  async init() {
    await this.queue.init();
    await this.log.init();
    await this.dlq.init();
    console.log('[MemgraphSync] Worker initialized');
  }

  /**
   * Main worker loop
   */
  async start() {
    this.isRunning = true;
    console.log('[MemgraphSync] Worker started');

    while (this.isRunning) {
      try {
        const task = await this.queue.pop();
        
        if (task) {
          await this.processTask(task);
        } else {
          // No tasks, wait before checking again
          await this.sleep(1000);
        }
      } catch (err) {
        console.error('[MemgraphSync] Worker error:', err.message);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Process single sync task with retry
   */
  async processTask(task) {
    const { entity, operation } = task;
    
    console.log(`[MemgraphSync] Processing: ${entity.name} (${operation})`);
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.syncToMemgraph(entity, operation);
        
        if (result.success) {
          await this.audit('SYNC_SUCCESS', {
            entity: entity.name,
            operation,
            attempt,
            timestamp: new Date().toISOString()
          });
          
          console.log(`[MemgraphSync] Success: ${entity.name}`);
          return;
        }
        
      } catch (err) {
        console.error(`[MemgraphSync] Attempt ${attempt} failed:`, err.message);
        
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelay * attempt);
        } else {
          // Max retries reached, move to dead letter queue
          await this.moveToDLQ(task, err.message);
          
          await this.audit('SYNC_FAILED_DLQ', {
            entity: entity.name,
            operation,
            error: err.message,
            timestamp: new Date().toISOString()
          });
          
          console.error(`[MemgraphSync] Moved to DLQ: ${entity.name}`);
        }
      }
    }
  }

  /**
   * Move failed task to dead letter queue
   */
  async moveToDLQ(task, errorMessage) {
    const dlqEntry = {
      ...task,
      _dlq: {
        movedAt: new Date().toISOString(),
        error: errorMessage,
        retryCount: this.maxRetries
      }
    };
    
    await this.dlq.push(dlqEntry);
    
    // Log for admin notification
    await this.log.record({
      type: 'memgraph_sync_dlq',
      entity: task.entity?.name,
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
    
    console.error(`[MemgraphSync] Task moved to DLQ: ${task.entity?.name}`);
  }

  /**
   * Sync entity to Memgraph with deduplication (MERGE)
   */
  async syncToMemgraph(entity, operation) {
    // Dynamic import to avoid issues if neo4j-driver not available
    let neo4j;
    try {
      neo4j = require('neo4j-driver');
    } catch {
      throw new Error('neo4j-driver not installed');
    }
    
    const driver = neo4j.driver(
      process.env.MEMGRAPH_URL || 'bolt://localhost:7687',
      neo4j.auth.basic(
        process.env.MEMGRAPH_USER || '',
        process.env.MEMGRAPH_PASSWORD || ''
      )
    );
    
    const session = driver.session();
    
    try {
      // Use MERGE for deduplication - creates if not exists, updates if exists
      await session.run(`
        MERGE (e:Entity {name: $name})
        ON CREATE SET 
          e.type = $type,
          e.description = $description,
          e.source = $source,
          e.createdAt = datetime(),
          e.updatedAt = datetime(),
          e.qdrantId = $qdrantId
        ON MATCH SET
          e.type = $type,
          e.description = $description,
          e.updatedAt = datetime(),
          e.qdrantId = $qdrantId
        RETURN e
      `, {
        name: entity.name,
        type: entity.type,
        description: entity.description,
        source: entity.source || 'memgraph-sync',
        qdrantId: entity.qdrantId
      });
      
      // Create relationships (also with MERGE for dedup)
      if (entity.related && entity.related.length > 0) {
        for (const relatedName of entity.related) {
          await session.run(`
            MATCH (e:Entity {name: $entityName})
            MERGE (r:Entity {name: $relatedName})
            ON CREATE SET 
              r.type = 'technology',
              r.source = 'auto-created',
              r.createdAt = datetime()
            MERGE (e)-[rel:RELATED_TO]->(r)
            ON CREATE SET 
              rel.createdAt = datetime(),
              rel.source = 'memgraph-sync'
            RETURN rel
          `, {
            entityName: entity.name,
            relatedName
          });
        }
      }
      
      // Add best practices
      if (entity.bestPractices && entity.bestPractices.length > 0) {
        for (let i = 0; i < entity.bestPractices.length; i++) {
          await session.run(`
            MATCH (e:Entity {name: $entityName})
            MERGE (p:BestPractice {description: $practice, entity: $entityName})
            ON CREATE SET 
              p.order = $order,
              p.createdAt = datetime(),
              p.source = 'memgraph-sync'
            MERGE (e)-[:HAS_BEST_PRACTICE]->(p)
            RETURN p
          `, {
            entityName: entity.name,
            practice: entity.bestPractices[i],
            order: i + 1
          });
        }
      }
      
      // Add common mistakes
      if (entity.commonMistakes && entity.commonMistakes.length > 0) {
        for (let i = 0; i < entity.commonMistakes.length; i++) {
          await session.run(`
            MATCH (e:Entity {name: $entityName})
            MERGE (m:CommonMistake {description: $mistake, entity: $entityName})
            ON CREATE SET 
              m.order = $order,
              m.createdAt = datetime(),
              m.source = 'memgraph-sync'
            MERGE (e)-[:HAS_COMMON_MISTAKE]->(m)
            RETURN m
          `, {
            entityName: entity.name,
            mistake: entity.commonMistakes[i],
            order: i + 1
          });
        }
      }
      
      return { success: true };
      
    } finally {
      await session.close();
      await driver.close();
    }
  }

  /**
   * Write to audit log
   */
  async audit(action, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      action,
      ...data
    };
    
    await fs.appendFile(
      this.auditLog,
      JSON.stringify(entry) + '\n'
    );
  }

  /**
   * Add sync task to queue (called by Deep Learning)
   */
  async addSyncTask(entity, operation = 'CREATE') {
    await this.queue.push({
      type: 'MEMGRAPH_SYNC',
      entity,
      operation,
      timestamp: Date.now()
    });
  }

  /**
   * Check consistency between Qdrant and Memgraph
   */
  async checkConsistency() {
    console.log('[MemgraphSync] Checking consistency...');
    
    // Get count from Qdrant
    const axios = require('axios');
    const qdrantCount = await axios.get(
      `${process.env.QDRANT_URL || 'http://localhost:6333'}/collections/knowledge`
    ).then(r => r.data.result.points_count).catch(() => 0);
    
    // Get count from Memgraph
    let memgraphCount = 0;
    try {
      const neo4j = require('neo4j-driver');
      const driver = neo4j.driver('bolt://localhost:7687');
      const session = driver.session();
      
      const result = await session.run('MATCH (e:Entity) RETURN count(e) as count');
      memgraphCount = result.records[0].get('count').toNumber();
      
      await session.close();
      await driver.close();
    } catch {
      memgraphCount = 0;
    }
    
    const diff = qdrantCount - memgraphCount;
    
    await this.audit('CONSISTENCY_CHECK', {
      qdrantCount,
      memgraphCount,
      diff,
      timestamp: new Date().toISOString()
    });
    
    return { qdrantCount, memgraphCount, diff };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  stop() {
    this.isRunning = false;
    console.log('[MemgraphSync] Worker stopping...');
  }
}

// CLI usage
if (require.main === module) {
  const worker = new MemgraphSyncWorker();
  
  worker.init().then(() => {
    worker.start();
  }).catch(err => {
    console.error('[MemgraphSync] Failed to start:', err);
    process.exit(1);
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => worker.stop());
  process.on('SIGINT', () => worker.stop());
}

module.exports = { MemgraphSyncWorker };
