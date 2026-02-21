#!/usr/bin/env node
/**
 * Improved Book Processing with Checkpointing, Timeouts & Circuit Breaker
 * P0 Improvements Implementation
 */

const DeepLearningService = require('./scripts/deep-learning.js');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const CONFIG = {
  TIMEOUT_PER_SECTION: 10 * 60 * 1000, // 10 minutes
  MAX_RETRIES: 3,
  RETRY_DELAY_BASE: 30 * 1000, // 30 seconds
  CIRCUIT_BREAKER_THRESHOLD: 3,
  CIRCUIT_BREAKER_TIMEOUT: 60 * 1000, // 1 minute
  CHECKPOINT_FILE: '/var/log/knowledge/book-checkpoint.json',
  LOG_FILE: '/var/log/knowledge/books-improved.log'
};

// Book sections configuration
const BOOKS = [
  {
    name: 'Code Complete - Software Construction',
    sections: [
      'Code Complete Part I Laying the Foundation',
      'Code Complete Part II Creating High Quality Code', 
      // 'Code Complete Part III Variables Best Practices', // SKIP - hangs
      'Code Complete Part IV Statements Best Practices',
      'Code Complete Part V Code Improvements Best Practices',
      'Code Complete Part VI System Considerations Best Practices',
      'Code Complete Part VII Software Craftsmanship Best Practices'
    ]
  },
  {
    name: 'Working Effectively with Legacy Code',
    sections: [
      'Legacy Code Part I Mechanics of Change',
      'Legacy Code Part II Changing Software',
      'Legacy Code Part III Dependency Breaking Techniques'
    ]
  },
  {
    name: 'Clean Code',
    sections: [
      'Clean Code Chapter 1 Clean Code Principles',
      'Clean Code Chapter 2 Meaningful Names',
      'Clean Code Chapter 3 Functions Best Practices',
      'Clean Code Chapter 4 Comments Best Practices',
      'Clean Code Chapter 5 Formatting Best Practices'
    ]
  },
  {
    name: 'Building Microservices',
    sections: [
      'Microservices Chapter 1 Introduction',
      'Microservices Chapter 2 Evolutionary Architect',
      'Microservices Chapter 3 Modeling Services',
      'Microservices Chapter 4 Integration Patterns',
      'Microservices Chapter 5 Splitting Monolith'
    ]
  },
  {
    name: 'Designing Data-Intensive Applications',
    sections: [
      'Data Intensive Applications Part I Foundations',
      'Data Intensive Applications Part II Distributed Data',
      'Data Intensive Applications Part III Derived Data'
    ]
  },
  {
    name: 'Release It',
    sections: [
      'Release It Part I Create Stability',
      'Release It Part II Design for Production'
    ]
  },
  {
    name: 'Site Reliability Engineering',
    sections: [
      'SRE Part I Introduction to SRE',
      'SRE Part II Principles',
      'SRE Part III Practices',
      'SRE Part IV Management'
    ]
  }
];

/**
 * Circuit Breaker for LLM API protection
 */
class CircuitBreaker {
  constructor(threshold = CONFIG.CIRCUIT_BREAKER_THRESHOLD, timeout = CONFIG.CIRCUIT_BREAKER_TIMEOUT) {
    this.failures = 0;
    this.threshold = threshold;
    this.timeout = timeout;
    this.state = 'CLOSED';
    this.lastFailureTime = null;
  }

  async execute(fn) {
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure > this.timeout) {
        this.state = 'HALF_OPEN';
        console.log('  🔓 Circuit breaker: HALF_OPEN (testing)');
      } else {
        throw new Error(`Circuit breaker is OPEN. Retry after ${Math.ceil((this.timeout - timeSinceLastFailure) / 1000)}s`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  onSuccess() {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      console.log('  🔒 Circuit breaker: CLOSED (recovered)');
    }
  }

  onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      console.log(`  🚫 Circuit breaker: OPEN (${this.failures} failures)`);
    }
  }
}

/**
 * Checkpoint Manager for progress tracking
 */
class CheckpointManager {
  constructor(filePath) {
    this.filePath = filePath;
    this.checkpoint = null;
  }

  async load() {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      this.checkpoint = JSON.parse(data);
      console.log(`📂 Loaded checkpoint: ${this.checkpoint.completed.length} completed, ${this.checkpoint.failed.length} failed`);
      return this.checkpoint;
    } catch (e) {
      this.checkpoint = { completed: [], failed: [], startedAt: new Date().toISOString() };
      return this.checkpoint;
    }
  }

  async save(sectionId, status, error = null) {
    if (!this.checkpoint) await this.load();
    
    if (status === 'completed') {
      if (!this.checkpoint.completed.includes(sectionId)) {
        this.checkpoint.completed.push(sectionId);
      }
    } else if (status === 'failed') {
      this.checkpoint.failed.push({ sectionId, error, time: new Date().toISOString() });
    }
    
    this.checkpoint.lastUpdate = new Date().toISOString();
    await fs.writeFile(this.filePath, JSON.stringify(this.checkpoint, null, 2));
  }

  isCompleted(sectionId) {
    return this.checkpoint?.completed?.includes(sectionId) || false;
  }

  getStats() {
    return {
      completed: this.checkpoint?.completed?.length || 0,
      failed: this.checkpoint?.failed?.length || 0,
      total: (this.checkpoint?.completed?.length || 0) + (this.checkpoint?.failed?.length || 0)
    };
  }
}

