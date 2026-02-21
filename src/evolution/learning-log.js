/**
 * LearningLog - Structured learning log with daily rotation
 */

const fs = require('fs').promises;
const path = require('path');

class LearningLog {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge/logs';
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 30; // 30 days retention
  }

  getLogPath(date = new Date()) {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.basePath, `learning-log-${dateStr}.jsonl`);
  }

  async init() {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  async record(entry) {
    const logPath = this.getLogPath();
    
    // Check if rotation needed
    await this.checkRotation(logPath);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      ...entry
    };
    
    await fs.appendFile(logPath, JSON.stringify(logEntry) + '\n');
    return logEntry;
  }

  async checkRotation(logPath) {
    try {
      const stats = await fs.stat(logPath);
      if (stats.size > this.maxFileSize) {
        // Rotate: rename to .1, .2, etc.
        await this.rotateFile(logPath);
      }
    } catch {
      // File doesn't exist yet
    }
  }

  async rotateFile(basePath) {
    // Find next rotation number
    let rotation = 1;
    while (true) {
      const rotatedPath = `${basePath}.${rotation}`;
      try {
        await fs.access(rotatedPath);
        rotation++;
      } catch {
        break;
      }
    }
    
    // Rename current to rotated
    await fs.rename(basePath, `${basePath}.${rotation}`);
    
    // Cleanup old rotations (keep max 5)
    for (let i = rotation; i > 5; i--) {
      try {
        await fs.unlink(`${basePath}.${i}`);
      } catch {}
    }
  }

  async query(filters = {}) {
    // Query across all daily files
    const files = await fs.readdir(this.basePath);
    const logFiles = files
      .filter(f => f.startsWith('learning-log-'))
      .sort()
      .reverse(); // Newest first
    
    let allEntries = [];
    
    for (const file of logFiles) {
      if (allEntries.length >= (filters.limit || 1000)) break;
      
      const filePath = path.join(this.basePath, file);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const entries = content.split('\n')
          .filter(l => l.trim())
          .map(l => JSON.parse(l));
        
        allEntries.push(...entries);
      } catch {
        // Skip corrupted files
      }
    }
    
    // Apply filters
    if (filters.type) {
      allEntries = allEntries.filter(e => e.type === filters.type);
    }
    if (filters.since) {
      allEntries = allEntries.filter(e => new Date(e.timestamp) >= new Date(filters.since));
    }
    if (filters.skill) {
      allEntries = allEntries.filter(e => e.skill === filters.skill);
    }
    
    return allEntries.slice(0, filters.limit || 1000);
  }

  async getSkillHistory(skillName) {
    return this.query({ skill: skillName });
  }

  async getRecent(days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.query({ since: since.toISOString() });
  }

  async cleanup(maxAgeDays = 30) {
    const files = await fs.readdir(this.basePath);
    const cutoff = Date.now() - maxAgeDays * 86400000;
    let cleaned = 0;
    
    for (const file of files) {
      if (!file.startsWith('learning-log-')) continue;
      
      const filePath = path.join(this.basePath, file);
      try {
        const stats = await fs.stat(filePath);
        
        if (stats.mtimeMs < cutoff) {
          await fs.unlink(filePath);
          cleaned++;
        }
      } catch {}
    }
    
    return { cleaned };
  }
}

module.exports = { LearningLog };
