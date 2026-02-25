#!/usr/bin/env node
// OpenClaw Adapter - FIXED for real OpenClaw session format

const fs = require('fs').promises;
const path = require('path');
const glob = require('glob').glob;
const { GapDetector } = require('./gap-detector');

const OPENCLAW_DIR = '/root/.openclaw';
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');

class OpenClawAdapter {
  constructor(options = {}) {
    this.hoursBack = options.hours || 24;
    // Singleton GapDetector instance for deduplication
    this._gapDetector = null;
  }
  
  /**
   * Lazy-loaded singleton GapDetector
   */
  get gapDetector() {
    if (!this._gapDetector) {
      this._gapDetector = new GapDetector();
    }
    return this._gapDetector;
  }

  async findSessionFiles() {
    try {
      const pattern = path.join(AGENTS_DIR, '**/sessions/*.jsonl');
      const files = await glob(pattern);
      
      const cutoff = Date.now() - (this.hoursBack * 3600000);
      const recentFiles = [];
      
      for (const file of files) {
        try {
          const stat = await fs.stat(file);
          if (stat.mtimeMs > cutoff) {
            recentFiles.push({
              path: file,
              mtime: stat.mtime,
              size: stat.size
            });
          }
        } catch (e) {
          // Skip files we can't stat
        }
      }
      
      return recentFiles.sort((a, b) => b.mtime - a.mtime);
    } catch (e) {
      console.error('Error finding sessions:', e.message);
      return [];
    }
  }

  async readSession(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      
      const messages = [];
      let sessionId = null;
      
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          
          // Get session ID from session entry
          if (msg.type === 'session' && msg.id) {
            sessionId = msg.id;
          }
          
          // FIXED: Real OpenClaw format has msg.message with role and content array
          if (msg.type === 'message' && msg.message) {
            const role = msg.message.role;
            const timestamp = msg.timestamp || msg.message.timestamp;
            
            // FIXED: Content is array with text objects
            let content = '';
            if (Array.isArray(msg.message.content)) {
              content = msg.message.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');
            } else if (typeof msg.message.content === 'string') {
              content = msg.message.content;
            }
            
            if (role && content && (role === 'user' || role === 'assistant')) {
              messages.push({
                role: role,
                content: content,
                timestamp: timestamp,
                id: msg.id
              });
            }
          }
        } catch (e) {
          // Skip malformed lines
          console.error('Parse error:', e.message, 'Line:', line.substring(0, 100));
        }
      }
      
      return {
        id: sessionId || path.basename(filePath, '.jsonl'),
        path: filePath,
        messages: messages,
        messageCount: messages.length,
        lastModified: (await fs.stat(filePath)).mtime
      };
    } catch (e) {
      console.error(`Error reading ${filePath}:`, e.message);
      return null;
    }
  }

  extractKnowledge(session) {
    if (!session || !session.messages || !Array.isArray(session.messages)) {
      console.error('Invalid session:', session);
      return null;
    }
    
    // Combine all messages into text
    const text = session.messages
      .filter(m => m && typeof m.content === 'string')
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n');
    
    if (!text || text.length === 0) {
      console.error('No text extracted from session');
      return {
        sessionId: session.id,
        messageCount: session.messageCount,
        text: '',
        extractedAt: new Date().toISOString(),
        metadata: {
          techMentions: [],
          problemIndicators: [],
          solutionIndicators: [],
          codeSnippetCount: 0,
          hasErrors: false,
          hasSolutions: false
        }
      };
    }
    
    // Extract metadata
    const techMentions = this.extractPattern(text, /\b(Node\.?js|Python|React|Docker|Kubernetes|Redis|PostgreSQL|MongoDB|GraphQL|TypeScript|Go|Rust|AWS|GCP|Azure|Express|Prisma|Telegraf|JWT|Nginx|Linux|Ubuntu|OpenClaw)\b/gi);
    
    const problemIndicators = this.extractPattern(text, /\b(error|bug|issue|crash|fail|problem|exception|timeout|memory leak|deadlock|не работает|ошибка|сбой)\b/gi);
    
    const solutionIndicators = this.extractPattern(text, /\b(fix|solve|workaround|solution|resolved|patch|update|upgrade|refactor|исправлено|решение|готово|работает)\b/gi);
    
    // Extract code snippets
    const codeSnippets = text.match(/```[\s\S]*?```/g) || [];
    
    return {
      sessionId: session.id,
      messageCount: session.messageCount,
      text: text.substring(0, 50000),
      extractedAt: new Date().toISOString(),
      metadata: {
        techMentions: [...new Set(techMentions)],
        problemIndicators: [...new Set(problemIndicators)],
        solutionIndicators: [...new Set(solutionIndicators)],
        codeSnippetCount: codeSnippets.length,
        hasErrors: problemIndicators.length > 0,
        hasSolutions: solutionIndicators.length > 0
      }
    };
  }

  extractPattern(text, regex) {
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[0]);
    }
    return matches;
  }

  async getRecentSessions() {
    const files = await this.findSessionFiles();
    console.log(`Found ${files.length} recent session files`);
    
    const sessions = [];
    for (const file of files.slice(0, 10)) {
      const session = await this.readSession(file.path);
      if (session && session.messageCount > 0) {
        sessions.push(session);
      }
    }
    
    return sessions;
  }

  extractEntities(text) {
    const entities = [];
    
    // Technology entities with context
    const techKeywords = [
      'Node.js', 'Python', 'React', 'Docker', 'Kubernetes', 'Redis', 'PostgreSQL',
      'MongoDB', 'GraphQL', 'TypeScript', 'Go', 'Rust', 'AWS', 'GCP', 'Azure',
      'Express', 'Prisma', 'Telegraf', 'JWT', 'Nginx', 'Linux', 'Ubuntu', 'OpenClaw'
    ];
    
    for (const keyword of techKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        const contextStart = Math.max(0, match.index - 100);
        const contextEnd = Math.min(text.length, match.index + 100);
        const context = text.substring(contextStart, contextEnd).replace(/\n/g, ' ');
        
        entities.push({
          text: keyword,
          type: 'technology',
          context: context,
          position: match.index
        });
      }
    }
    
    // Problem entities
    const problemPattern = /\b(error|bug|issue|crash|fail|problem|exception|timeout|memory leak|deadlock|infinite loop|race condition|ошибка|сбой|не работает)\b/gi;
    let match;
    while ((match = problemPattern.exec(text)) !== null) {
      const context = text.substring(
        Math.max(0, match.index - 100),
        Math.min(text.length, match.index + 100)
      ).replace(/\n/g, ' ');
      
      entities.push({
        text: `Problem: ${match[0]}`,
        type: 'problem',
        context: context,
        position: match.index
      });
    }
    
    // Solution entities
    const solutionPattern = /\b(fix|solve|workaround|solution|resolved|patch|update|upgrade|refactor|optimize|improve|исправлено|решение|готово)\b/gi;
    while ((match = solutionPattern.exec(text)) !== null) {
      const context = text.substring(
        Math.max(0, match.index - 100),
        Math.min(text.length, match.index + 100)
      ).replace(/\n/g, ' ');
      
      entities.push({
        text: `Solution: ${match[0]}`,
        type: 'solution',
        context: context,
        position: match.index
      });
    }
    
    return entities;
  }

  /**
   * NEW: Analyze session for knowledge gaps after processing
   * FIXED: Uses singleton GapDetector for proper deduplication
   */
  async analyzeSessionForGaps(session) {
    try {
      console.log('[OpenClawAdapter] Analyzing session for knowledge gaps...');
      
      // Use singleton instance (preserves pendingTopics/processedTopics)
      const gaps = await this.gapDetector.detect(session);
      
      if (gaps.length > 0) {
        console.log(`[OpenClawAdapter] Detected ${gaps.length} knowledge gaps:`);
        gaps.forEach((gap, i) => {
          console.log(`  ${i + 1}. ${gap.topic} (confidence: ${gap.confidence.toFixed(2)})`);
        });
        
        // Add gaps to learning queue
        const { added, skipped } = await this.gapDetector.addGapsToQueue(gaps, 'high');
        
        console.log(`[OpenClawAdapter] Added ${added.length} topics to queue, skipped ${skipped.length}`);
        
        return {
          detected: gaps.length,
          added: added.length,
          skipped: skipped.length,
          gaps: gaps
        };
      }
      
      return { detected: 0, added: 0, skipped: 0, gaps: [] };
      
    } catch (error) {
      console.error('[OpenClawAdapter] Gap analysis failed:', error.message);
      return { detected: 0, added: 0, skipped: 0, error: error.message };
    }
  }
}