/**
 * Simplify topic for retry
 */
function simplifyTopic(topic) {
  // Remove complex patterns
  return topic
    .replace(/Part \w+:/gi, '')
    .replace(/Chapter \d+:/gi, '')
    .replace(/\s+/g, ' ')
    .trim() + ' Best Practices';
}

/**
 * Process section with timeout, retry and circuit breaker
 */
async function processSection(service, section, checkpoint, circuitBreaker, attempt = 1) {
  const sectionId = section.replace(/\s+/g, '_').toLowerCase();
  
  // Check if already completed
  if (checkpoint.isCompleted(sectionId)) {
    console.log(`  ⏩ Already completed, skipping`);
    return { status: 'skipped', reason: 'already_completed' };
  }

  console.log(`  Attempt ${attempt}/${CONFIG.MAX_RETRIES}...`);

  try {
    // Use circuit breaker
    const result = await circuitBreaker.execute(async () => {
      // Set timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), CONFIG.TIMEOUT_PER_SECTION)
      );
      
      // Process
      const processPromise = (async () => {
        const expanded = await service.expandTopic(section, 'book-section');
        if (expanded) {
          await service.storeKnowledge(expanded);
          return expanded;
        }
        return null;
      })();
      
      return await Promise.race([processPromise, timeoutPromise]);
    });

    if (result) {
      await checkpoint.save(sectionId, 'completed');
      console.log(`  ✅ Saved`);
      return { status: 'completed', id: sectionId };
    } else {
      console.log(`  ⏩ Skipped (exists)`);
      await checkpoint.save(sectionId, 'completed');
      return { status: 'skipped', reason: 'exists' };
    }

  } catch (err) {
    console.log(`  ❌ Error: ${err.message}`);
    
    if (attempt < CONFIG.MAX_RETRIES) {
      // Retry with simplified topic
      const simplified = simplifyTopic(section);
      console.log(`  🔄 Retrying with simplified: "${simplified}"`);
      
      // Wait before retry
      const delay = CONFIG.RETRY_DELAY_BASE * attempt;
      console.log(`  ⏳ Waiting ${delay / 1000}s before retry...`);
      await new Promise(r => setTimeout(r, delay));
      
      return processSection(service, simplified, checkpoint, circuitBreaker, attempt + 1);
    } else {
      // Max retries reached
      await checkpoint.save(sectionId, 'failed', err.message);
      return { status: 'failed', error: err.message };
    }
  }
}

/**
 * Main processing function
 */
// Enhanced error handling and logging
process.on('exit', (code) => {
  console.log(`\n👋 Process exiting with code: ${code}`);
});

process.on('uncaughtException', (err) => {
  console.error('\n💥 UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

async function main() {
  console.log('='.repeat(70));
  console.log('📚 IMPROVED BOOK PROCESSING v2');
  console.log('   Features: Checkpointing | Timeout | Retry | Circuit Breaker | Debug Logging');
  console.log('='.repeat(70));
  console.log(`📝 Process PID: ${process.pid}`);
  console.log(`📝 Started at: ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  const service = new DeepLearningService();
  const checkpoint = new CheckpointManager(CONFIG.CHECKPOINT_FILE);
  const circuitBreaker = new CircuitBreaker();
  
  await checkpoint.load();

  let totalSections = 0;
  let completedSections = 0;
  let failedSections = 0;

  for (const book of BOOKS) {
    console.log(`\n📖 ${book.name}`);
    console.log(`   Sections: ${book.sections.length}`);
    
    for (let i = 0; i < book.sections.length; i++) {
      const section = book.sections[i];
      totalSections++;
      
      console.log(`\n  [${i + 1}/${book.sections.length}] ${section}`);
      
      const result = await processSection(service, section, checkpoint, circuitBreaker);
      
      if (result.status === 'completed') {
        completedSections++;
      } else if (result.status === 'failed') {
        failedSections++;
      }

      // Progress report
      if (totalSections % 5 === 0) {
        const stats = checkpoint.getStats();
        console.log(`\n📊 Progress: ${stats.completed} completed, ${stats.failed} failed`);
      }

      // Delay between sections
      if (i < book.sections.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    // Delay between books
    if (BOOKS.indexOf(book) < BOOKS.length - 1) {
      console.log('\n⏳ Waiting 10s before next book...');
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('🎉 PROCESSING COMPLETE');
  console.log(`   Total sections: ${totalSections}`);
  console.log(`   Completed: ${completedSections}`);
  console.log(`   Failed: ${failedSections}`);
  console.log(`   Success rate: ${((completedSections / totalSections) * 100).toFixed(1)}%`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
