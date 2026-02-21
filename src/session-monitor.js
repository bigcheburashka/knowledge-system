#!/usr/bin/env node
/**
 * Session Monitor - Real-time indexing with Evolution integration
 */

const fs = require('fs').promises;
const path = require('path');
const { getEmbedding } = require('./embedding-service');
const { PatternDetector } = require('../lib/pattern-detector/scripts/detector');
const { SelfEvolution } = require('./evolution');
const EpisodicMemory = require('./episodic-memory');
const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';
const SESSION_DIR = '/root/.openclaw/agents/main/sessions';

class SessionMonitor {
  constructor() {
    this.lastProcessed = new Map();
    this.isRunning = false;
    this.patternDetector = new PatternDetector();
    this.evolution = null;
    this.episodicMemory = null;
    this.sessionErrors = [];
    this.analysisThreshold = parseInt(process.env.ANALYSIS_THRESHOLD) || 3;
    this.patternThreshold = parseInt(process.env.PATTERN_THRESHOLD) || 2;
  }

  async init() {
    // Initialize Evolution system
    try {
      this.evolution = new SelfEvolution();
      await this.evolution.init();
      console.log('[SessionMonitor] Evolution system initialized');
    } catch (err) {
      console.warn('[SessionMonitor] Evolution not available:', err.message);
      this.evolution = null;
    }
    
    // Initialize Episodic Memory
    try {
      this.episodicMemory = new EpisodicMemory();
      await this.episodicMemory.init();
      console.log('[SessionMonitor] Episodic Memory initialized');
    } catch (err) {
      console.warn('[SessionMonitor] Episodic Memory not available:', err.message);
      this.episodicMemory = null;
    }
  }

  async getLatestSession() {
    try {
      const files = await fs.readdir(SESSION_DIR);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      
      if (jsonlFiles.length === 0) return null;
      
      const fileStats = await Promise.all(
        jsonlFiles.map(async f => {
          const stat = await fs.stat(path.join(SESSION_DIR, f));
          return { file: f, mtime: stat.mtime };
        })
      );
      
      fileStats.sort((a, b) => b.mtime - a.mtime);
      
      return {
        id: fileStats[0].file.replace('.jsonl', ''),
        path: path.join(SESSION_DIR, fileStats[0].file),
        mtime: fileStats[0].mtime
      };
    } catch (e) {
      console.error('Error finding latest session:', e.message);
      return null;
    }
  }

