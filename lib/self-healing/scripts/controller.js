/**
 * Self-Healing Controller
 * 4 recovery strategies with circuit breaker
 */

const { CheckpointStore } = require('../../graph-schema/scripts/checkpoint-store');

class SelfHealingController {
  constructor(options = {}) {
    this.checkpointStore = options.checkpointStore || new CheckpointStore();
    this.maxRetries = options.maxRetries || 3;
    this.retryDelays = [1000, 2000, 4000]; // Exponential backoff
    this.checkpoints = new Map(); // In-memory tracking
  }

  /**
   * Main entry: handle failure
   */
  async handleFailure(checkpointId, error, context = {}) {
    console.log(`[SelfHealing] Handling failure for ${checkpointId}:`, error.message);
    
    // Load checkpoint
    const checkpoint = await this.checkpointStore.load(checkpointId);
    
    // Circuit breaker check
    if (checkpoint.retryCount >= this.maxRetries) {
      console.log(`[SelfHealing] Max retries exceeded for ${checkpointId}`);
      return this.escalateToUser(checkpoint, error);
    }
    
    // Classify error
    const errorType = this.classifyError(error);
    console.log(`[SelfHealing] Classified as: ${errorType}`);
    
    // Route to recovery strategy
    switch (errorType) {
      case 'TIMEOUT':
        return this.recoverFromTimeout(checkpoint, error, context);
      case 'ERROR':
        return this.recoverFromError(checkpoint, error, context);
      case 'KNOWLEDGE_GAP':
        return this.recoverFromKnowledgeGap(checkpoint, error, context);
      default:
        return this.escalateToUser(checkpoint, error);
    }
  }

  /**
   * Classify error type
   */
  classifyError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'TIMEOUT';
    }
    if (message.includes('unknown') || message.includes('not found') || 
        message.includes('need to learn') || message.includes('knowledge gap')) {
      return 'KNOWLEDGE_GAP';
    }
    if (message.includes('error') || message.includes('failed') || 
        message.includes('exception')) {
      return 'ERROR';
    }
    
    return 'UNKNOWN';
  }

  /**
   * Strategy 1: Recover from timeout
   */
  async recoverFromTimeout(checkpoint, error, context) {
    const retryCount = checkpoint.retryCount || 0;
    const newTimeout = (context.timeout || 5000) * 2; // Double timeout
    
    console.log(`[SelfHealing] TIMEOUT recovery: attempt ${retryCount + 1}, new timeout ${newTimeout}ms`);
    
    // Update checkpoint
    checkpoint.retryCount = retryCount + 1;
    checkpoint.lastError = error.message;
    checkpoint.lastRecovery = 'TIMEOUT';
    checkpoint.newTimeout = newTimeout;
    await this.checkpointStore.save(checkpoint);
    
    // Retry with new timeout
    return {
      action: 'RETRY',
      strategy: 'TIMEOUT',
      newTimeout,
      retryCount: checkpoint.retryCount,
      checkpoint
    };
  }

  /**
   * Strategy 2: Recover from error with exponential backoff
   */
  async recoverFromError(checkpoint, error, context) {
    const retryCount = checkpoint.retryCount || 0;
    const delay = this.retryDelays[Math.min(retryCount, this.retryDelays.length - 1)];
    
    console.log(`[SelfHealing] ERROR recovery: attempt ${retryCount + 1}, delay ${delay}ms`);
    
    // Wait before retry
    await this.sleep(delay);
    
    // Update checkpoint
    checkpoint.retryCount = retryCount + 1;
    checkpoint.lastError = error.message;
    checkpoint.lastRecovery = 'ERROR';
    checkpoint.backoffDelay = delay;
    await this.checkpointStore.save(checkpoint);
    
    return {
      action: 'RETRY',
      strategy: 'ERROR',
      delay,
      retryCount: checkpoint.retryCount,
      checkpoint
    };
  }

  /**
   * Strategy 3: Recover from knowledge gap
   */
  async recoverFromKnowledgeGap(checkpoint, error, context) {
    console.log(`[SelfHealing] KNOWLEDGE_GAP recovery: triggering Deep Learning`);
    
    // Extract topic from error
    const topic = this.extractTopicFromError(error);
    
    // Trigger Deep Learning (placeholder for Week 3)
    console.log(`[SelfHealing] Adding priority topic: ${topic}`);
    
    // Update checkpoint
    checkpoint.retryCount = (checkpoint.retryCount || 0) + 1;
    checkpoint.lastError = error.message;
    checkpoint.lastRecovery = 'KNOWLEDGE_GAP';
    checkpoint.learningTopic = topic;
    await this.checkpointStore.save(checkpoint);
    
    // In real implementation: wait for DL to complete
    // await this.waitForLearning(topic, 300000);
    
    return {
      action: 'LEARN',
      strategy: 'KNOWLEDGE_GAP',
      topic,
      retryCount: checkpoint.retryCount,
      checkpoint
    };
  }

  /**
   * Strategy 4: Escalate to user
   */
  async escalateToUser(checkpoint, error) {
    console.log(`[SelfHealing] ESCALATING to user: ${checkpoint.id}`);
    
    // Update checkpoint
    checkpoint.status = 'ESCALATED';
    checkpoint.escalatedAt = Date.now();
    checkpoint.escalationReason = error.message;
    await this.checkpointStore.save(checkpoint);
    
    // In real implementation: send notification to user
    // await this.notifyUser(checkpoint);
    
    return {
      action: 'ESCALATE',
      strategy: 'USER',
      reason: error.message,
      checkpoint
    };
  }

  /**
   * Extract topic from error message
   */
  extractTopicFromError(error) {
    // Simple extraction - in real implementation use LLM
    const match = error.message.match(/topic[:\s]+(\w+)/i);
    return match ? match[1] : 'general';
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get healing statistics
   */
  getStats() {
    return {
      totalRecoveries: 0, // Track from checkpoints
      successfulRecoveries: 0,
      escalations: 0
    };
  }
}

module.exports = { SelfHealingController };

// CLI test
if (require.main === module) {
  async function test() {
    const controller = new SelfHealingController();
    
    // Test error classification
    const errors = [
      new Error('Connection timeout'),
      new Error('Unknown topic: Kubernetes'),
      new Error('Processing failed'),
      new Error('Something weird happened')
    ];
    
    for (const err of errors) {
      const type = controller.classifyError(err);
      console.log(`"${err.message}" -> ${type}`);
    }
  }
  
  test();
}
