#!/usr/bin/env node
/**
 * Process specific topics through Deep Learning
 * Обработка конкретных тем (чанками по 5)
 */

const DeepLearningService = require('./scripts/deep-learning');

const CHUNK_3 = [
  'pnpm',
  'express',
  'fastify',
  'Typescript',
  'Testing'
];

async function processChunk(topics) {
  console.log('🧠 Deep Learning — Chunk Processing\n');
  console.log('=' .repeat(60));
  console.log(`\n📚 Processing ${topics.length} topics:\n`);
  topics.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  console.log('');
  
  const service = new DeepLearningService();
  
  try {
    await service.init();
    
    let processed = 0;
    let stored = 0;
    let skipped = 0;
    
    for (const topicName of topics) {
      // Check if exists
      const exists = await service.topicExists(topicName);
      if (exists) {
        console.log(`⏩ ${topicName} already exists, skipping`);
        skipped++;
        continue;
      }
      
      console.log(`\n🔍 Processing: ${topicName}`);
      
      // Expand topic
      const note = await service.expandTopic(topicName, 'technology');
      
      if (note) {
        // Store knowledge
        const stored_ok = await service.storeKnowledge(note);
        if (stored_ok) {
          console.log(`✅ Stored: ${topicName}`);
          stored++;
        }
        processed++;
        
        // Delay between topics
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    console.log('\n' + '=' .repeat(60));
    console.log('📊 RESULTS:\n');
    console.log(`  Processed: ${processed}`);
    console.log(`  Stored: ${stored}`);
    console.log(`  Skipped: ${skipped}`);
    console.log('=' .repeat(60));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

processChunk(CHUNK_3);
