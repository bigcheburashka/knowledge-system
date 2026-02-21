/**
 * Circuit Breaker
 * Protects against cascading failures in external APIs
 */

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.halfOpenMaxCalls = options.halfOpenMaxCalls || 3;
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.halfOpenCalls = 0;
    this.successCount = 0;
  }

  async execute(fn, context = 'operation') {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        console.log(`[CircuitBreaker] ${context}: Moving to HALF_OPEN`);
        this.state = 'HALF_OPEN';
        this.halfOpenCalls = 0;
        this.successCount = 0;
      } else {
        throw new Error(`Circuit breaker is OPEN for ${context}. Try again later.`);
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new Error(`Circuit breaker HALF_OPEN limit reached for ${context}`);
    }

    if (this.state === 'HALF_OPEN') {
      this.halfOpenCalls++;
    }

    try {
      const result = await fn();
      this.onSuccess(context);
      return result;
    } catch (err) {
      this.onFailure(context);
      throw err;
    }
  }

  onSuccess(context) {
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenMaxCalls) {
        console.log(`[CircuitBreaker] ${context}: Closing circuit`);
        this.state = 'CLOSED';
        this.halfOpenCalls = 0;
        this.successCount = 0;
      }
    }
  }

  onFailure(context) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.failureThreshold) {
      console.log(`[CircuitBreaker] ${context}: Opening circuit after ${this.failureCount} failures`);
      this.state = 'OPEN';
    }
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      halfOpenCalls: this.halfOpenCalls,
      successCount: this.successCount
    };
  }
}

module.exports = { CircuitBreaker };
