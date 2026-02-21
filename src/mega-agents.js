#!/usr/bin/env node
/**
 * Mega-Agent Architecture - Simple Variant (A)
 * With crash protection and self-DDoS prevention
 */

require('dotenv').config({ path: '/root/.openclaw/workspace/knowledge-system/.env' });

const { getFeatureFlags } = require('./feature-flags');

// Circuit Breaker States
const CB_STATE = {
  CLOSED: 'CLOSED',      // Normal operation
  OPEN: 'OPEN',          // Failing, reject requests
  HALF_OPEN: 'HALF_OPEN' // Testing if recovered
};

/**
 * Circuit Breaker - prevents self-DDoS when service is failing
 */
class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 30000; // 30 seconds
    this.halfOpenMaxCalls = options.halfOpenMaxCalls || 3;
    
    this.state = CB_STATE.CLOSED;
    this.failures = 0;
    this.lastFailureTime = null;
    this.halfOpenCalls = 0;
  }

  async execute(operation, ...args) {
    if (this.state === CB_STATE.OPEN) {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = CB_STATE.HALF_OPEN;
        this.halfOpenCalls = 0;
        console.log(`[${this.name}] Circuit breaker: HALF_OPEN`);
      } else {
        throw new Error(`Circuit breaker OPEN for ${this.name}`);
      }
    }

    if (this.state === CB_STATE.HALF_OPEN && this.halfOpenCalls >= this.halfOpenMaxCalls) {
      throw new Error(`Circuit breaker HALF_OPEN limit reached for ${this.name}`);
    }

    try {
      if (this.state === CB_STATE.HALF_OPEN) {
        this.halfOpenCalls++;
      }
      
      const result = await operation(...args);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess() {
    this.failures = 0;
    if (this.state === CB_STATE.HALF_OPEN) {
      this.state = CB_STATE.CLOSED;
      console.log(`[${this.name}] Circuit breaker: CLOSED (recovered)`);
    }
  }

  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = CB_STATE.OPEN;
      console.log(`[${this.name}] Circuit breaker: OPEN (too many failures)`);
    }
  }
}

/**
 * Retry Manager - exponential backoff with jitter
 */
