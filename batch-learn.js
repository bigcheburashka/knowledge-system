#!/usr/bin/env node
/**
 * Batch Deep Learning Runner
 * Processes all topics in queue
 */

const DeepLearningService = require('./scripts/deep-learning.js');

async function runAll() {
  console.log('🚀 Starting batch processing of all topics...\n');
  
  const service = new DeepLearningService();
  // No init() method needed - constructor handles initialization
  
  let totalProcessed = 0;
  let batch = 1;
  const maxBatches = 10; // Safety limit
  
  while (batch <= maxBatches) {
    console.log(`\n📦 Batch ${batch}: Processing up to 10 topics...`);
    
    try {
      const result = await service.run({ limit: 10, customOnly: true });
      
      console.log(`✅ Batch ${batch} complete: ${result.processed} topics`);
      totalProcessed += result.processed;
      
      if (result.processed === 0) {
        console.log('\n🎉 No more topics to process!');
        break;
      }
      
      batch++;
      
      // Delay between batches
      if (batch <= maxBatches) {
        console.log('⏳ Waiting 3 seconds before next batch...');
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      console.error(`❌ Batch ${batch} failed:`, err.message);
      break;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`🎉 COMPLETE: Total ${totalProcessed} topics processed`);
  console.log('='.repeat(60));
}

runAll().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
