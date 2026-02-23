#!/usr/bin/env node
// Test with new unique topics to see full pipeline

const DeepLearningService = require('./scripts/deep-learning.js');

const TEST_TOPICS = [
  { name: 'WebAssembly System Interface (WASI)', type: 'technology' },
  { name: 'eBPF Kernel Programming', type: 'technology' },
  { name: 'CRDT Data Structures', type: 'technology' }
];

class TestRunner {
  constructor() {
    this.timing = {};
  }

  async run() {
    console.log('='.repeat(70));
    console.log('🧠 TESTING DEEP LEARNING PIPELINE');
    console.log('='.repeat(70));
    
    const service = new DeepLearningService();
    await service.init();
    
    // Override topic extraction to use our test topics
    service.extractTopicsFromSessions = async () => ({
      technologies: TEST_TOPICS.map(t => t.name),
      problems: [],
      solutions: [],
      patterns: [],
      sessionCount: 0,
      customTopicsCount: TEST_TOPICS.length
    });
    
    const startTime = Date.now();
    
    // Run with limit of 3
    const result = await service.run({ limit: 3, customOnly: false });
    
    this.timing.total = Date.now() - startTime;
    
    console.log('\n' + '='.repeat(70));
    console.log('📊 FINAL RESULTS');
    console.log('='.repeat(70));
    console.log('New vectors:', result.newVectors);
    console.log('Total vectors:', result.totalVectors);
    console.log('Processed:', result.processed);
    console.log('Stats:', JSON.stringify(result.stats, null, 2));
    console.log('Total time:', this.timing.total + 'ms');
    
    return result;
  }
}

new TestRunner().run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
