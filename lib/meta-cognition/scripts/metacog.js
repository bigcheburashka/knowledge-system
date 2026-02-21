/**
 * Meta-Cognition Layer
 * Tracks system performance and learning
 */

class MetaCognition {
  constructor(options = {}) {
    this.metrics = new Map();
    this.learningHistory = [];
  }

  /**
   * Record agent performance
   */
  recordAgentPerformance(agentId, task, result) {
    const metric = {
      agentId,
      task: task.type,
      success: result.success,
      duration: result.duration,
      timestamp: Date.now()
    };
    
    this.metrics.set(agentId, [
      ...(this.metrics.get(agentId) || []),
      metric
    ]);
    
    return metric;
  }

  /**
   * Get agent effectiveness score
   */
  getAgentEffectiveness(agentId) {
    const metrics = this.metrics.get(agentId) || [];
    if (metrics.length === 0) return { score: 0, confidence: 0 };
    
    const successes = metrics.filter(m => m.success).length;
    const score = successes / metrics.length;
    
    // Recent performance weighted more
    const recent = metrics.slice(-10);
    const recentSuccess = recent.filter(m => m.success).length;
    const recentScore = recent.length ? recentSuccess / recent.length : 0;
    
    return {
      score: (score * 0.4 + recentScore * 0.6),
      totalRuns: metrics.length,
      confidence: Math.min(metrics.length / 20, 1) // Confidence grows with data
    };
  }

  /**
   * Record learning event
   */
  recordLearning(topic, source, effectiveness) {
    this.learningHistory.push({
      topic,
      source,
      effectiveness,
      timestamp: Date.now()
    });
  }

  /**
   * Get learning effectiveness
   */
  getLearningStats() {
    const total = this.learningHistory.length;
    if (total === 0) return { total: 0, avgEffectiveness: 0 };
    
    const avg = this.learningHistory.reduce((s, h) => s + h.effectiveness, 0) / total;
    
    return {
      total,
      avgEffectiveness: avg,
      recentTopics: this.learningHistory.slice(-5).map(h => h.topic)
    };
  }

  /**
   * Generate self-improvement suggestions
   */
  generateSuggestions() {
    const suggestions = [];
    
    // Check agent performance
    for (const [agentId, metrics] of this.metrics) {
      const effectiveness = this.getAgentEffectiveness(agentId);
      
      if (effectiveness.score < 0.7 && effectiveness.confidence > 0.5) {
        suggestions.push({
          type: 'agent_improvement',
          target: agentId,
          issue: 'Low success rate',
          recommendation: 'Review error patterns and update logic'
        });
      }
    }
    
    // Check learning effectiveness
    const learning = this.getLearningStats();
    if (learning.avgEffectiveness < 0.6) {
      suggestions.push({
        type: 'learning_improvement',
        issue: 'Low learning effectiveness',
        recommendation: 'Improve topic extraction and knowledge storage'
      });
    }
    
    return suggestions;
  }

  /**
   * Get system health summary
   */
  getHealthSummary() {
    const allMetrics = Array.from(this.metrics.values()).flat();
    const successRate = allMetrics.filter(m => m.success).length / allMetrics.length || 0;
    
    return {
      overallSuccessRate: successRate,
      totalTasks: allMetrics.length,
      activeAgents: this.metrics.size,
      learningTopics: this.learningHistory.length,
      suggestions: this.generateSuggestions().length
    };
  }
}

module.exports = { MetaCognition };
