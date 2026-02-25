#!/usr/bin/env node
/**
 * Process remaining knowledge topics in chunks
 * Chunk 4, 5, 6 - Total 11 topics
 */

const DeepLearningService = require('./scripts/deep-learning');

const CHUNK_4 = [
  { name: 'Best Practice', type: 'pattern' },
  { name: 'Code Review', type: 'process' },
  { name: 'Vector Db', type: 'technology' },
  { name: 'Vector', type: 'technology' },
  { name: 'LLM', type: 'technology' }
];

const CHUNK_5 = [
  { name: 'Embedding', type: 'technology' },
  { name: 'Semantic Search', type: 'technology' },
  { name: 'Caching', type: 'technology' },
  { name: 'Rest', type: 'technology' }
];

const CHUNK_6 = [
  { name: 'Computer Networks - Tanenbaum', type: 'technology' },
  { name: 'Advanced Unix Programming', type: 'technology' }
];

async function processChunk(chunkNumber, topics) {
  console.log('\n' + '='.repeat(60));
  console.log(`🧠 Deep Learning — Chunk ${chunkNumber}`);
  console.log('='.repeat(60));
  console.log(`\n📚 Topics (${topics.length}):`);
  topics.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} (${t.type})`));
  console.log('');
  
  const service = new DeepLearningService();
  const results = {
    chunk: chunkNumber,
    processed: 0,
    stored: 0,
    skipped: 0,
    errors: []
  };
  
  try {
    await service.init();
    
    for (const topic of topics) {
      // Check if exists
      const exists = await service.topicExists(topic.name);
      if (exists) {
        console.log(`⏩ ${topic.name} already exists in Qdrant, skipping`);
        results.skipped++;
        continue;
      }
      
      console.log(`\n🔍 Expanding: ${topic.name}`);
      
      // Expand topic
      const note = await service.expandTopic(topic.name, topic.type);
      
      if (note) {
        // Store knowledge
        const stored_ok = await service.storeKnowledge(note);
        if (stored_ok) {
          console.log(`✅ Stored in Qdrant and Memgraph: ${topic.name}`);
          results.stored++;
        } else {
          results.errors.push({ topic: topic.name, error: 'Failed to store' });
        }
        results.processed++;
        
        // Delay between topics
        await new Promise(r => setTimeout(r, 1500));
      } else {
        results.errors.push({ topic: topic.name, error: 'Failed to expand' });
      }
    }
    
  } catch (error) {
    console.error(`❌ Chunk ${chunkNumber} error:`, error.message);
    results.errors.push({ error: error.message });
  }
  
  // Report chunk results
  console.log('\n' + '-'.repeat(60));
  console.log(`📊 CHUNK ${chunkNumber} RESULTS:`);
  console.log(`  Processed: ${results.processed}`);
  console.log(`  Stored: ${results.stored}`);
  console.log(`  Skipped: ${results.skipped}`);
  if (results.errors.length > 0) {
    console.log(`  Errors: ${results.errors.length}`);
    results.errors.forEach(e => console.log(`    - ${e.topic}: ${e.error}`));
  }
  console.log('-'.repeat(60));
  
  return results;
}

async function runAllChunks() {
  console.log('='.repeat(60));
  console.log('🚀 DEEP LEARNING - REMAINING TOPICS');
  console.log('='.repeat(60));
  
  const allResults = [];
  
  // Process Chunk 4
  const chunk4Result = await processChunk(4, CHUNK_4);
  allResults.push(chunk4Result);
  
  // Process Chunk 5
  const chunk5Result = await processChunk(5, CHUNK_5);
  allResults.push(chunk5Result);
  
  // Process Chunk 6
  const chunk6Result = await processChunk(6, CHUNK_6);
  allResults.push(chunk6Result);
  
  // Final Summary
  console.log('\n' + '='.repeat(60));
  console.log('📋 FINAL SUMMARY');
  console.log('='.repeat(60));
  
  const totalTopics = CHUNK_4.length + CHUNK_5.length + CHUNK_6.length;
  const totalProcessed = allResults.reduce((sum, r) => sum + r.processed, 0);
  const totalStored = allResults.reduce((sum, r) => sum + r.stored, 0);
  const totalSkipped = allResults.reduce((sum, r) => sum + r.skipped, 0);
  const totalErrors = allResults.reduce((sum, r) => sum + r.errors.length, 0);
  
  console.log(`\n📊 STATISTICS:`);
  console.log(`  Total topics in queue: ${totalTopics}`);
  console.log(`  Total processed: ${totalProcessed}`);
  console.log(`  Successfully stored: ${totalStored}`);
  console.log(`  Skipped (already existed): ${totalSkipped}`);
  console.log(`  Errors: ${totalErrors}`);
  
  console.log(`\n📊 PER CHUNK:`);
  allResults.forEach(r => {
    console.log(`  Chunk ${r.chunk}: ${r.processed} processed, ${r.stored} stored, ${r.skipped} skipped`);
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ DEEP LEARNING COMPLETE');
  console.log('='.repeat(60));
  
  return {
    totalTopics,
    totalProcessed,
    totalStored,
    totalSkipped,
    totalErrors,
    chunks: allResults
  };
}

// Run if executed directly
if (require.main === module) {
  runAllChunks()
    .then(summary => {
      console.log('\n📋 Summary:', JSON.stringify(summary, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { runAllChunks, processChunk };
