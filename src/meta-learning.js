/**
 * Meta-Learning MVP
 * Analyzes learning effectiveness and suggests strategy
 * Based on: frequency + staleness (minimal viable approach)
 */

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';
const TOPICS_PATH = path.join(__dirname, '..', 'custom-topics.json');
const METRICS_DIR = path.join(__dirname, '..', 'metrics');

class MetaLearning {
  constructor(options = {}) {
    this.stalenessThreshold = options.stalenessThreshold || 30; // days
    this.frequencyThreshold = options.frequencyThreshold || 3;  // mentions
  }

  /**
   * Main analysis: effectiveness of current knowledge
   */
  async analyzeEffectiveness() {
    console.log('🔍 Meta-Learning: Analyzing effectiveness...\n');
    
    const analysis = {
      timestamp: new Date().toISOString(),
      highFrequencyLowKnowledge: await this.findHighFreqLowKnowledge(),
      staleTopics: await this.findStaleTopics(),
      unusedTopics: await this.findUnusedTopics(),
      categoryBalance: await this.analyzeCategoryBalance()
    };
    
    return analysis;
  }

  /**
   * Find topics mentioned frequently but with low knowledge coverage
   */
  async findHighFreqLowKnowledge() {
    // Load frequency data
    const freqData = await this.loadFrequencyData();
    const candidates = [];
    
    for (const [topic, data] of Object.entries(freqData.topics || {})) {
      // Check if high frequency (>3 mentions in 7 days)
      const recentMentions = data.mentions.filter(m => {
        const daysAgo = (Date.now() - new Date(m).getTime()) / (1000 * 60 * 60 * 24);
        return daysAgo <= 7;
      });
      
      if (recentMentions.length >= this.frequencyThreshold) {
        // Check knowledge coverage
        const coverage = await this.checkKnowledgeCoverage(topic);
        
        if (coverage.confidence < 0.6) {
          candidates.push({
            topic,
            mentions: recentMentions.length,
            confidence: coverage.confidence,
            reason: 'High frequency but low knowledge coverage'
          });
        }
      }
    }
    
    return candidates.sort((a, b) => b.mentions - a.mentions);
  }

  /**
   * Find topics that haven't been updated recently
   */
  async findStaleTopics() {
    try {
      // Get all vectors from Qdrant
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
        { limit: 1000, with_payload: true }
      );
      
      const now = Date.now();
      const stale = [];
      
      for (const point of response.data.result.points) {
        const payload = point.payload;
        const updatedAt = payload.updatedAt || payload.createdAt;
        
        if (updatedAt) {
          const daysSinceUpdate = (now - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
          
          if (daysSinceUpdate > this.stalenessThreshold) {
            stale.push({
              topic: payload.name,
              type: payload.type,
              daysStale: Math.round(daysSinceUpdate),
              lastUpdated: updatedAt,
              reason: `Not updated for ${Math.round(daysSinceUpdate)} days`
            });
          }
        }
      }
      
      return stale.sort((a, b) => b.daysStale - a.daysStale);
    } catch (error) {
      console.error('[MetaLearning] Error finding stale topics:', error.message);
      return [];
    }
  }

  /**
   * Find topics that are in KB but rarely/never used
   */
  async findUnusedTopics() {
    // This would require usage tracking (future enhancement)
    // For MVP, return empty or use heuristics
    return [];
  }

