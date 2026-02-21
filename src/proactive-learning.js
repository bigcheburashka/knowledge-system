/**
 * Proactive Learning System
 * Integrates Intent Detection, Gap Analysis, and Post-Session Triggers
 */

const { IntentDetector } = require('./intent-detector');
const { PostSessionLearningTrigger } = require('./post-session-trigger');
const { LearningLog } = require('./evolution/learning-log');

class ProactiveLearning {
  constructor(options = {}) {
    this.intentDetector = new IntentDetector(options);
    this.sessionTrigger = new PostSessionLearningTrigger(options);
    this.log = new LearningLog(options);
    
    // Confidence thresholds
    this.gapThreshold = options.gapThreshold || 0.7;
  }

  async init() {
    await this.log.init();
    console.log('[ProactiveLearning] Initialized');
  }

  /**
   * Main entry: Process conversation in real-time
   * Called after each assistant response
   */
  async processConversation(messages, context = {}) {
    console.log('[ProactiveLearning] Processing conversation...');
    
    const results = {
      intentsDetected: 0,
      topicsAdded: 0,
      gapsIdentified: 0,
      suggestions: []
    };
    
    // 1. Detect learning intents
    const intentResults = await this.intentDetector.processConversation(messages, context);
    results.intentsDetected = intentResults.intentsFound;
    results.topicsAdded = intentResults.added;
    
    // 2. Check for knowledge gaps (if confidence provided)
    if (context.confidence !== undefined && context.confidence < this.gapThreshold) {
      const gapSuggestion = await this.handleKnowledgeGap(context);
      if (gapSuggestion) {
        results.gapsIdentified = 1;
        results.suggestions.push(gapSuggestion);
      }
    }
    
    // 3. Log activity
    if (results.intentsDetected > 0 || results.gapsIdentified > 0) {
      await this.log.record({
        type: 'proactive_learning_triggered',
        intentsDetected: results.intentsDetected,
        topicsAdded: results.topicsAdded,
        gapsIdentified: results.gapsIdentified
      });
    }
    
    return results;
  }

  /**
   * Handle identified knowledge gap
   */
  async handleKnowledgeGap(context) {
    const topic = this.extractTopicFromContext(context);
    
    if (!topic) {
      return null;
    }
    
    const result = await this.intentDetector.addToLearningQueue({
      type: 'knowledge_gap',
      topic: topic,
      confidence: context.confidence || 0.6,
      priority: 'high',
      reason: `Low confidence (${Math.round(context.confidence * 100)}%) on query: ${context.query?.substring(0, 100)}`
    });
    
    if (result.added) {
      return {
        type: 'knowledge_gap',
        topic: topic,
        message: `Я добавил "${topic}" в очередь на изучение, так как мне нужно разобраться в этом лучше для качественного ответа.`
      };
    }
    
    return null;
  }

  /**
   * Extract topic from query context
   */
  extractTopicFromContext(context) {
    const query = context.query || '';
    
    // Remove question words
    const cleaned = query
      .replace(/^(?:как|что|почему|зачем|где|когда|кто|чей|какой|который)\s+/i, '')
      .replace(/^(?:how|what|why|where|when|who|which)\s+/i, '')
      .replace(/\?$/g, '')
      .trim();
    
    // Take first 2-3 words as topic
    const words = cleaned.split(/\s+/);
    if (words.length >= 2) {
      return words.slice(0, 3).join(' ');
    }
    
    return cleaned.substring(0, 50);
  }

  /**
   * Get suggested response when knowledge gap detected
   */
  async getGapResponse(context) {
    const suggestion = await this.handleKnowledgeGap(context);
    
    if (suggestion) {
      return {
        shouldInform: true,
        message: suggestion.message,
        topic: suggestion.topic
      };
    }
    
    return { shouldInform: false };
  }

  /**
   * Daily summary of proactive learning
   */
  async getDailySummary() {
    const recent = await this.log.getRecent(1);
    
    const triggers = recent.filter(r => r.type === 'proactive_learning_triggered');
    
    return {
      totalTriggers: triggers.length,
      totalTopicsAdded: triggers.reduce((sum, t) => sum + (t.topicsAdded || 0), 0),
      totalGapsIdentified: triggers.reduce((sum, t) => sum + (t.gapsIdentified || 0), 0)
    };
  }
}

// Export for use in other modules
module.exports = { ProactiveLearning };

// CLI test
if (require.main === module) {
  const proactive = new ProactiveLearning();
  
  proactive.init().then(() => {
    // Test with sample conversation
    const messages = [
      { content: 'Хочу изучить Kubernetes', role: 'user' },
      { content: 'Давай разберёмся с микросервисами', role: 'user' }
    ];
    
    return proactive.processConversation(messages, {
      query: 'как настроить kubernetes',
      confidence: 0.5  // Low confidence - should trigger gap
    });
  }).then(results => {
    console.log('\n=== Proactive Learning Results ===');
    console.log(results);
  }).catch(console.error);
}
