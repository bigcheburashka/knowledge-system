/**
 * Intent Detector
 * Detects learning intentions in conversations and auto-adds topics to queue
 */

const fs = require('fs').promises;
const path = require('path');

class IntentDetector {
  constructor(options = {}) {
    this.customTopicsPath = options.customTopicsPath || 
      '/root/.openclaw/workspace/knowledge-system/custom-topics.json';
    
    // Patterns that indicate learning intent
    this.intentPatterns = [
      // Russian patterns
      /хочу (?:глубоко |подробно )?(?:изучить|разобраться|погрузиться|понять|освоить)/i,
      /нужно (?:глубоко |подробно )?(?:изучить|разобраться|погрузиться|понять|освоить)/i,
      /давай (?:глубоко |подробно )?(?:изучим|разберемся|погрузимся)/i,
      /(?:сделай|сделаем) deep dive/i,
      /(?:сделай|сделаем) (?:глубокий )?анализ/i,
      /прикрути(?:м)? ([^,\.]+)/i,  // "прикрутим X" → suggests learning X
      /настро(?:й|им) ([^,\.]+)/i,  // "настрой X" → suggests learning X
      /оптимизиру(?:й|ем) ([^,\.]+)/i,  // "оптимизируй X"
      /добавь (?:поддержку|интеграцию|фичу) ([^,\.]+)/i,
      /разберись с ([^,\.]+)/i,
      /разобраться с ([^,\.]+)/i,
      
      // English patterns
      /want to (?:deep )?(?:learn|study|understand|master|dive into)/i,
      /need to (?:deep )?(?:learn|study|understand|master)/i,
      /let's (?:deep )?(?:learn|study|dive into|explore)/i,
      /do a deep dive (?:into )?([^,\.]+)/i,
      /add (?:support|integration|feature) (?:for )?([^,\.]+)/i,
      /figure out ([^,\.]+)/i,
      /understand how ([^,\.]+) works/i,
      /learn (?:about )?([^,\.]+)/i,
    ];
    
    // Confidence threshold for gap analysis
    this.confidenceThreshold = 0.7;
  }

  /**
   * Analyze message for learning intent
   */
  async analyzeMessage(message, context = {}) {
    const intents = [];
    
    // Check for explicit learning intents
    for (const pattern of this.intentPatterns) {
      const match = message.match(pattern);
      if (match) {
        // Extract topic from capture group or full match
        const topic = match[1] || match[0];
        const cleanTopic = this.cleanTopic(topic);
        
        intents.push({
          type: 'explicit_learning_intent',
          pattern: pattern.source,
          topic: cleanTopic,
          confidence: 0.9,
          priority: 'high',
          raw: match[0]
        });
      }
    }
    
    // Check for implicit learning needs (uncertainty)
    if (context.uncertaintyIndicators) {
      for (const indicator of context.uncertaintyIndicators) {
        if (this.matchesUncertainty(message, indicator)) {
          intents.push({
            type: 'implicit_learning_need',
            topic: indicator.topic,
            confidence: 0.6,
            priority: 'medium',
            reason: indicator.reason
          });
        }
      }
    }
    
    // Check for repeated mentions (frequency-based)
    if (context.repeatedTopics) {
      for (const topic of context.repeatedTopics) {
        if (topic.count >= 3) {
          intents.push({
            type: 'frequency_based_suggestion',
            topic: topic.name,
            confidence: 0.7,
            priority: 'medium',
            mentions: topic.count
          });
        }
      }
    }
    
    return intents;
  }

  /**
   * Clean and normalize topic name
   */
  cleanTopic(topic) {
    return topic
      .toLowerCase()
      .replace(/^(?:хочу|нужно|давай|сделай|разберись|изучить|погрузиться|learn|study|understand)\s+/i, '')
      .replace(/^(?:в|с|о|об|про|для|на)\s+/i, '')
      .replace(/[\.\,\!\?]$/, '')
      .trim()
      .substring(0, 100); // Limit length
  }

  /**
   * Check if message matches uncertainty pattern
   */
  matchesUncertainty(message, indicator) {
    const patterns = [
      new RegExp(`не (?:знаю|понимаю|уверен) (?:про|о|об|в)?\\s*${indicator.topic}`, 'i'),
      new RegExp(`(?:слабо|плохо) (?:знаю|понимаю) (?:про|о|об|в)?\\s*${indicator.topic}`, 'i'),
      new RegExp(`нужно разобраться (?:с|в|про)?\\s*${indicator.topic}`, 'i'),
    ];
    
    return patterns.some(p => p.test(message));
  }

