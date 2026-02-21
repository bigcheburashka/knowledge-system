#!/usr/bin/env node
/**
 * Topic Enrichment Script
 * Checks quality of existing topics and enriches if needed
 */

const axios = require('axios');
const DeepLearningService = require('./scripts/deep-learning.js');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';

/**
 * Check if topic needs enrichment
 * Returns: { needsEnrichment: boolean, reasons: string[] }
 */
async function checkTopicQuality(topicName) {
  try {
    const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
      filter: { must: [{ key: 'name', match: { value: topicName } }] },
      with_payload: true,
      limit: 1
    });
    
    const point = response.data.result.points?.[0];
    if (!point) return { needsEnrichment: true, reasons: ['Not found'] };
    
    const payload = point.payload;
    const reasons = [];
    
    // Check description quality
    if (!payload.text || payload.text.length < 200) {
      reasons.push('Short description');
    }
    
    // Check related topics
    if (!payload.related || payload.related.length < 3) {
      reasons.push('Few related topics');
    }
    
    // Check best practices
    if (!payload.bestPractices || payload.bestPractices.length < 3) {
      reasons.push('Few best practices');
    }
    
    // Check common mistakes
    if (!payload.commonMistakes || payload.commonMistakes.length < 3) {
      reasons.push('Few common mistakes');
    }
    
    return {
      needsEnrichment: reasons.length > 0,
      reasons,
      currentId: point.id,
      currentPayload: payload
    };
  } catch (e) {
    return { needsEnrichment: true, reasons: ['Error checking: ' + e.message] };
  }
}

/**
 * Enrich existing topic with Mega-Agent
 */
async function enrichTopic(topicName, topicType, existingId) {
  console.log(`🔄 Enriching: ${topicName}`);
  
  const service = new DeepLearningService();
  await service.init?.().catch(() => {});
  
  // Generate enhanced content
  const enhanced = await service.generateExpertNoteWithMegaAgent(topicName, `Type: ${topicType}`);
  
  if (!enhanced) {
    console.log(`  ❌ Failed to generate enhanced content`);
    return false;
  }
  
  console.log(`  ✅ Generated enhanced content`);
  
  // Store with same ID (update)
  const stored = await service.storeKnowledge({
    ...enhanced,
    id: existingId,
    enriched: true,
    enrichedAt: new Date().toISOString()
  });
  
  return stored;
}

/**
 * Process topics with quality check
 */
async function processWithEnrichment(topics, options = {}) {
  const { enrichExisting = true, minQuality = 'medium' } = options;
  
  console.log(`📚 Processing ${topics.length} topics with quality checks...\n`);
  
  let processed = 0;
  let enriched = 0;
  let skipped = 0;
  
  for (const topic of topics) {
    console.log(`\n🔍 Checking: ${topic.name}`);
    
    const quality = await checkTopicQuality(topic.name);
    
    if (!quality.needsEnrichment) {
      console.log(`  ⏩ Skipping: High quality content`);
      skipped++;
      continue;
    }
    
    console.log(`  ⚠️  Needs enrichment: ${quality.reasons.join(', ')}`);
    
    if (quality.currentId && enrichExisting) {
      // Enrich existing
      const success = await enrichTopic(topic.name, topic.type, quality.currentId);
      if (success) {
        enriched++;
        console.log(`  ✅ Enriched successfully`);
      } else {
        console.log(`  ❌ Enrichment failed`);
      }
    } else {
      // Create new
      console.log(`  🆕 Will create new entry`);
      processed++;
    }
    
    // Delay between topics
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log(`  Processed: ${processed}`);
  console.log(`  Enriched: ${enriched}`);
  console.log(`  Skipped (high quality): ${skipped}`);
  console.log('='.repeat(60));
}

// Load custom topics and process
async function main() {
  const { execSync } = require('child_process');
  
  // Get topics from custom-topics
  const output = execSync('node custom-topics.js list 2>/dev/null || echo "[]"', {
    cwd: '/root/.openclaw/workspace/knowledge-system',
    encoding: 'utf8'
  });
  
  // Parse topics (simplified - would need proper parsing)
  const topics = [
    { name: 'Release It! - Production-Ready Software', type: 'book' },
    { name: 'Site Reliability Engineering - Google', type: 'book' },
    { name: 'Code Complete - Software Construction', type: 'book' },
    { name: 'Working Effectively with Legacy Code', type: 'book' },
    { name: 'Clean Code - Robert Martin', type: 'book' },
    { name: 'Building Microservices - Sam Newman', type: 'book' },
  ];
  
  await processWithEnrichment(topics, { enrichExisting: true });
}

main().catch(console.error);
