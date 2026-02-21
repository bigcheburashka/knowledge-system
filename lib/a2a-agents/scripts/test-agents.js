const { Agents } = require('./agents');
const fs = require('fs').promises;

async function cleanup() {
  const basePath = '/tmp/test-agents-v11';
  try {
    await fs.rm(basePath, { recursive: true, force: true });
  } catch {}
}

async function testResearchAgent() {
  console.log('Test: Research Agent');
  
  const agents = new Agents('/tmp/test-agents-v11');
  await agents.init();
  
  const task = { topic: 'AI', query: 'machine learning' };
  const result = await agents.researchAgent(task);
  
  console.assert(result.researched === true, 'Should have researched flag');
  console.assert(result.sources >= 3, 'Should have 3+ sources');
  console.assert(result.confidence > 0.8, 'Should have high confidence');
  
  console.log('  ✓ Research completes successfully');
  console.log('  ✓ Sources:', result.sources);
  console.log('  ✓ Confidence:', result.confidence.toFixed(2));
  
  console.log('  ✅ PASSED\n');
}

async function testSequentialPipeline() {
  console.log('Test: Sequential Pipeline');
  
  const agents = new Agents('/tmp/test-agents-v11');
  await agents.init();
  
  const task = { topic: 'Test Topic', query: 'test query' };
  
  // Execute sequentially
  const research = await agents.researchAgent(task);
  console.assert(research.researched, 'Research should complete');
  console.log('  ✓ Research complete');
  
  const factcheck = await agents.factCheckAgent();
  console.assert(factcheck.verified, 'FactCheck should complete');
  console.log('  ✓ FactCheck complete');
  
  const quality = await agents.qualityAgent();
  console.assert(quality.reviewed, 'Quality should complete');
  console.log('  ✓ Quality complete');
  
  const composer = await agents.composerAgent();
  console.assert(composer.final, 'Composer should complete');
  console.log('  ✓ Composer complete');
  
  console.log('  ✅ PASSED\n');
}

async function testExecutePipeline() {
  console.log('Test: Execute Full Pipeline');
  
  const agents = new Agents('/tmp/test-agents-v11');
  await agents.init();
  
  const task = { topic: 'Automation', query: 'best practices' };
  const result = await agents.executePipeline(task);
  
  console.assert(result.success === true, 'Pipeline should succeed');
  console.assert(result.duration > 0, 'Should have duration');
  console.assert(result.output.final === true, 'Should have final output');
  
  console.log('  ✓ Pipeline succeeded');
  console.log('  ✓ Duration:', result.duration, 'ms');
  console.log('  ✓ Stats:', result.stats);
  
  console.log('  ✅ PASSED\n');
}

async function testErrorHandling() {
  console.log('Test: Error Handling');
  
  // Use fresh instance with empty queues
  await cleanup();
  const agents = new Agents('/tmp/test-agents-v11');
  await agents.init();
  
  // Test: No input should throw (queue is empty)
  try {
    await agents.factCheckAgent(); // No input, queue empty
    console.log('  ❌ Should have thrown error');
    process.exit(1);
  } catch (err) {
    console.assert(err.message.includes('No input'), 'Should throw "No input" error');
    console.log('  ✓ Correctly throws on empty input');
  }
  
  console.log('  ✅ PASSED\n');
}

async function testStats() {
  console.log('Test: Agent Statistics');
  
  const agents = new Agents('/tmp/test-agents-v11');
  await agents.init();
  agents.resetStats();
  
  // Execute pipeline
  await agents.executePipeline({ topic: 'Stats Test' });
  
  const stats = agents.getStats();
  
  console.assert(stats.research.runs === 1, 'Research should have 1 run');
  console.assert(stats.factcheck.runs === 1, 'FactCheck should have 1 run');
  console.assert(stats.quality.runs === 1, 'Quality should have 1 run');
  console.assert(stats.composer.runs === 1, 'Composer should have 1 run');
  
  console.log('  ✓ All agents recorded runs');
  console.log('  ✓ Stats:', stats);
  
  console.log('  ✅ PASSED\n');
}

async function runAllTests() {
  console.log('=== A2A Async Agents Tests (v11) ===\n');
  
  await cleanup();
  
  try {
    await testResearchAgent();
    await testSequentialPipeline();
    await testExecutePipeline();
    await testErrorHandling();
    await testStats();
    
    console.log('=== All Tests PASSED ✅ ===');
    process.exit(0);
  } catch (err) {
    console.error('Test FAILED ❌:', err);
    console.error(err.stack);
    process.exit(1);
  }
}

runAllTests();