  async processNewMessages(sessionPath, sessionId) {
    try {
      const content = await fs.readFile(sessionPath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      
      const lastProcessed = this.lastProcessed.get(sessionId) || 0;
      const newLines = lines.slice(lastProcessed);
      
      if (newLines.length === 0) return [];
      
      const messages = [];
      
      for (const line of newLines) {
        try {
          const msg = JSON.parse(line);
          
          if (msg.type === 'message' && msg.message) {
            const role = msg.message.role;
            let text = '';
            
            if (Array.isArray(msg.message.content)) {
              text = msg.message.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');
            } else if (typeof msg.message.content === 'string') {
              text = msg.message.content;
            }
            
            if (role && text && (role === 'user' || role === 'assistant')) {
              messages.push({
                role,
                text: text.substring(0, 5000),
                timestamp: msg.timestamp,
                id: msg.id
              });
              
              // Detect errors in assistant messages
              if (role === 'assistant') {
                this.detectErrorsInMessage(text);
              }
            }
          }
        } catch (e) {
          // Skip malformed lines
        }
      }
      
      this.lastProcessed.set(sessionId, lines.length);
      return messages;
    } catch (e) {
      console.error('Error processing messages:', e.message);
      return [];
    }
  }

  detectErrorsInMessage(text) {
    const errorPatterns = [
      { pattern: /❌|FAILED|Error:/i, type: 'ERROR' },
      { pattern: /Cannot find module|require\(/i, type: 'MODULE_ERROR' },
      { pattern: /git add -A|git add \./i, type: 'GIT_ERROR' },
      { pattern: /timeout|timed out/i, type: 'TIMEOUT' },
      { pattern: /ENOENT|file not found/i, type: 'FILE_ERROR' }
    ];
    
    for (const { pattern, type } of errorPatterns) {
      if (pattern.test(text)) {
        this.sessionErrors.push({
          type,
          text: text.substring(0, 200),
          timestamp: Date.now()
        });
      }
    }
  }

  async analyzeAndPropose() {
    if (!this.evolution || this.sessionErrors.length === 0) return;
    
    if (this.sessionErrors.length < this.analysisThreshold) return;
    
    console.log(`[SessionMonitor] Analyzing ${this.sessionErrors.length} errors...`);
    
    const logs = this.sessionErrors.map(e => ({
      level: 'error',
      message: e.text,
      timestamp: e.timestamp
    }));
    
    try {
      const patterns = await this.patternDetector.analyze(logs);
      
      for (const errorPattern of patterns.errors) {
        if (errorPattern.count >= this.patternThreshold) {
          console.log(`[SessionMonitor] Recurring error: ${errorPattern.error} (${errorPattern.count}x)`);
          
          // Validate the error pattern before creating proposal
          const validation = this.isValidErrorPattern(errorPattern);
          if (!validation.valid) {
            console.log(`[SessionMonitor] Skipping invalid pattern: ${validation.reason}`);
            continue;
          }
          
          // Check if already proposed
          const existing = await this.evolution.pending.list({ status: 'pending' });
          const alreadyProposed = existing.some(p => 
            p.change?.reason?.includes(errorPattern.error.substring(0, 50))
          );
          
          if (!alreadyProposed) {
            try {
              await this.evolution.propose({
                type: 'new_skill',
                skill: {
                  name: `prevent-${this.sanitizeName(errorPattern.error)}`,
                  description: `Prevents "${errorPattern.error.substring(0, 80)}"`
                },
                reason: `Detected ${errorPattern.count} times: ${errorPattern.error.substring(0, 100)}`
              });
              console.log(`[SessionMonitor] Proposed skill for: ${errorPattern.error.substring(0, 50)}`);
            } catch (err) {
              console.error('[SessionMonitor] Failed to propose:', err.message);
            }
          }
        }
      }
    } catch (err) {
      console.error('[SessionMonitor] Analysis failed:', err.message);
    }
    
    // Clear processed errors
    this.sessionErrors = [];
  }

  sanitizeName(error) {
    return error
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .substring(0, 30)
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  
  /**
   * Validate if error pattern is suitable for skill creation
   */
  isValidErrorPattern(errorPattern) {
    const error = errorPattern.error;
    
    // 1. Check minimum length
    if (error.length < 20) {
      return { valid: false, reason: 'too_short' };
    }
    
    // 2. Check for markdown formatting
    if (error.includes('**') || error.includes('##') || error.includes('`')) {
      return { valid: false, reason: 'contains_markdown' };
    }
    
    // 3. Check for emoji at start (likely a formatted message, not an error)
    if (error.match(/^[✅📊📝🔍🎯❌⚠️🎉🚀📈📉]/)) {
      return { valid: false, reason: 'starts_with_emoji' };
    }
    
    // 4. Check for common response patterns (not actual errors)
    const responsePatterns = [
      /^готово/i,
      /^статус/i,
      /^анализ/i,
      /^результат/i,
      /^✅/,
      /^📊/,
      /^##\s/,
      /^\*\*/,
      /^ответ/i,
      /^честный ответ/i
    ];
    
    for (const pattern of responsePatterns) {
      if (pattern.test(error)) {
        return { valid: false, reason: 'response_not_error' };
      }
    }
    
    // 5. Check if it looks like an actual error
    const errorIndicators = [
      /error/i,
      /fail/i,
      /cannot/i,
      /unable/i,
      /exception/i,
      /timeout/i,
      /refused/i,
      /denied/i,
      /not found/i,
      / ENOENT /,
      / EACCES /,
      / ECONN /
    ];
    
    const hasErrorIndicator = errorIndicators.some(p => p.test(error));
    if (!hasErrorIndicator) {
      return { valid: false, reason: 'not_an_error' };
    }
    
    return { valid: true };
  }

  async indexMessage(message, sessionId) {
    try {
      const text = `${message.role}: ${message.text}`;
      const embedding = await getEmbedding(text);
      
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
        { limit: 1, with_payload: false }
      );
      const maxId = response.data.result.points?.reduce((max, p) => Math.max(max, p.id), 0) || 0;
      
      await axios.put(
        `${QDRANT_URL}/collections/${COLLECTION}/points`,
        {
          points: [{
            id: maxId + 1,
            vector: embedding,
            payload: {
              name: `${message.role}_${Date.now()}`,
              type: 'session_message',
              text: message.text,
              role: message.role,
              sessionId: sessionId,
              timestamp: new Date().toISOString(),
              source: 'realtime'
            }
          }]
        }
      );
      
      console.log(`✅ Indexed: ${message.role} message (${message.text.length} chars)`);
      return true;
    } catch (e) {
      console.error('❌ Index error:', e.message);
      return false;
    }
  }

  async runOnce() {
    const session = await this.getLatestSession();
    if (!session) {
      console.log('No active session found');
      return 0;
    }
    
    const messages = await this.processNewMessages(session.path, session.id);
    
    let indexed = 0;
    for (const msg of messages) {
      const success = await this.indexMessage(msg, session.id);
      if (success) indexed++;
      await new Promise(r => setTimeout(r, 500));
    }
    
    // Analyze errors if enough accumulated
    if (this.sessionErrors.length >= this.analysisThreshold) {
      await this.analyzeAndPropose();
    }
    
    return indexed;
  }

  async start(intervalMs = 10000) {
    // Initialize first
    await this.init();
    
    this.isRunning = true;
    console.log(`🔄 Session monitor started (interval: ${intervalMs}ms)`);
    
    while (this.isRunning) {
      const indexed = await this.runOnce();
      if (indexed > 0) {
        console.log(`📊 Indexed ${indexed} new messages`);
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }

  stop() {
    this.isRunning = false;
    console.log('🛑 Session monitor stopped');
  }
}

// Run if called directly
if (require.main === module) {
  const monitor = new SessionMonitor();
  
  process.on('SIGINT', () => {
    monitor.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    monitor.stop();
    process.exit(0);
  });
  
  monitor.start(5000);
}

module.exports = SessionMonitor;
