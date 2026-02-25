/**
 * Gap Detector - MVP Version
 * Detects knowledge gaps based on low confidence search results
 * Uses adaptive thresholds based on query complexity
 */

const { knowledgeSearch } = require('./knowledge-search');
const fs = require('fs').promises;
const path = require('path');

const TOPICS_PATH = path.join(__dirname, '..', 'custom-topics.json');

class GapDetector {
  constructor() {
    // Adaptive thresholds based on pre-mortem analysis
    this.thresholds = {
      simple: 0.75,   // For short/simple queries
      complex: 0.45   // For complex/technical queries
    };
    
    // FIXED: In-memory deduplication to prevent race conditions
    this.pendingTopics = new Set();
    this.processedTopics = new Set();
    
    // Stopwords for topic extraction
    this.stopwords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
      'of', 'with', 'by', 'does', 'how', 'what', 'why', 'when', 'where', 
      'who', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 
      'has', 'had', 'do', 'did', 'will', 'would', 'could', 'should'
    ]);
  }

  /**
   * Main entry point: analyze session for knowledge gaps
   */
  async detect(session) {
    const gaps = [];
    
    if (!session || !session.messages) {
      return gaps;
    }
    
    for (const msg of session.messages) {
      if (msg.role !== 'user') continue;
      
      const gap = await this.analyzeMessage(msg.content);
      if (gap) {
        gaps.push(gap);
      }
    }
    
    return gaps;
  }

  /**
   * Analyze single message for knowledge gaps
   * FIXED: Handle empty KB and errors gracefully
   */
  async analyzeMessage(content) {
    // Skip very short messages
    if (!content || content.length < 10) {
      return null;
    }
    
    // Truncate very long messages for analysis
    const analysisContent = content.length > 1000 
      ? content.substring(0, 1000) + '...' 
      : content;
    
    // Assess complexity
    const complexity = this.assessComplexity(analysisContent);
    const threshold = this.thresholds[complexity];
    
    // Search knowledge base
    const knowledge = await this.searchKnowledge(analysisContent);
    
    // FIXED: Handle errors and empty results gracefully
    if (knowledge.error) {
      console.log('[GapDetector] Search failed, skipping gap detection');
      return null;
    }
    
    // Don't flag as gap if KB is empty or unavailable
    if (knowledge.resultCount === 0) {
      return null;
    }
    
    // Check if confidence is below threshold
    if (knowledge.confidence < threshold) {
      return {
        topic: this.extractTopic(analysisContent),
        originalQuery: content.substring(0, 200),
        confidence: knowledge.confidence,
        threshold: threshold,
        complexity: complexity,
        reason: `Low confidence: ${knowledge.confidence.toFixed(2)} < ${threshold}`,
        detectedAt: new Date().toISOString()
      };
    }
    
    return null;
  }

  /**
   * Assess query complexity
   * FIXED: Better detection with technical terms
   * Simple: short, no technical terms, basic questions
   * Complex: long, technical terms, comparative/analysis
   */
  assessComplexity(text) {
    const wordCount = text.split(/\s+/).length;
    const lower = text.toLowerCase();
    
    // Technical terms that indicate complexity regardless of length
    const techTerms = [
      'kubernetes', 'docker', 'aws', 'terraform', 'microservice', 
      'algorithm', 'database', 'api', 'async', 'concurrency',
      'architecture', 'implementation', 'optimization', 'configuration',
      'postgresql', 'redis', 'mongodb', 'react', 'nodejs'
    ];
    const hasTechTerms = techTerms.some(t => lower.includes(t));
    
    // Complex indicators
    const complexIndicators = [
      /\b(how to|how does|explain|compare|difference between|pros and cons)\b/i,
      /\b(architecture|implementation|optimization|configuration)\b/i,
      /\b(vs|versus|compared to|alternative)\b/i,
      /\?.*\?/  // Multiple questions
    ];
    
    const hasComplexIndicators = complexIndicators.some(pattern => 
      pattern.test(text)
    );
    
    // Simple: short AND no tech terms AND no complex indicators
    if (wordCount < 8 && !hasTechTerms && !hasComplexIndicators) {
      return 'simple';
    }
    
    return 'complex';
  }

  /**
   * Search knowledge base with exact match priority
   * FIXED: Parse relevance string "85.5%" to float
   */
  async searchKnowledge(query) {
    try {
      // Use existing knowledge search
      const KnowledgeSearchTool = require('./knowledge-search');
      const searchTool = new KnowledgeSearchTool();
      const response = await searchTool.search(query, { limit: 5 });
      
      if (!response.results || response.results.length === 0) {
        return { confidence: 0, results: [], resultCount: 0 };
      }
      
      // Parse relevance string "85.5%" → 0.855
      const topResult = response.results[0];
      const relevanceStr = topResult.relevance || '0%';
      const confidence = parseFloat(relevanceStr.replace('%', '')) / 100;
      
      return {
        confidence: confidence,
        results: response.results,
        resultCount: response.results.length,
        topResult: topResult
      };
    } catch (error) {
      console.error('[GapDetector] Search error:', error.message);
      return { confidence: 0, results: [], resultCount: 0, error: error.message };
    }
  }

  /**
   * Extract topic name from query
   * FIXED: Remove stopwords, handle punctuation better
   */
  extractTopic(query) {
    // Remove common question words and punctuation
    let cleaned = query
      .toLowerCase()
      .replace(/[\?\.,!;:'"]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Split and filter stopwords
    const words = cleaned.split(/\s+/).filter(w => {
      return w.length > 2 && !this.stopwords.has(w.toLowerCase());
    });
    
    // Take first 3 significant words
    const significantWords = words.slice(0, 3);
    
    // Capitalize each word
    const topic = significantWords
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    
    return topic || 'Unknown Topic';
  }

  /**
   * Add detected gaps to learning queue with deduplication
   */
  async addGapsToQueue(gaps, priority = 'medium') {
    const added = [];
    const skipped = [];
    
    for (const gap of gaps) {
      const result = await this.addToQueue(gap.topic, priority, gap.reason);
      if (result.added) {
        added.push(gap.topic);
      } else {
        skipped.push({ topic: gap.topic, reason: result.reason });
      }
    }
    
    return { added, skipped };
  }

  /**
   * Add single topic to queue with deduplication check
   * FIXED: Use in-memory Sets to prevent race conditions
   */
  async addToQueue(topicName, priority, reason) {
    const normalizedName = topicName.toLowerCase();
    
    // Check in-memory Sets first (atomic, no race condition)
    if (this.pendingTopics.has(normalizedName)) {
      return { added: false, reason: 'already_pending' };
    }
    
    if (this.processedTopics.has(normalizedName)) {
      return { added: false, reason: 'already_processed' };
    }
    
    try {
      // Check persistent queue
      const existsInQueue = await this.checkQueue(topicName);
      if (existsInQueue) {
        this.pendingTopics.add(normalizedName);
        return { added: false, reason: 'already_in_queue' };
      }
      
      // Add to in-memory pending
      this.pendingTopics.add(normalizedName);
      
      // Load current topics
      let data;
      try {
        const content = await fs.readFile(TOPICS_PATH, 'utf8');
        data = JSON.parse(content);
      } catch {
        data = { topics: [] };
      }
      
      // Add new topic
      data.topics.push({
        name: topicName,
        type: 'technology',
        priority: priority,
        source: 'gap-detector',
        reason: reason,
        addedAt: new Date().toISOString()
      });
      
      // Save
      await fs.writeFile(TOPICS_PATH, JSON.stringify(data, null, 2));
      
      // Move from pending to processed
      this.pendingTopics.delete(normalizedName);
      this.processedTopics.add(normalizedName);
      
      console.log(`[GapDetector] Added to queue: ${topicName}`);
      return { added: true };
      
    } catch (error) {
      // Remove from pending on error
      this.pendingTopics.delete(normalizedName);
      console.error(`[GapDetector] Error adding to queue:`, error.message);
      return { added: false, reason: 'error', error: error.message };
    }
  }

  /**
   * Check if topic already exists in queue
   */
  async checkQueue(topicName) {
    try {
      const content = await fs.readFile(TOPICS_PATH, 'utf8');
      const data = JSON.parse(content);
      
      return data.topics.some(t => 
        t.name.toLowerCase() === topicName.toLowerCase()
      );
    } catch {
      return false;
    }
  }

  /**
   * Get detector statistics
   */
  getStats() {
    return {
      thresholds: this.thresholds,
      pendingCount: this.pendingTopics.size,
      processedCount: this.processedTopics.size,
      version: '1.0.1-mvp-fixed'
    };
  }
}

module.exports = { GapDetector };

// CLI for testing
if (require.main === module) {
  const detector = new GapDetector();
  
  // Test with sample session
  const testSession = {
    messages: [
      { role: 'user', content: 'How does quantum computing work?' }
    ]
  };
  
  detector.detect(testSession).then(gaps => {
    console.log('\n🧪 Gap Detector Test Results:\n');
    console.log(`Detected ${gaps.length} gaps:`);
    gaps.forEach((gap, i) => {
      console.log(`\n${i + 1}. ${gap.topic}`);
      console.log(`   Confidence: ${gap.confidence.toFixed(2)}`);
      console.log(`   Threshold: ${gap.threshold}`);
      console.log(`   Complexity: ${gap.complexity}`);
      console.log(`   Reason: ${gap.reason}`);
    });
  }).catch(console.error);
}
