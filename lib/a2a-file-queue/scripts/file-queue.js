const fs = require('fs').promises;
const path = require('path');

/**
 * File-based message queue with Write-Ahead Log (WAL)
 * Ensures durability and crash recovery
 */
class FileQueue {
  constructor(name, basePath = '/knowledge-system/queues') {
    this.name = name;
    this.queuePath = path.join(basePath, `${name}.jsonl`);
    this.walPath = path.join(basePath, `${name}.wal`);
    this.processingPath = path.join(basePath, `${name}.processing`);
  }

  /**
   * Initialize queue directories
   */
  async init() {
    const dir = path.dirname(this.queuePath);
    await fs.mkdir(dir, { recursive: true });
  }

  /**
   * Push message to queue with WAL durability
   * 1. Write to WAL first (atomic)
   * 2. Append to queue
   * 3. Clear WAL entry
   */
  async push(message) {
    await this.init();
    
    const entry = {
      id: message.id || this.generateId(),
      ...message,
      _enqueuedAt: Date.now()
    };

    // Step 1: Write to WAL for durability
    await fs.appendFile(
      this.walPath,
      JSON.stringify({ op: 'push', msg: entry, ts: Date.now() }) + '\n'
    );

    // Step 2: Append to main queue
    await fs.appendFile(
      this.queuePath,
      JSON.stringify(entry) + '\n'
    );

    // Step 3: Clear WAL entry (optional, for space)
    // WAL is replayed on recover, then cleared

    return entry.id;
  }

  /**
   * Pop first message from queue
   * Returns null if queue is empty
   */
  async pop() {
    await this.init();
    
    const lines = await this.readLines();
    if (lines.length === 0) return null;

    const firstLine = lines[0];
    const message = JSON.parse(firstLine);

    // Mark as processing (for recovery)
    await this.markProcessing(message);

    // Remove from queue (rewrite file without first line)
    const remaining = lines.slice(1);
    await this.writeLines(remaining);

    return message;
  }

  /**
   * Peek at first message without removing
   */
  async peek() {
    await this.init();
    
    const lines = await this.readLines();
    if (lines.length === 0) return null;

    return JSON.parse(lines[0]);
  }

  /**
   * Recover from crash by replaying WAL
   */
  async recover() {
    await this.init();
    
    try {
      const walContent = await fs.readFile(this.walPath, 'utf8');
      const operations = walContent
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));

      // Replay uncommitted operations
      for (const op of operations) {
        if (op.op === 'push') {
          // Check if already in queue
          const exists = await this.messageExists(op.msg.id);
          if (!exists) {
            await fs.appendFile(
              this.queuePath,
              JSON.stringify(op.msg) + '\n'
            );
          }
        }
      }

      // Clear WAL after successful recovery
      await fs.writeFile(this.walPath, '');
      
      return { recovered: operations.length };
    } catch (err) {
      if (err.code === 'ENOENT') {
        // WAL doesn't exist, nothing to recover
        return { recovered: 0 };
      }
      throw err;
    }
  }

  /**
   * Check if message exists in queue
   */
  async messageExists(id) {
    const lines = await this.readLines();
    return lines.some(line => {
      try {
        const msg = JSON.parse(line);
        return msg.id === id;
      } catch {
        return false;
      }
    });
  }

  /**
   * Mark message as processing (for crash recovery)
   */
  async markProcessing(message) {
    await fs.appendFile(
      this.processingPath,
      JSON.stringify({ msg: message, startedAt: Date.now() }) + '\n'
    );
  }

  /**
   * Get queue length
   */
  async length() {
    const lines = await this.readLines();
    return lines.length;
  }

  /**
   * Read all lines from queue file
   */
  async readLines() {
    try {
      const content = await fs.readFile(this.queuePath, 'utf8');
      return content.split('\n').filter(line => line.trim());
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  /**
   * Write lines to queue file (atomic)
   */
  async writeLines(lines) {
    const tempPath = this.queuePath + '.tmp';
    const content = lines.map(l => l.trim()).join('\n') + (lines.length ? '\n' : '');
    
    await fs.writeFile(tempPath, content);
    await fs.rename(tempPath, this.queuePath);
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = { FileQueue };

// CLI usage
if (require.main === module) {
  async function main() {
    const queue = new FileQueue('test');
    
    // Test push
    console.log('Pushing messages...');
    await queue.push({ type: 'TEST', data: 'message 1' });
    await queue.push({ type: 'TEST', data: 'message 2' });
    console.log('Queue length:', await queue.length());
    
    // Test pop
    console.log('Popping...');
    const msg = await queue.pop();
    console.log('Got:', msg);
    console.log('Queue length after pop:', await queue.length());
    
    // Test recover
    console.log('Recovering...');
    const result = await queue.recover();
    console.log('Recovered:', result);
  }
  
  main().catch(console.error);
}