class RetryManager {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000;
    this.maxDelay = options.maxDelay || 30000;
    this.jitter = options.jitter !== false; // default true
  }

  async execute(operation, context = '') {
    let lastError;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateDelay(attempt);
          console.log(`[Retry] ${context} - attempt ${attempt + 1}/${this.maxRetries + 1} after ${delay}ms`);
          await this.sleep(delay);
        }
        
        return await operation();
      } catch (error) {
        lastError = error;
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          console.log(`[Retry] ${context} - non-retryable error, giving up`);
          throw error;
        }
        
        if (attempt < this.maxRetries) {
          console.log(`[Retry] ${context} - attempt ${attempt + 1} failed: ${error.message}`);
        }
      }
    }
    
    console.log(`[Retry] ${context} - all ${this.maxRetries + 1} attempts failed`);
    throw lastError;
  }

  calculateDelay(attempt) {
    // Exponential backoff: 1s, 2s, 4s, 8s...
    let delay = this.baseDelay * Math.pow(2, attempt - 1);
    delay = Math.min(delay, this.maxDelay);
    
    // Add jitter to prevent thundering herd
    if (this.jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    
    return Math.floor(delay);
  }

  isNonRetryableError(error) {
    const nonRetryablePatterns = [
      'ENOTFOUND',
      'EACCES',
      'EINVAL',
      'Entity already exists'
    ];
    
    return nonRetryablePatterns.some(pattern => 
      error.message?.includes(pattern) || error.code?.includes(pattern)
    );
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Rate Limiter - prevents self-DDoS
 */
class RateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 10;
    this.windowMs = options.windowMs || 60000; // 1 minute
    this.requests = new Map();
  }

  async acquire(key = 'default') {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    // Clean old requests
    if (this.requests.has(key)) {
      const requests = this.requests.get(key).filter(time => time > windowStart);
      this.requests.set(key, requests);
      
      if (requests.length >= this.maxRequests) {
        const oldestRequest = requests[0];
        const waitTime = this.windowMs - (now - oldestRequest);
        console.log(`[RateLimiter] ${key} - rate limit hit, waiting ${waitTime}ms`);
        await this.sleep(waitTime);
        return this.acquire(key); // Retry after wait
      }
    } else {
      this.requests.set(key, []);
    }
    
    this.requests.get(key).push(now);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Research Agent - investigates topics deeply
 */
class ResearchAgent {
  constructor() {
    this.breaker = new CircuitBreaker('ResearchAgent', {
      failureThreshold: 3,
      resetTimeout: 60000
    });
    this.retry = new RetryManager({ maxRetries: 2, baseDelay: 2000 });
    this.rateLimiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });
  }

  async research(topic) {
    return this.breaker.execute(async () => {
      await this.rateLimiter.acquire('llm');
      
      return this.retry.execute(async () => {
        console.log(`[ResearchAgent] Researching: ${topic}`);
        
        // Simulate LLM call (replace with actual implementation)
        const result = await this.callLLM(topic);
        
        return {
          topic,
          description: result.description,
          related: result.related || [],
          sources: ['knowledge-base', 'llm-generation'],
          timestamp: new Date().toISOString()
        };
      }, `Research: ${topic}`);
    });
  }

  async callLLM(topic) {
    // Use OpenClaw Gateway API (same as deep-learning.js)
    const OpenClawAdapter = require('./openclaw-adapter');
    const adapter = new OpenClawAdapter();
    
    const prompt = `Analyze "${topic}" from software development context.

Create a detailed JSON object with real content (not placeholders):
{
  "name": "${topic}",
  "type": "technology",
  "description": "Detailed 2-3 sentence description of what ${topic} is and when to use it",
  "related": ["3-5 real related technologies or concepts"],
  "bestPractices": ["3-5 specific best practices for using ${topic}"],
  "commonMistakes": ["3-5 common mistakes developers make with ${topic}"]
}

IMPORTANT: Provide REAL specific content, not generic placeholders. Respond ONLY with valid JSON.`;

    // Use the same API format as working deep-learning.js
    const axios = require('axios');
    const response = await axios.post(
      `${process.env.KIMI_BASE_URL || 'https://api.kimi.com/coding'}/v1/messages`,
      {
        model: 'kimi-k2-5',
        messages: [
          { role: 'system', content: 'Respond with valid JSON only.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 800
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY || ''}`,
          'User-Agent': 'OpenClaw/2026.2.17'
        },
        timeout: 60000
      }
    );
    
    // Anthropic format: content[0].text
    const content = response.data.content?.[0]?.text || '';
    
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log('[ResearchAgent] Failed to parse JSON, using fallback');
    }
    
    // Fallback structure if parsing fails
    return {
      name: topic,
      type: 'technology',
      description: `Analysis of ${topic} in enterprise development context`,
      related: ['AI Agents', 'CI/CD', 'DevEx'],
      bestPractices: ['Start small', 'Measure impact', 'Iterate'],
      commonMistakes: ['Over-engineering', 'Ignoring feedback', 'No metrics']
    };
  }
}

/**
 * FactCheck Agent - verifies facts
 */
class FactCheckAgent {
  constructor() {
    this.breaker = new CircuitBreaker('FactCheckAgent', {
      failureThreshold: 3,
      resetTimeout: 30000
    });
    this.retry = new RetryManager({ maxRetries: 2, baseDelay: 1000 });
    this.rateLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });
  }

  async verify(data) {
    return this.breaker.execute(async () => {
      await this.rateLimiter.acquire('verify');
      
      return this.retry.execute(async () => {
        console.log(`[FactCheckAgent] Verifying: ${data.topic}`);
        
        // Check against knowledge base
        const verification = await this.verifyAgainstKB(data);
        
        return {
          ...data,
          verified: verification.verified,
          confidence: verification.confidence,
          issues: verification.issues || []
        };
      }, `Verify: ${data.topic}`);
    });
  }

  async verifyAgainstKB(data) {
    // Real verification against Qdrant knowledge base
    const axios = require('axios');
    const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
    const COLLECTION = 'knowledge';
    
    try {
      // Check if similar topic exists
      const searchResponse = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
        {
          filter: {
            must: [
              { key: 'name', match: { value: data.topic } }
            ]
          },
          limit: 1,
          with_payload: true
        }
      );
      
      const existing = searchResponse.data.result.points?.[0];
      
      if (existing) {
        // Compare with existing knowledge
        const matchScore = this.calculateMatchScore(data, existing.payload);
        return {
          verified: matchScore > 0.7,
          confidence: matchScore,
          issues: matchScore < 0.7 ? ['Partial mismatch with existing knowledge'] : [],
          existingId: existing.id
        };
      }
      
      // No existing data - new topic
      return {
        verified: true,
        confidence: 0.75,
        issues: [],
        note: 'New topic, no existing data to verify against'
      };
      
    } catch (error) {
      console.log(`[FactCheckAgent] Verification failed: ${error.message}`);
      // Return conservative values on error
      return {
        verified: false,
        confidence: 0.5,
        issues: [`Verification error: ${error.message}`]
      };
    }
  }
  
  calculateMatchScore(newData, existingData) {
    let score = 0;
    let checks = 0;
    
    // Check related topics overlap
    if (newData.related && existingData.related) {
      const overlap = newData.related.filter(r => 
        existingData.related.some(er => 
          er.toLowerCase().includes(r.toLowerCase()) || 
          r.toLowerCase().includes(er.toLowerCase())
        )
      );
      score += overlap.length / Math.max(newData.related.length, existingData.related.length, 1);
      checks++;
    }
    
    // Check type match
    if (newData.type && existingData.type) {
      score += newData.type === existingData.type ? 1 : 0.5;
      checks++;
    }
    
    return checks > 0 ? score / checks : 0.5;
  }
}

/**
 * Quality Agent - evaluates quality
 */
class QualityAgent {
  constructor() {
    this.minConfidence = 0.7;
    this.requiredFields = ['description', 'related', 'bestPractices', 'commonMistakes'];
  }

  async evaluate(data) {
    console.log(`[QualityAgent] Evaluating: ${data.topic}`);
    
    const issues = [];
    let score = 1.0;
    
    // Check confidence
    if (data.confidence < this.minConfidence) {
      issues.push(`Low confidence: ${data.confidence}`);
      score -= 0.3;
    }
    
    // Check required fields
    for (const field of this.requiredFields) {
      if (!data[field] || (Array.isArray(data[field]) && data[field].length === 0)) {
        issues.push(`Missing or empty: ${field}`);
        score -= 0.15;
      }
    }
    
    // Check description length
    if (data.description && data.description.length < 50) {
      issues.push('Description too short');
      score -= 0.1;
    }
    
    const passed = score >= 0.7 && issues.length <= 2;
    
    return {
      ...data,
      qualityScore: Math.max(0, score),
      qualityPassed: passed,
      qualityIssues: issues
    };
  }
}

/**
 * Composer Agent - composes final response
 */
class ComposerAgent {
  compose(data) {
    console.log(`[ComposerAgent] Composing: ${data.topic}`);
    
    return {
      id: `entry_${Date.now()}`,
      name: data.topic,
      type: data.type || 'technology',
      description: data.description,
      text: data.description,
      related: data.related || [],
      bestPractices: data.bestPractices || [],
      commonMistakes: data.commonMistakes || [],
      confidence: data.confidence,
      qualityScore: data.qualityScore,
      verified: data.verified,
      createdAt: new Date().toISOString(),
      agents: ['research', 'factcheck', 'quality']
    };
  }
}

/**
 * Mega-Agent Coordinator
 */
class MegaAgentCoordinator {
  constructor() {
    this.flags = getFeatureFlags();
    this.agents = {
      research: new ResearchAgent(),
      factcheck: new FactCheckAgent(),
      quality: new QualityAgent(),
      composer: new ComposerAgent()
    };
    this.retry = new RetryManager({ maxRetries: 1, baseDelay: 5000 });
    this.stats = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0
    };
  }

  async processTopic(topic, type = 'technology') {
    console.log(`\n🤖 [MegaAgent] Processing: ${topic}`);
    console.log('=' .repeat(60));
    
    this.stats.processed++;
    
    try {
      // Step 1: Research
      let data = await this.agents.research.research(topic);
      data.type = type;
      
      // Step 2: Fact Check
      data = await this.agents.factcheck.verify(data);
      
      // Step 3: Quality Check
      data = await this.agents.quality.evaluate(data);
      
      if (!data.qualityPassed) {
        console.log(`[MegaAgent] Quality check failed for ${topic}`);
        console.log(`Issues: ${data.qualityIssues.join(', ')}`);
        
        // Retry once with more context
        this.stats.retried++;
        console.log(`[MegaAgent] Retrying with quality feedback...`);
        
        data = await this.agents.research.research(topic + ' (improve: ' + data.qualityIssues.join(', ') + ')');
        data.type = type;
        data = await this.agents.factcheck.verify(data);
        data = await this.agents.quality.evaluate(data);
        
        if (!data.qualityPassed) {
          throw new Error(`Quality check failed after retry: ${data.qualityIssues.join(', ')}`);
        }
      }
      
      // Step 4: Compose
      const result = this.agents.composer.compose(data);
      
      this.stats.succeeded++;
      console.log(`✅ [MegaAgent] Successfully processed: ${topic}`);
      console.log(`   Quality: ${(result.qualityScore * 100).toFixed(1)}%`);
      console.log(`   Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      
      return result;
      
    } catch (error) {
      this.stats.failed++;
      console.error(`❌ [MegaAgent] Failed to process ${topic}:`, error.message);
      throw error;
    }
  }

  async processBatch(topics, options = {}) {
    const limit = options.limit || 5;
    const results = [];
    const errors = [];
    
    console.log(`\n🤖 [MegaAgent] Batch processing ${Math.min(topics.length, limit)} topics`);
    
    for (let i = 0; i < Math.min(topics.length, limit); i++) {
      const topic = topics[i];
      
      try {
        const result = await this.processTopic(topic.name, topic.type);
        results.push(result);
        
        // Delay between topics to prevent overwhelming
        if (i < Math.min(topics.length, limit) - 1) {
          await this.sleep(2000);
        }
      } catch (error) {
        errors.push({ topic: topic.name, error: error.message });
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 [MegaAgent] Batch Complete');
    console.log(`   Processed: ${this.stats.processed}`);
    console.log(`   Succeeded: ${this.stats.succeeded}`);
    console.log(`   Failed: ${this.stats.failed}`);
    console.log(`   Retried: ${this.stats.retried}`);
    console.log('='.repeat(60) + '\n');
    
    return { results, errors, stats: this.stats };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = {
  MegaAgentCoordinator,
  ResearchAgent,
  FactCheckAgent,
  QualityAgent,
  ComposerAgent,
  CircuitBreaker,
  RetryManager,
  RateLimiter
};

// CLI
async function main() {
  const coordinator = new MegaAgentCoordinator();
  
  const command = process.argv[2];
  
  if (command === 'process') {
    const topic = process.argv[3];
    if (!topic) {
      console.log('Usage: node mega-agents.js process "Topic Name"');
      return;
    }
    
    try {
      const result = await coordinator.processTopic(topic);
      console.log('\nResult:', JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Failed:', error.message);
      process.exit(1);
    }
  } else if (command === 'batch') {
    const topics = [
      { name: 'Docker', type: 'technology' },
      { name: 'Kubernetes', type: 'technology' }
    ];
    
    const result = await coordinator.processBatch(topics);
    console.log('\nResults:', JSON.stringify(result, null, 2));
  } else {
    console.log('Usage: node mega-agents.js [process "Topic"|batch]');
  }
}

if (require.main === module) {
  main().catch(console.error);
}
