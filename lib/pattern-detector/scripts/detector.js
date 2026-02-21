/**
 * Pattern Detector
 * Detects recurring patterns in system behavior
 */

class PatternDetector {
  constructor(options = {}) {
    this.minOccurrences = options.minOccurrences || 2;
    this.lookbackDays = options.lookbackDays || 7;
    this.patterns = new Map();
  }

  /**
   * Analyze logs for patterns
   */
  async analyze(logs) {
    const patterns = {
      errors: this.detectErrorPatterns(logs),
      performance: this.detectPerformancePatterns(logs),
      gaps: this.detectKnowledgeGaps(logs)
    };
    
    return patterns;
  }

  /**
   * Detect recurring errors
   */
  detectErrorPatterns(logs) {
    const errorCounts = new Map();
    
    for (const log of logs) {
      if (log.level === 'error') {
        const key = this.normalizeError(log.message);
        errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
      }
    }
    
    // Filter recurring errors
    const recurring = [];
    for (const [error, count] of errorCounts) {
      if (count >= this.minOccurrences) {
        recurring.push({ error, count, severity: count >= 5 ? 'high' : 'medium' });
      }
    }
    
    return recurring.sort((a, b) => b.count - a.count);
  }

  /**
   * Detect performance patterns
   */
  detectPerformancePatterns(logs) {
    const slowOps = logs.filter(l => 
      l.duration && l.duration > 5000
    );
    
    return {
      slowOperations: slowOps.length,
      avgDuration: this.calculateAverage(logs, 'duration'),
      p95Duration: this.calculateP95(logs, 'duration')
    };
  }

  /**
   * Detect knowledge gaps from queries
   */
  detectKnowledgeGaps(logs) {
    const unknownQueries = logs.filter(l =>
      l.type === 'search' && l.results === 0
    );
    
    const topics = new Map();
    for (const q of unknownQueries) {
      const topic = this.extractTopic(q.query);
      topics.set(topic, (topics.get(topic) || 0) + 1);
    }
    
    return Array.from(topics.entries())
      .filter(([_, count]) => count >= this.minOccurrences)
      .map(([topic, count]) => ({ topic, count }));
  }

  /**
   * Normalize error message
   */
  normalizeError(message) {
    // Remove variable parts
    return message
      .replace(/\d+/g, 'N')
      .replace(/[a-f0-9]{8,}/g, 'ID')
      .toLowerCase();
  }

  /**
   * Extract topic from query
   */
  extractTopic(query) {
    // Simple extraction - in production use NLP
    const words = query.toLowerCase().split(/\s+/);
    return words.slice(0, 3).join(' ');
  }

  calculateAverage(logs, field) {
    const values = logs.filter(l => l[field]).map(l => l[field]);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }

  calculateP95(logs, field) {
    const values = logs.filter(l => l[field]).map(l => l[field]).sort((a, b) => a - b);
    const idx = Math.floor(values.length * 0.95);
    return values[idx] || 0;
  }
}

module.exports = { PatternDetector };