// Test with real sessions
if (require.main === module) {
  const adapter = new OpenClawAdapter({ hours: 24 });
  
  adapter.getRecentSessions().then(sessions => {
    console.log(`\n📁 Found ${sessions.length} sessions with messages\n`);
    
    let totalEntities = 0;
    
    sessions.forEach((session, i) => {
      console.log(`${i + 1}. Session: ${session.id}`);
      console.log(`   Path: ${session.path}`);
      console.log(`   Messages: ${session.messageCount}`);
      console.log(`   Last modified: ${session.lastModified}`);
      
      const knowledge = adapter.extractKnowledge(session);
      console.log(`   Tech mentions: ${knowledge.metadata?.techMentions?.slice(0, 5).join(', ') || 'none'}`);
      console.log(`   Problems: ${knowledge.metadata?.problemIndicators?.length || 0}`);
      console.log(`   Solutions: ${knowledge.metadata?.solutionIndicators?.length || 0}`);
      console.log(`   Code snippets: ${knowledge.metadata?.codeSnippetCount || 0}`);
      
      const entities = adapter.extractEntities(knowledge.text);
      console.log(`   Extracted entities: ${entities.length}`);
      
      if (entities.length > 0) {
        entities.slice(0, 3).forEach((e, j) => {
          console.log(`      ${j + 1}. [${e.type}] ${e.text}`);
        });
      }
      
      totalEntities += entities.length;
      console.log();
    });
    
    console.log(`✅ Total: ${sessions.length} sessions, ${totalEntities} entities extracted`);
  }).catch(console.error);
}

module.exports = OpenClawAdapter;