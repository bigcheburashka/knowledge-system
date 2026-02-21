#!/usr/bin/env node
// Self-Validation Service - Auto-approve/reject based on similarity

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { getEmbedding } = require('./embedding-service');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';
const PENDING_DIR = '/root/.openclaw/workspace/knowledge-state/pending';

class SelfValidation {
  constructor() {
    this.thresholds = {
      autoApprove: 0.85,  // Very similar to existing
      autoReject: 0.3,    // Too different, probably noise
      defer: 0.6          // Uncertain, needs more context
    };
  }

  async init() {
    await fs.mkdir(PENDING_DIR, { recursive: true });
  }

  // Main validation logic
  async validate(entity, context) {
    console.log(`🔍 Self-validating: "${entity.text}"`);

    const checks = await Promise.all([
      this.checkSimilarity(entity),
      this.checkDuplicates(entity),
      this.checkContextQuality(context),
      this.checkRelations(entity)
    ]);

    const score = this.calculateScore(checks);
    
    console.log(`  Similarity: ${(checks[0].score * 100).toFixed(1)}%`);
    console.log(`  Duplicate: ${checks[1].isDuplicate ? 'YES' : 'NO'}`);
    console.log(`  Context quality: ${(checks[2].quality * 100).toFixed(1)}%`);
    console.log(`  Relations: ${checks[3].hasRelations ? 'YES' : 'NO'}`);
    console.log(`  Final score: ${(score * 100).toFixed(1)}%`);

    // Decision logic
    if (score >= this.thresholds.autoApprove && !checks[1].isDuplicate) {
      return {
        decision: 'auto_approve',
        score,
        reason: `High similarity (${(checks[0].score * 100).toFixed(0)}%) to existing knowledge`,
        similarTo: checks[0].similarEntity
      };
    }

    if (score <= this.thresholds.autoReject || checks[1].isDuplicate) {
      return {
        decision: 'auto_reject',
        score,
        reason: checks[1].isDuplicate 
          ? 'Duplicate of existing entity' 
          : `Low quality (${(score * 100).toFixed(0)}%), probably noise`
      };
    }

    // Middle ground - defer for later
    return {
      decision: 'defer',
      score,
      reason: `Uncertain (${(score * 100).toFixed(0)}%), will re-check after 24h`,
      reCheckAfter: Date.now() + (24 * 60 * 60 * 1000)
    };
  }

  // Check 1: Similarity to existing entities
  async checkSimilarity(entity) {
    try {
      const embedding = await getEmbedding(entity.text);
      
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/search`,
        {
          vector: embedding,
          limit: 3,
          with_payload: true
        }
      );

      if (response.data.result.length === 0) {
        return { score: 0, similarEntity: null };
      }

      const topMatch = response.data.result[0];
      return {
        score: topMatch.score,
        similarEntity: topMatch.payload.name
      };
    } catch (e) {
      return { score: 0, similarEntity: null };
    }
  }

  // Check 2: Duplicate detection
  async checkDuplicates(entity) {
    try {
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
        {
          limit: 100,
          with_payload: true
        }
      );

      const normalizedText = entity.text.toLowerCase().trim();
      const isDuplicate = response.data.result.points.some(p => 
        p.payload.name?.toLowerCase().trim() === normalizedText
      );

      return { isDuplicate };
    } catch (e) {
      return { isDuplicate: false };
    }
  }

  // Check 3: Context quality
  checkContextQuality(context) {
    const checks = {
      hasMinLength: context.length > 50,
      hasMaxLength: context.length < 10000,
      hasRelevance: !context.includes('```') || context.includes(entity.text), // Not just code
      hasClarity: context.split(' ').length > 5 // More than 5 words
    };

    const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
    return { quality: score };
  }

  // Check 4: Relation potential
  async checkRelations(entity) {
    // Simple check: does it mention known technologies/problems?
    const knownTypes = ['Node.js', 'Docker', 'React', 'error', 'fix', 'bug'];
    const hasRelations = knownTypes.some(kw => 
      entity.text.toLowerCase().includes(kw.toLowerCase())
    );

    return { hasRelations };
  }

  calculateScore(checks) {
    const weights = {
      similarity: 0.4,
      duplicate: 0.2,  // Inverted - duplicate is bad
      context: 0.25,
      relations: 0.15
    };

    const duplicateScore = checks[1].isDuplicate ? 0 : 1;

    return (
      checks[0].score * weights.similarity +
      duplicateScore * weights.duplicate +
      checks[2].quality * weights.context +
      (checks[3].hasRelations ? 1 : 0) * weights.relations
    );
  }

  // Process a pending item
  async processPending(reviewId) {
    const filePath = path.join(PENDING_DIR, `${reviewId}.json`);
    
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const review = JSON.parse(data);

      if (review.status !== 'pending') {
        return { status: 'already_processed', decision: review.status };
      }

      const validation = await this.validate(review.entity, review.context);

      // Update review
      review.status = validation.decision === 'defer' ? 'deferred' : validation.decision;
      review.validation = validation;
      review.processedAt = new Date().toISOString();

      await fs.writeFile(filePath, JSON.stringify(review, null, 2));

      console.log(`✅ ${reviewId}: ${validation.decision}`);
      console.log(`   Reason: ${validation.reason}`);

      return validation;
    } catch (e) {
      console.error(`❌ Error processing ${reviewId}:`, e.message);
      return { error: e.message };
    }
  }

  // Run self-validation on all pending
  async validateAll() {
    const files = await fs.readdir(PENDING_DIR);
    const pendingFiles = files.filter(f => f.endsWith('.json') && f.startsWith('review_'));

    console.log(`\n🔍 Processing ${pendingFiles.length} pending reviews...\n`);

    const results = {
      auto_approved: 0,
      auto_rejected: 0,
      deferred: 0,
      errors: 0
    };

    for (const file of pendingFiles) {
      const reviewId = file.replace('.json', '');
      const result = await this.processPending(reviewId);
      
      if (result.decision) {
        results[result.decision.replace('-', '_')]++;
      } else if (result.error) {
        results.errors++;
      }
    }

    console.log('\n📊 Results:');
    console.log(`  Auto-approved: ${results.auto_approved}`);
    console.log(`  Auto-rejected: ${results.auto_rejected}`);
    console.log(`  Deferred: ${results.deferred}`);
    console.log(`  Errors: ${results.errors}`);

    return results;
  }
}

// CLI
if (require.main === module) {
  const validator = new SelfValidation();
  const command = process.argv[2];

  validator.init().then(async () => {
    switch (command) {
      case 'validate':
        const entity = process.argv[3] || 'TestEntity';
        const context = process.argv[4] || 'Some context about this entity';
        const result = await validator.validate(
          { text: entity, type: 'technology' },
          context
        );
        console.log('\nResult:', result);
        break;

      case 'process':
        const reviewId = process.argv[3];
        if (reviewId) {
          await validator.processPending(reviewId);
        } else {
          await validator.validateAll();
        }
        break;

      case 'all':
        await validator.validateAll();
        break;

      default:
        console.log('Usage:');
        console.log('  self-validation.js validate "EntityName" "context"');
        console.log('  self-validation.js process [reviewId]');
        console.log('  self-validation.js all');
    }
  });
}

module.exports = SelfValidation;