  /**
   * Add topic to custom topics queue
   */
  async addToLearningQueue(intent) {
    try {
      // Load existing topics
      let data = { topics: [] };
      try {
        const content = await fs.readFile(this.customTopicsPath, 'utf8');
        data = JSON.parse(content);
      } catch {
        // File doesn't exist or invalid, start fresh
      }
      
      // Check if already exists
      const exists = data.topics.some(t => 
        t.name.toLowerCase() === intent.topic.toLowerCase()
      );
      
      if (exists) {
        console.log(`[IntentDetector] Topic already exists: ${intent.topic}`);
        return { added: false, reason: 'already_exists' };
      }
      
      // Create topic entry
      const topic = {
        name: intent.topic,
        type: this.determineTopicType(intent),
        priority: intent.priority,
        addedAt: new Date().toISOString(),
        addedBy: 'intent-detector',
        source: intent.type,
        confidence: intent.confidence,
        description: this.generateDescription(intent)
      };
      
      // Add to list
      data.topics.push(topic);
      
      // Save
      await fs.writeFile(
        this.customTopicsPath,
        JSON.stringify(data, null, 2)
      );
      
      console.log(`[IntentDetector] Added topic to queue: ${topic.name}`);
      
      return { added: true, topic };
      
    } catch (err) {
      console.error('[IntentDetector] Error adding topic:', err.message);
      return { added: false, error: err.message };
    }
  }

  /**
   * Determine topic type based on intent
   */
  determineTopicType(intent) {
    const typePatterns = {
      technology: /(?:kubernetes|docker|react|node|python|rust|go|java|sql|database|api|framework|library)/i,
      pattern: /(?:pattern|architect|design|structure|approach|methodology)/i,
      problem: /(?:problem|issue|bug|error|fix|debug|troubleshoot)/i,
      solution: /(?:solution|implementation|setup|configur|deployment)/i
    };
    
    for (const [type, pattern] of Object.entries(typePatterns)) {
      if (pattern.test(intent.topic)) {
        return type;
      }
    }
    
    return 'technology'; // Default
  }

  /**
   * Generate description for the topic
   */
  generateDescription(intent) {
    if (intent.type === 'explicit_learning_intent') {
      return `Auto-added from intent: "${intent.raw}"`;
    }
    if (intent.type === 'implicit_learning_need') {
      return `Detected uncertainty: ${intent.reason}`;
    }
    if (intent.type === 'frequency_based_suggestion') {
      return `Frequently mentioned (${intent.mentions} times)`;
    }
    return 'Auto-detected learning topic';
  }

  /**
   * Check if I should express uncertainty (Gap Analysis)
   */
  shouldExpressUncertainty(confidence, context = {}) {
    // If confidence is low and it's a technical question
    if (confidence < this.confidenceThreshold) {
      // Check if it's a technical topic we should know
      const technicalIndicators = [
        /\b(kubernetes|docker|react|node|python|rust|go|java|sql|database|api|framework|library|architecture|pattern|algorithm)\b/i,
        /\b(optimization|performance|security|deployment|testing|debugging|refactoring)\b/i,
        /\b(microservices|event-driven|serverless|graphql|rest|grpc)\b/i
      ];
      
      const isTechnical = technicalIndicators.some(p => 
        p.test(context.query || '')
      );
      
      if (isTechnical) {
        return {
          should: true,
          confidence,
          suggestion: `Мне нужно изучить эту тему глубже для более точного ответа`
        };
      }
    }
    
    return { should: false };
  }

  /**
   * Main entry point: process conversation
   */
  async processConversation(messages, context = {}) {
    const allIntents = [];
    
    for (const message of messages) {
      const intents = await this.analyzeMessage(message.content || message, {
        ...context,
        uncertaintyIndicators: context.uncertaintyIndicators || [],
        repeatedTopics: context.repeatedTopics || []
      });
      
      allIntents.push(...intents);
    }
    
    // Remove duplicates
    const uniqueIntents = this.deduplicateIntents(allIntents);
    
    // Add to queue
    const results = [];
    for (const intent of uniqueIntents) {
      if (intent.confidence >= 0.6) { // Only high-confidence intents
        const result = await this.addToLearningQueue(intent);
        results.push({ intent, result });
      }
    }
    
    return {
      intentsFound: uniqueIntents.length,
      added: results.filter(r => r.result.added).length,
      details: results
    };
  }

  /**
   * Remove duplicate intents
   */
  deduplicateIntents(intents) {
    const seen = new Set();
    return intents.filter(intent => {
      const key = intent.topic.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}

// CLI usage
if (require.main === module) {
  const detector = new IntentDetector();
  
  // Test with sample messages
  const testMessages = [
    'Хочу изучить Kubernetes',
    'Нужно разобраться с GraphQL',
    "Давай сделаем deep dive в микросервисы",
    "Прикрутим кэширование Redis",
    "I want to learn Rust programming"
  ];
  
  detector.processConversation(testMessages.map(m => ({ content: m })))
    .then(results => {
      console.log('\n=== Intent Detection Results ===');
      console.log(`Found: ${results.intentsFound} intents`);
      console.log(`Added: ${results.added} topics`);
      console.log('\nDetails:');
      results.details.forEach(d => {
        console.log(`  ${d.intent.topic} (${d.result.added ? '✅ added' : '❌ ' + d.result.reason})`);
      });
    })
    .catch(console.error);
}

module.exports = { IntentDetector };