  /**
   * Analyze balance between topic categories
   */
  async analyzeCategoryBalance() {
    try {
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
        { limit: 1000, with_payload: true }
      );
      
      const byType = {};
      for (const point of response.data.result.points) {
        const type = point.payload?.type || 'unknown';
        byType[type] = (byType[type] || 0) + 1;
      }
      
      const total = Object.values(byType).reduce((a, b) => a + b, 0);
      const balance = {};
      
      for (const [type, count] of Object.entries(byType)) {
        balance[type] = {
          count,
          percentage: ((count / total) * 100).toFixed(1)
        };
      }
      
      return balance;
    } catch (error) {
      console.error('[MetaLearning] Error analyzing balance:', error.message);
      return {};
    }
  }

  /**
   * Check knowledge coverage for a topic
   */
  async checkKnowledgeCoverage(topic) {
    try {
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
        {
          filter: {
            must: [{ key: 'name', match: { value: topic } }]
          },
          with_payload: true,
          limit: 1
        }
      );
      
      const points = response.data.result.points;
      
      if (points.length === 0) {
        return { exists: false, confidence: 0 };
      }
      
      const payload = points[0].payload;
      
      // Check quality indicators
      const hasDescription = payload.text && payload.text.length > 100;
      const hasRelated = payload.related && payload.related.length >= 3;
      const hasBestPractices = payload.bestPractices && payload.bestPractices.length >= 3;
      
      let confidence = 0.3; // Base confidence for existing topic
      if (hasDescription) confidence += 0.3;
      if (hasRelated) confidence += 0.2;
      if (hasBestPractices) confidence += 0.2;
      
      return {
        exists: true,
        confidence: Math.min(confidence, 1.0),
        hasDescription,
        hasRelated,
        hasBestPractices
      };
    } catch (error) {
      console.error('[MetaLearning] Error checking coverage:', error.message);
      return { exists: false, confidence: 0, error: error.message };
    }
  }

  /**
   * Suggest learning strategy based on analysis
   */
  async suggestStrategy() {
    const analysis = await this.analyzeEffectiveness();
    
    // Strategy 1: Focus on high-frequency gaps
    const strategy1 = {
      name: 'Focus on high-frequency gaps',
      description: 'Topics mentioned frequently but with low knowledge coverage',
      topics: analysis.highFrequencyLowKnowledge.slice(0, 5),
      priority: 'high',
      expectedImpact: 'Improve coverage of actively discussed topics'
    };
    
    // Strategy 2: Refresh stale knowledge
    const strategy2 = {
      name: 'Refresh stale knowledge',
      description: 'Topics not updated in 30+ days',
      topics: analysis.staleTopics.slice(0, 5),
      priority: 'medium',
      expectedImpact: 'Keep existing knowledge up-to-date'
    };
    
    // Strategy 3: Explore new areas (if few gaps)
    const strategy3 = {
      name: 'Explore new areas',
      description: 'Expand into underrepresented categories',
      topics: await this.suggestExploration(analysis.categoryBalance),
      priority: 'low',
      expectedImpact: 'Diversify knowledge base'
    };
    
    return {
      analysis,
      strategies: [strategy1, strategy2, strategy3],
      recommendation: this.selectRecommendedStrategy(analysis)
    };
  }

  /**
   * Select recommended strategy based on analysis
   */
  selectRecommendedStrategy(analysis) {
    // If many high-frequency gaps, recommend focusing on them
    if (analysis.highFrequencyLowKnowledge.length >= 3) {
      return 'Focus on high-frequency gaps';
    }
    
    // If many stale topics, recommend refresh
    if (analysis.staleTopics.length >= 5) {
      return 'Refresh stale knowledge';
    }
    
    // Otherwise, explore new areas
    return 'Explore new areas';
  }

  /**
   * Suggest topics for exploration based on category balance
   */
  async suggestExploration(balance) {
    // Find underrepresented categories
    const underrepresented = [];
    
    if (balance.technology && parseFloat(balance.technology.percentage) > 80) {
      underrepresented.push('pattern', 'problem', 'solution');
    }
    
    // Return placeholder topics for exploration
    // In real implementation, this would use trend analysis
    return underrepresented.map(type => ({
      topic: `Explore ${type} topics`,
      type,
      reason: 'Underrepresented category'
    }));
  }

  /**
   * Load frequency tracking data
   */
  async loadFrequencyData() {
    try {
      const freqPath = path.join(__dirname, '..', 'data', 'topic-frequency.json');
      const content = await fs.readFile(freqPath, 'utf8');
      return JSON.parse(content);
    } catch {
      return { topics: {} };
    }
  }

  /**
   * Weekly review: generate report for manual review
   */
  async generateWeeklyReview() {
    const strategy = await this.suggestStrategy();
    
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        highFreqGaps: strategy.analysis.highFrequencyLowKnowledge.length,
        staleTopics: strategy.analysis.staleTopics.length,
        categoryBalance: strategy.analysis.categoryBalance,
        recommendedStrategy: strategy.recommendation
      },
      strategies: strategy.strategies
    };
    
    // Save report
    await fs.mkdir(METRICS_DIR, { recursive: true });
    const reportPath = path.join(METRICS_DIR, `weekly-review-${Date.now()}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    return report;
  }

  /**
   * Print human-readable strategy report
   */
  printStrategyReport(strategy) {
    console.log('\n' + '='.repeat(70));
    console.log('📊 META-LEARNING STRATEGY REPORT');
    console.log('='.repeat(70));
    console.log(`\nGenerated: ${new Date().toISOString()}`);
    console.log(`Recommended: ${strategy.recommendation}\n`);
    
    strategy.strategies.forEach((s, i) => {
      console.log(`${i + 1}. [${s.priority.toUpperCase()}] ${s.name}`);
      console.log(`   ${s.description}`);
      console.log(`   Expected impact: ${s.expectedImpact}`);
      console.log(`   Topics (${s.topics.length}):`);
      s.topics.slice(0, 3).forEach(t => {
        console.log(`     - ${t.topic || t}`);
      });
      if (s.topics.length > 3) {
        console.log(`     ... and ${s.topics.length - 3} more`);
      }
      console.log('');
    });
    
    console.log('='.repeat(70));
  }
}

module.exports = { MetaLearning };

// CLI for testing
if (require.main === module) {
  const meta = new MetaLearning();
  
  meta.suggestStrategy().then(strategy => {
    meta.printStrategyReport(strategy);
  }).catch(console.error);
}
