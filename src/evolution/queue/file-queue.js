/**
 * FileMessageQueue - File-based message queue with advisory locking
 * Replacement for Redis in Self-Evolution System
 */

const fs = require('fs').promises;
const path = require('path');
const { open } = require('fs').promises;

class FileMessageQueue {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge/queue';
    this.name = options.name || 'default';
    this.queuePath = path.join(this.basePath, `${this.name}.jsonl`);
    this.walPath = path.join(this.basePath, `${this.name}.wal.jsonl`);
    this.lockPath = path.join(this.basePath, `${this.name}.lock`);
    this.seqPath = path.join(this.basePath, `${this.name}.seq`);
    this.seqCounter = 0;
  }

  async init() {
    await fs.mkdir(this.basePath, { recursive: true });
    
    // Check disk space
    const spaceCheck = await this.checkDiskSpace();
    if (!spaceCheck.ok) {
      console.warn(`[FileQueue] WARNING: Low disk space: ${spaceCheck.availableMB}MB available`);
      console.warn(`[FileQueue] Queue may fail when disk is full`);
    }
    
    // Ensure files exist
    for (const filePath of [this.queuePath, this.walPath]) {
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, '');
      }
    }
    
    // Load sequence counter
    try {
      const seqContent = await fs.readFile(this.seqPath, 'utf8');
      this.seqCounter = parseInt(seqContent.trim()) || 0;
    } catch {
      this.seqCounter = 0;
    }
    
    // Cleanup stale lock files (older than 1 hour)
    await this.cleanupStaleLocks();
  }
  
  /**
   * Check available disk space
   */
  async checkDiskSpace() {
    try {
      const { execSync } = require('child_process');
      const output = execSync(`df -BM "${this.basePath}" | tail -1`, { encoding: 'utf8' });
      const parts = output.trim().split(/\s+/);
      const availableMB = parseInt(parts[3].replace('M', ''));
      
      return {
        ok: availableMB > 500, // At least 500MB
        availableMB,
        threshold: 500
      };
    } catch (err) {
      console.error('[FileQueue] Failed to check disk space:', err.message);
      return { ok: true, availableMB: 'unknown' }; // Assume OK if check fails
    }
  }
  
  /**
   * Get next sequence number
   */
  async nextSeq() {
    this.seqCounter++;
    await fs.writeFile(this.seqPath, this.seqCounter.toString());
    return this.seqCounter;
  }

  /**
   * Cleanup stale lock files (older than 1 hour)
   */
  async cleanupStaleLocks() {
    const pidFile = this.lockPath + '.pid';
    try {
      const stats = await fs.stat(pidFile);
      const age = Date.now() - stats.mtimeMs;
      
      // If lock file is older than 1 hour, it's stale
      if (age > 3600000) {
        try {
          await fs.unlink(pidFile);
          console.log(`[FileQueue] Cleaned up stale lock: ${pidFile}`);
        } catch {}
      }
    } catch {
      // File doesn't exist, nothing to clean
    }
  }

  /**
   * Acquire exclusive lock using pidfile
   * Single-process guarantee for queue operations
   */
  async withLock(fn) {
    const pid = process.pid;
    const pidFile = this.lockPath + '.pid';
    const maxWait = 5000; // 5 seconds max wait
    const startTime = Date.now();
    
    // Try to acquire lock
    while (Date.now() - startTime < maxWait) {
      try {
        // Check if another process holds the lock
        try {
          const existingPid = await fs.readFile(pidFile, 'utf8');
          const pidNum = parseInt(existingPid);
          
          // Check if process is still alive
          try {
            process.kill(pidNum, 0);
            // Process exists, wait and retry
            await this.sleep(100);
            continue;
          } catch {
            // Process is dead, can steal lock
          }
        } catch {
          // No lock file, can acquire
        }
        
        // Acquire lock
        await fs.writeFile(pidFile, pid.toString());
        
        // Execute function
        try {
          const result = await fn();
          return result;
        } finally {
          // Release lock
          try {
            await fs.unlink(pidFile);
          } catch {}
        }
        
      } catch (err) {
        await this.sleep(100);
      }
    }
    
    throw new Error('Could not acquire lock within timeout');
  }

  async push(message) {
    return this.withLock(async () => {
      const seq = await this.nextSeq();
      const enrichedMessage = {
        ...message,
        _timestamp: Date.now(),
        _id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        _seq: seq  // Sequence number for ordering
      };
      
      const line = JSON.stringify(enrichedMessage) + '\n';
      
      // Write to WAL first (atomic)
      await fs.appendFile(this.walPath, line);
      
      // Then to main queue
      await fs.appendFile(this.queuePath, line);
      
      return enrichedMessage._id;
    });
  }

  async pop() {
    return this.withLock(async () => {
      const content = await fs.readFile(this.queuePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      
      if (lines.length === 0) return null;
      
      const message = JSON.parse(lines[0]);
      
      // Atomic rewrite
      const remaining = lines.slice(1);
      const tempPath = this.queuePath + '.tmp';
      
      await fs.writeFile(
        tempPath, 
        remaining.join('\n') + (remaining.length ? '\n' : '')
      );
      await fs.rename(tempPath, this.queuePath);
      
      return message;
    });
  }

  async peek() {
    return this.withLock(async () => {
      const content = await fs.readFile(this.queuePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      
      if (lines.length === 0) return null;
      return JSON.parse(lines[0]);
    });
  }

  async length() {
    return this.withLock(async () => {
      const content = await fs.readFile(this.queuePath, 'utf8');
      return content.split('\n').filter(l => l.trim()).length;
    });
  }

  async recover() {
    return this.withLock(async () => {
      try {
        // Get current queue length before recovery
        const queueContent = await fs.readFile(this.queuePath, 'utf8').catch(() => '');
        const queueLines = queueContent.split('\n').filter(l => l.trim());
        const beforeCount = queueLines.length;
        
        const walContent = await fs.readFile(this.walPath, 'utf8');
        const lines = walContent.split('\n').filter(l => l.trim());
        
        // Validate each line
        const valid = [];
        for (const line of lines) {
          try {
            JSON.parse(line);
            valid.push(line);
          } catch {
            // Skip invalid lines
          }
        }
        
        // Merge with existing queue (deduplicate by checking if already exists)
        const existingIds = new Set(queueLines.map(line => {
          try {
            return JSON.parse(line)._id;
          } catch {
            return null;
          }
        }).filter(Boolean));
        
        const newLines = valid.filter(line => {
          try {
            const id = JSON.parse(line)._id;
            return !existingIds.has(id);
          } catch {
            return false;
          }
        });
        
        // Rewrite main queue with merged content
        await fs.writeFile(
          this.queuePath, 
          queueContent + newLines.join('\n') + (newLines.length ? '\n' : '')
        );
        
        // Update sequence counter to max recovered
        const maxSeq = newLines.reduce((max, line) => {
          try {
            const seq = JSON.parse(line)._seq;
            return seq > max ? seq : max;
          } catch {
            return max;
          }
        }, this.seqCounter);
        
        if (maxSeq > this.seqCounter) {
          this.seqCounter = maxSeq;
          await fs.writeFile(this.seqPath, this.seqCounter.toString());
        }
        
        return { recovered: newLines.length, total: beforeCount + newLines.length };
      } catch {
        return { recovered: 0, total: 0 };
      }
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { FileMessageQueue };
