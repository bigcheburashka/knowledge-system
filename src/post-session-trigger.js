/**
 * Post-Session Learning Trigger
 * Analyzes completed sessions and suggests learning topics
 */

const { IntentDetector } = require('./intent-detector');
const fs = require('fs').promises;
const path = require('path');

class PostSessionLearningTrigger {
  constructor(options = {}) {
    this.intentDetector = new IntentDetector(options);
    this.logPath = options.logPath || '/var/log/knowledge/post-session-trigger.log';
    this.minComplexityScore = 5; // Minimum to trigger analysis
    this.minUncertaintyRatio = 0.2; // 20% uncertain responses
  }

  /**
   * Analyze a completed session
   */
  async analyzeSession(session) {
    console.log('[PostSessionTrigger] Analyzing session:', session.id || 'unknown');
    
    const analysis = {
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      complexity: this.calculateComplexity(session),
      uncertainties: this.findUncertainties(session),
      techMentions: this.findTechMentions(session),
      knowledgeGaps: [],
      suggestedTopics: []
    };
    
    // Only process complex sessions
    if (analysis.complexity.score < this.minComplexityScore) {
      console.log('[PostSessionTrigger] Session too simple, skipping');
      return { ...analysis, skipped: true, reason: 'low_complexity' };
    }
    
    // Find knowledge gaps
    analysis.knowledgeGaps = await this.identifyKnowledgeGaps(session);
    
    // Find learning intents
    const intentResults = await this.intentDetector.processConversation(
      session.messages || [],
      {
        uncertaintyIndicators: analysis.uncertainties,
        repeatedTopics: analysis.techMentions.filter(t => t.count >= 2)
      }
    );
    
    analysis.suggestedTopics = intentResults.details
      .filter(d => d.result.added)
      .map(d => ({
        name: d.intent.topic,
        confidence: d.intent.confidence,
        source: d.intent.type
      }));
    
    // Add topics from knowledge gaps
    for (const gap of analysis.knowledgeGaps) {
      const result = await this.intentDetector.addToLearningQueue({
        type: 'knowledge_gap',
        topic: gap.topic,
        confidence: gap.confidence,
        priority: 'high',
        reason: gap.reason
      });
      
      if (result.added) {
        analysis.suggestedTopics.push({
          name: gap.topic,
          confidence: gap.confidence,
          source: 'knowledge_gap'
        });
      }
    }
    
    // Log the analysis
    await this.logAnalysis(analysis);
    
    // Send notification if topics suggested
    if (analysis.suggestedTopics.length > 0) {
      await this.notifyUser(analysis);
    }
    
    return analysis;
  }

