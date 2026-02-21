/**
 * Confidence Scoring
 * Calculates confidence for actions and decisions
 */

class ConfidenceScorer {
  constructor(options = {}) {
    this.thresholds = {
      autoProceed: options.autoProceedThreshold || 0.9,
      askConfirm: options.askConfirmThreshold || 0.7,
      manualReview: options.manualReviewThreshold || 0.4
    };
    
    // Weights for different factors
    this.weights = {
      dataQuality: 0.3,
      historicalSuccess: 0.25,
      contextClarity: 0.2,
      resourceAvailability: 0.15,
      riskLevel: 0.1
    };
  }

  /**
   * Calculate confidence for an action
   */
  calculate(context) {
    const scores = {
      dataQuality: this.scoreDataQuality(context.data),
      historicalSuccess: this.scoreHistoricalSuccess(context.history),
      contextClarity: this.scoreContextClarity(context),
      resourceAvailability: this.scoreResourceAvailability(context.resources),
      riskLevel: this.scoreRiskLevel(context.risk)
    };
    
    const weightedScore = Object.entries(scores).reduce((sum, [key, score]) => {
      return sum + (score * this.weights[key]);
    }, 0);
    
    const confidence = Math.min(1, Math.max(0, weightedScore));
    
    return {
      confidence,
      scores,
      recommendation: this.getRecommendation(confidence),
      factors: this.explainFactors(scores)
    };
  }

  /**
   * Score data quality (0-1)
   */
  scoreDataQuality(data) {
    if (!data) return 0.3;
    
    let score = 0.5;
    
    // Completeness
    if (data.completeness > 0.8) score += 0.2;
    else if (data.completeness > 0.5) score += 0.1;
    
    // Accuracy
    if (data.accuracy > 0.9) score += 0.2;
    else if (data.accuracy > 0.7) score += 0.1;
    
    // Freshness
    if (data.freshness === 'recent') score += 0.1;
    else if (data.freshness === 'stale') score -= 0.1;
    
    return Math.min(1, score);
  }

  /**
   * Score historical success (0-1)
   */
  scoreHistoricalSuccess(history) {
    if (!history || history.attempts === 0) return 0.5;
    
    const successRate = history.successes / history.attempts;
    
    // More attempts = more reliable success rate
    if (history.attempts > 10) {
      return successRate;
    } else if (history.attempts > 5) {
      return 0.5 + (successRate * 0.5);
    } else {
      return 0.7; // Default for limited history
    }
  }

  /**
   * Score context clarity (0-1)
   */
  scoreContextClarity(context) {
    let score = 0.5;
    
    // Clear goal
    if (context.goal && context.goal.length > 10) score += 0.15;
    
    // Clear constraints
    if (context.constraints && context.constraints.length > 0) score += 0.1;
    
    // User preferences known
    if (context.userPreferences) score += 0.15;
    
    // Previous context available
    if (context.previousContext) score += 0.1;
    
    return Math.min(1, score);
  }

  /**
   * Score resource availability (0-1)
   */
  scoreResourceAvailability(resources) {
    if (!resources) return 0.5;
    
    let score = 0.5;
    
    // Memory available
    if (resources.memory && resources.memory > 0.5) score += 0.15;
    else if (resources.memory && resources.memory < 0.2) score -= 0.2;
    
    // Disk space
    if (resources.diskSpace && resources.diskSpace > 0.3) score += 0.1;
    else if (resources.diskSpace && resources.diskSpace < 0.1) score -= 0.2;
    
    // Services available
    if (resources.services && resources.services.allHealthy) score += 0.15;
    else if (resources.services && !resources.services.allHealthy) score -= 0.1;
    
    return Math.min(1, Math.max(0, score));
  }

  /**
   * Score risk level (0-1, higher is better/lower risk)
   */
  scoreRiskLevel(risk) {
    if (!risk) return 0.7;
    
    // Risk levels: low, medium, high, critical
    const riskScores = {
      low: 0.9,
      medium: 0.7,
      high: 0.4,
      critical: 0.1
    };
    
    return riskScores[risk.level] || 0.5;
  }

  /**
   * Get recommendation based on confidence
   */
  getRecommendation(confidence) {
    if (confidence >= this.thresholds.autoProceed) {
      return {
        action: 'proceed',
        message: 'High confidence - proceed automatically',
        requiresConfirmation: false
      };
    } else if (confidence >= this.thresholds.askConfirm) {
      return {
        action: 'confirm',
        message: 'Medium confidence - ask for confirmation',
        requiresConfirmation: true
      };
    } else if (confidence >= this.thresholds.manualReview) {
      return {
        action: 'review',
        message: 'Low confidence - manual review recommended',
        requiresConfirmation: true,
        warning: true
      };
    } else {
      return {
        action: 'abort',
        message: 'Very low confidence - abort and ask for clarification',
        requiresConfirmation: true,
        critical: true
      };
    }
  }

  /**
   * Explain confidence factors
   */
  explainFactors(scores) {
    return Object.entries(scores).map(([key, score]) => ({
      factor: key,
      score: Math.round(score * 100),
      weight: this.weights[key],
      contribution: Math.round(score * this.weights[key] * 100)
    }));
  }

  /**
   * Quick confidence check
   */
  shouldProceed(context) {
    const result = this.calculate(context);
    return {
      shouldProceed: result.confidence >= this.thresholds.askConfirm,
      confidence: result.confidence,
      reason: result.recommendation.message
    };
  }

  /**
   * Create confidence report
   */
  createReport(context, action) {
    const scoring = this.calculate(context);
    
    return {
      action,
      timestamp: new Date().toISOString(),
      ...scoring,
      decision: scoring.recommendation.action,
      requiresUserInput: scoring.recommendation.requiresConfirmation
    };
  }
}

module.exports = { ConfidenceScorer };
