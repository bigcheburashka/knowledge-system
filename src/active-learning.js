#!/usr/bin/env node
// Active Learning Service - Human-in-the-loop for uncertain cases

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';
const PENDING_DIR = '/root/.openclaw/workspace/knowledge-state/pending';
const CONFIDENCE_THRESHOLD = 0.6;

class ActiveLearning {
  constructor() {
    this.pendingReviews = [];
  }

  async init() {
    await fs.mkdir(PENDING_DIR, { recursive: true });
    await this.loadPending();
  }

  async loadPending() {
    try {
      const files = await fs.readdir(PENDING_DIR);
      this.pendingReviews = [];
      for (const file of files.filter(f => f.endsWith('.json'))) {
        const data = await fs.readFile(path.join(PENDING_DIR, file), 'utf-8');
        this.pendingReviews.push(JSON.parse(data));
      }
    } catch (e) {
      this.pendingReviews = [];
    }
  }

  // Detect uncertainty in extraction
  async assessConfidence(entity, context) {
    const checks = {
      hasContext: context.length > 50,
      isSpecific: entity.text.length > 3 && entity.text.length < 100,
      notDuplicate: await this.checkDuplicate(entity),
      hasRelations: entity.type === 'technology' || entity.type === 'problem',
      clearCategory: ['technology', 'problem', 'solution', 'pattern'].includes(entity.type)
    };

    const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
    
    return {
      confidence: score,
      uncertain: score < CONFIDENCE_THRESHOLD,
      reasons: Object.entries(checks)
        .filter(([, v]) => !v)
        .map(([k]) => k)
    };
  }

  async checkDuplicate(entity) {
    try {
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
        {
          limit: 100,
          with_payload: true,
          filter: {
            must: [
              { key: 'name', match: { value: entity.text } }
            ]
          }
        }
      );
      return response.data.result.points.length === 0;
    } catch (e) {
      return true;
    }
  }

  // Queue entity for human review
  async requestReview(entity, context, confidence) {
    const review = {
      id: `review_${Date.now()}`,
      timestamp: new Date().toISOString(),
      entity,
      context: context.substring(0, 500),
      confidence: confidence.confidence,
      reasons: confidence.reasons,
      status: 'pending',
      userDecision: null,
      userFeedback: null
    };

    await fs.writeFile(
      path.join(PENDING_DIR, `${review.id}.json`),
      JSON.stringify(review, null, 2)
    );

    this.pendingReviews.push(review);
    
    // Send notification
    await this.notifyUser(review);
    
    return review;
  }

  async notifyUser(review) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!botToken || !chatId) return;

    const message = `🤔 *Active Learning: Review Requested*

*Entity:* \`${review.entity.text}\`
*Type:* ${review.entity.type}
*Confidence:* ${(review.confidence * 100).toFixed(0)}%

*Uncertain because:*
${review.reasons.map(r => `• ${r}`).join('\n')}

*Context:*
\`${review.context.substring(0, 200)}...\`

Reply with:
• /approve ${review.id} — Add to knowledge base
• /reject ${review.id} — Discard
• /modify ${review.id} [new type] — Change type`;

    try {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      });
    } catch (e) {
      console.error('Notification failed:', e.message);
    }
  }

  // Process user decision
  async processDecision(reviewId, decision, feedback = '') {
    const review = this.pendingReviews.find(r => r.id === reviewId);
    if (!review) return null;

    review.status = decision === 'approve' ? 'approved' : 'rejected';
    review.userDecision = decision;
    review.userFeedback = feedback;
    review.decisionTimestamp = new Date().toISOString();

    await fs.writeFile(
      path.join(PENDING_DIR, `${review.id}.json`),
      JSON.stringify(review, null, 2)
    );

    if (decision === 'approve') {
      // Add to knowledge base
      console.log(`✅ Approved: ${review.entity.text}`);
      return { action: 'added', review };
    } else {
      console.log(`❌ Rejected: ${review.entity.text}`);
      return { action: 'rejected', review };
    }
  }

  // Feedback loop: track solution quality
  async recordFeedback(solutionId, wasHelpful, userComment = '') {
    const feedback = {
      solutionId,
      wasHelpful,
      userComment,
      timestamp: new Date().toISOString()
    };

    await fs.writeFile(
      path.join(PENDING_DIR, `feedback_${solutionId}.json`),
      JSON.stringify(feedback, null, 2)
    );

    // Update entity success rate
    if (wasHelpful) {
      console.log(`👍 Solution ${solutionId} marked as helpful`);
    } else {
      console.log(`👎 Solution ${solutionId} did not help`);
    }

    return feedback;
  }

  // Auto-extract with uncertainty handling
  async smartExtract(entity, context) {
    const confidence = await this.assessConfidence(entity, context);
    
    if (confidence.uncertain) {
      console.log(`⚠️  Uncertain about "${entity.text}" (${(confidence.confidence * 100).toFixed(0)}%)`);
      const review = await this.requestReview(entity, context, confidence);
      return {
        action: 'pending_review',
        reviewId: review.id,
        confidence: confidence.confidence
      };
    }
    
    console.log(`✅ Confident about "${entity.text}" (${(confidence.confidence * 100).toFixed(0)}%)`);
    return {
      action: 'auto_added',
      confidence: confidence.confidence
    };
  }

  // Get pending reviews
  async getPendingReviews() {
    return this.pendingReviews.filter(r => r.status === 'pending');
  }

  // Get statistics
  async getStats() {
    const approved = this.pendingReviews.filter(r => r.status === 'approved').length;
    const rejected = this.pendingReviews.filter(r => r.status === 'rejected').length;
    const pending = this.pendingReviews.filter(r => r.status === 'pending').length;
    
    return {
      total: this.pendingReviews.length,
      approved,
      rejected,
      pending,
      autoAcceptanceRate: approved / (approved + rejected) || 0
    };
  }
}

// CLI
if (require.main === module) {
  const al = new ActiveLearning();
  const command = process.argv[2];
  
  al.init().then(async () => {
    switch (command) {
      case 'pending':
        const pending = await al.getPendingReviews();
        console.log(`\n📝 Pending reviews: ${pending.length}`);
        pending.forEach((r, i) => {
          console.log(`${i + 1}. ${r.entity.text} (${(r.confidence * 100).toFixed(0)}%)`);
        });
        break;
        
      case 'decide':
        const result = await al.processDecision(
          process.argv[3],
          process.argv[4], // approve/reject
          process.argv[5] || ''
        );
        console.log(result ? `✅ Decision recorded` : '❌ Review not found');
        break;
        
      case 'stats':
        const stats = await al.getStats();
        console.log('\n📊 Active Learning Stats:');
        console.log(`  Total reviews: ${stats.total}`);
        console.log(`  Approved: ${stats.approved}`);
        console.log(`  Rejected: ${stats.rejected}`);
        console.log(`  Pending: ${stats.pending}`);
        break;
        
      case 'test':
        const test = await al.smartExtract(
          { text: process.argv[3] || 'TestEntity', type: 'technology' },
          process.argv[4] || 'Some context about this entity'
        );
        console.log('Result:', test);
        break;
        
      default:
        console.log('Usage:');
        console.log('  active-learning.js pending — List pending reviews');
        console.log('  active-learning.js decide [reviewId] [approve|reject] [feedback]');
        console.log('  active-learning.js stats — Show statistics');
        console.log('  active-learning.js test [entity] [context]');
    }
  });
}

module.exports = ActiveLearning;