  /**
   * Calculate session complexity
   */
  calculateComplexity(session) {
    const messages = session.messages || [];
    
    let score = 0;
    let technicalTerms = 0;
    let problemIndicators = 0;
    let codeBlocks = 0;
    
    const technicalPatterns = [
      /\b(api|endpoint|service|database|cache|queue|worker|microservice|container|pod|deployment)\b/gi,
      /\b(architecture|pattern|algorithm|data structure|optimization|performance)\b/gi,
      /\b(react|vue|angular|node|python|go|rust|java|kotlin|swift)\b/gi,
      /\b(docker|kubernetes|terraform|ansible|jenkins|github actions)\b/gi
    ];
    
    const problemPatterns = [
      /\b(error|exception|crash|bug|issue|problem|fail|timeout|memory leak)\b/gi,
      /\b(slow|bottleneck|deadlock|race condition|conflict)\b/gi
    ];
    
    for (const msg of messages) {
      const text = msg.content || msg;
      
      // Count technical terms
      technicalPatterns.forEach(p => {
        const matches = text.match(p);
        if (matches) technicalTerms += matches.length;
      });
      
      // Count problem indicators
      problemPatterns.forEach(p => {
        const matches = text.match(p);
        if (matches) problemIndicators += matches.length;
      });
      
      // Count code blocks
      codeBlocks += (text.match(/```/g) || []).length / 2;
      
      // Message length contributes to complexity
      if (text.length > 500) score += 1;
      if (text.length > 1000) score += 2;
    }
    
    score += technicalTerms * 0.5;
    score += problemIndicators;
    score += codeBlocks * 2;
    score += messages.length * 0.1;
    
    return {
      score: Math.round(score),
      technicalTerms,
      problemIndicators,
      codeBlocks,
      messageCount: messages.length
    };
  }

  /**
   * Find uncertain responses in session
   */
  findUncertainties(session) {
    const uncertainties = [];
    const messages = session.messages || [];
    
    const uncertaintyPatterns = [
      /не (?:уверен|знаю|помню|понимаю)/i,
      /(?:слабо|плохо) (?:знаю|понимаю|разбираюсь)/i,
      /нужно (?:будет )?(?:изучить|разобраться|проверить)/i,
      /(?:вероятно|возможно|наверное|кажется)/i,
      /i (?:don't know|not sure|uncertain|think|believe)/i,
      /need to (?:check|verify|research|look into)/i
    ];
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const text = msg.content || msg;
      
      for (const pattern of uncertaintyPatterns) {
        if (pattern.test(text)) {
          // Try to extract topic from context
          const context = this.extractContext(messages, i);
          
          uncertainties.push({
            messageIndex: i,
            pattern: pattern.source,
            context: context.substring(0, 200),
            topic: this.guessTopicFromContext(context)
          });
          break;
        }
      }
    }
    
    return uncertainties;
  }

  /**
   * Find technology mentions
   */
  findTechMentions(session) {
    const mentions = {};
    const messages = session.messages || [];
    
    const techPattern = /\b(kubernetes|docker|react|vue|angular|node\.?js|python|rust|go|java|kotlin|swift|typescript|javascript|postgresql|mysql|redis|mongodb|elasticsearch|kafka|rabbitmq|graphql|rest|grpc|aws|gcp|azure|terraform|ansible|jenkins|github|gitlab|prometheus|grafana)\b/gi;
    
    for (const msg of messages) {
      const text = msg.content || msg;
      let match;
      
      while ((match = techPattern.exec(text)) !== null) {
        const tech = match[0].toLowerCase();
        mentions[tech] = (mentions[tech] || 0) + 1;
      }
    }
    
    return Object.entries(mentions)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Identify knowledge gaps
   */
  async identifyKnowledgeGaps(session) {
    const gaps = [];
    const uncertainties = this.findUncertainties(session);
    
    // Group uncertainties by topic
    const topicMap = new Map();
    
    for (const u of uncertainties) {
      if (u.topic) {
        const existing = topicMap.get(u.topic) || { count: 0, contexts: [] };
        existing.count++;
        existing.contexts.push(u.context);
        topicMap.set(u.topic, existing);
      }
    }
    
    // Create gap entries for frequently uncertain topics
    for (const [topic, data] of topicMap) {
      if (data.count >= 2) { // Multiple uncertainties about same topic
        gaps.push({
          topic,
          confidence: Math.min(0.9, 0.5 + data.count * 0.1),
          reason: `Multiple uncertainties (${data.count} times): ${data.contexts[0].substring(0, 100)}...`
        });
      }
    }
    
    return gaps;
  }

  /**
   * Extract context around message
   */
  extractContext(messages, index, window = 2) {
    const start = Math.max(0, index - window);
    const end = Math.min(messages.length, index + window + 1);
    
    return messages
      .slice(start, end)
      .map(m => m.content || m)
      .join('\n');
  }

  /**
   * Guess topic from context
   */
  guessTopicFromContext(context) {
    // Look for "about X", "regarding X", etc.
    const patterns = [
      /(?:про|о|об|на тему|касательно|насч[её]т)\s+([\w\s]+?)(?:\.|,|$)/i,
      /(?:about|regarding|concerning|on)\s+([\w\s]+?)(?:\.|,|$)/i
    ];
    
    for (const pattern of patterns) {
      const match = context.match(pattern);
      if (match) {
        return match[1].trim().substring(0, 50);
      }
    }
    
    return null;
  }

  /**
   * Log analysis results
   */
  async logAnalysis(analysis) {
    const entry = {
      timestamp: new Date().toISOString(),
      ...analysis
    };
    
    try {
      await fs.appendFile(
        this.logPath,
        JSON.stringify(entry) + '\n'
      );
    } catch (err) {
      console.error('[PostSessionTrigger] Log error:', err.message);
    }
  }

  /**
   * Notify user about suggested topics
   */
  async notifyUser(analysis) {
    // Send via Telegram Bot
    try {
      const { EvolutionTelegramBot } = require('./telegram-bot');
      const bot = new EvolutionTelegramBot();
      await bot.init();
      
      const result = await bot.sendLearningSuggestions(analysis.suggestedTopics);
      
      if (result.sent) {
        console.log(`[PostSessionTrigger] Telegram notification sent: ${result.count} topics`);
      } else {
        console.warn('[PostSessionTrigger] Failed to send Telegram notification:', result.error);
      }
    } catch (err) {
      console.error('[PostSessionTrigger] Telegram notification error:', err.message);
    }
  }

  /**
   * Run on recent sessions
   */
  async run(options = {}) {
    const hoursBack = options.hours || 24;
    
    console.log(`[PostSessionTrigger] Analyzing sessions from last ${hoursBack} hours`);
    
    // Load actual sessions from OpenClaw
    const { getPathResolver } = require('../path-resolver');
    const pathResolver = getPathResolver();
    const sessionsDir = pathResolver.get('external.sessions');
    
    try {
      const fs = require('fs').promises;
      const path = require('path');
      
      // Get recent session files
      const files = await fs.readdir(sessionsDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      
      const cutoff = Date.now() - (hoursBack * 60 * 60 * 1000);
      const recentFiles = [];
      
      for (const file of jsonlFiles) {
        const stat = await fs.stat(path.join(sessionsDir, file));
        if (stat.mtimeMs > cutoff) {
          recentFiles.push({
            name: file,
            path: path.join(sessionsDir, file),
            mtime: stat.mtime
          });
        }
      }
      
      // Sort by modification time (newest first)
      recentFiles.sort((a, b) => b.mtime - a.mtime);
      
      console.log(`[PostSessionTrigger] Found ${recentFiles.length} recent sessions`);
      
      let totalAnalyzed = 0;
      let totalSuggestions = 0;
      
      // Analyze each session
      for (const fileInfo of recentFiles.slice(0, 10)) { // Limit to 10 sessions
        try {
          const content = await fs.readFile(fileInfo.path, 'utf8');
          const lines = content.split('\n').filter(l => l.trim());
          
          const messages = [];
          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              if (msg.type === 'message' && msg.message) {
                messages.push({
                  role: msg.message.role,
                  content: typeof msg.message.content === 'string' 
                    ? msg.message.content 
                    : JSON.stringify(msg.message.content),
                  timestamp: msg.timestamp
                });
              }
            } catch {
              // Skip malformed lines
            }
          }
          
          if (messages.length > 0) {
            const session = {
              id: fileInfo.name.replace('.jsonl', ''),
              path: fileInfo.path,
              messages: messages
            };
            
            const analysis = await this.analyzeSession(session);
            
            if (analysis.suggestedTopics && analysis.suggestedTopics.length > 0) {
              totalAnalyzed++;
              totalSuggestions += analysis.suggestedTopics.length;
              
              // Notify user
              await this.notifyUser(analysis);
            }
          }
        } catch (err) {
          console.error(`[PostSessionTrigger] Error analyzing ${fileInfo.name}:`, err.message);
        }
      }
      
      console.log(`[PostSessionTrigger] Analysis complete: ${totalAnalyzed} sessions, ${totalSuggestions} suggestions`);
      
      return {
        analyzed: totalAnalyzed,
        suggested: totalSuggestions,
        filesProcessed: recentFiles.length
      };
      
    } catch (err) {
      console.error('[PostSessionTrigger] Failed to load sessions:', err.message);
      return {
        analyzed: 0,
        suggested: 0,
        error: err.message
      };
    }
  }
}

// CLI usage
if (require.main === module) {
  const trigger = new PostSessionLearningTrigger();
  
  // Test with sample session
  const testSession = {
    id: 'test-session-123',
    messages: [
      { content: 'Как настроить Kubernetes?', role: 'user' },
      { content: 'Мне нужно изучить это глубже для точного ответа', role: 'assistant' },
      { content: 'Хочу разобраться с Helm charts', role: 'user' },
      { content: 'Kubernetes - это оркестратор контейнеров', role: 'assistant' }
    ]
  };
  
  trigger.analyzeSession(testSession)
    .then(results => {
      console.log('\n=== Post-Session Analysis ===');
      console.log('Complexity:', results.complexity);
      console.log('Uncertainties:', results.uncertainties.length);
      console.log('Suggested topics:', results.suggestedTopics);
    })
    .catch(console.error);
}

module.exports = { PostSessionLearningTrigger };
