#!/usr/bin/env node
// Test Hybrid Search Quality

const HybridSearch = require('./hybrid-search');

const testCases = [
  {
    query: "Telegram bot framework",
    expected: ["Telegraf", "cashback-advisor-bot", "Node.js"],
    description: "Find Telegram bot related technologies"
  },
  {
    query: "database caching solution",
    expected: ["Redis", "PostgreSQL"],
    description: "Find database technologies"
  },
  {
    query: "fix race condition",
    expected: ["Race Condition Protection", "Set duplicate protection"],
    description: "Find solutions to race conditions"
  },
  {
    query: "JavaScript runtime",
    expected: ["Node.js", "TypeScript"],
    description: "Find JavaScript technologies"
  },
  {
    query: "Docker deployment container",
    expected: ["Docker", "Docker Compose"],
    description: "Find containerization tech"
  }
];

async function runTests() {
  console.log('🧪 HYBRID SEARCH QUALITY TESTS\n');
  console.log('=' .repeat(60));
  
  const searcher = new HybridSearch();
  let passed = 0;
  let totalRecall = 0;
  
  for (const test of testCases) {
    console.log(`\n📋 Test: ${test.description}`);
    console.log(`Query: "${test.query}"`);
    
    const results = await searcher.search(test.query, { limit: 5 });
    
    // Check if expected items are in results
    const found = test.expected.filter(exp => 
      results.some(r => 
        (r.name || '').toLowerCase().includes(exp.toLowerCase()) ||
        (r.text || '').toLowerCase().includes(exp.toLowerCase())
      )
    );
    
    const recall = found.length / test.expected.length;
    totalRecall += recall;
    
    console.log(`Expected: ${test.expected.join(', ')}`);
    console.log(`Found: ${found.join(', ') || 'NONE'}`);
    console.log(`Recall: ${(recall * 100).toFixed(0)}%`);
    
    if (recall >= 0.5) {
      console.log('✅ PASS');
      passed++;
    } else {
      console.log('❌ FAIL');
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 SUMMARY`);
  console.log(`Tests passed: ${passed}/${testCases.length}`);
  console.log(`Average Recall@5: ${(totalRecall / testCases.length * 100).toFixed(1)}%`);
  
  const avgRecall = totalRecall / testCases.length;
  if (avgRecall >= 0.75) {
    console.log('✅ Target met: Recall@5 > 75%');
  } else if (avgRecall >= 0.60) {
    console.log('⚠️  Below target: Recall@5 60-75%');
  } else {
    console.log('❌ Poor performance: Recall@5 < 60%');
  }
  
  return avgRecall;
}

runTests().then(recall => {
  process.exit(recall >= 0.60 ? 0 : 1);
}).catch(e => {
  console.error('❌ Test error:', e);
  process.exit(1);
});