#!/usr/bin/env node
// Full System Integration Test

const HybridSearch = require('./hybrid-search');
const OpenClawAdapter = require('../src/openclaw-adapter');
const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

async function checkService(name, checkFn) {
  process.stdout.write(`Checking ${name}... `);
  try {
    const result = await checkFn();
    console.log('✅');
    return result;
  } catch (e) {
    console.log('❌', e.message);
    return null;
  }
}

async function runTests() {
  console.log('🧪 FULL SYSTEM INTEGRATION TEST\n');
  console.log('=' .repeat(60));
  
  const results = {
    services: {},
    search: {},
    integration: {}
  };
  
  // Test 1: Services
  console.log('\n1️⃣  SERVICES');
  console.log('-'.repeat(60));
  
  results.services.qdrant = await checkService('Qdrant', async () => {
    const resp = await axios.get(`${QDRANT_URL}/healthz`);
    return resp.data === 'healthz check passed';
  });
  
  results.services.memgraph = await checkService('Memgraph', async () => {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    await execAsync('echo "RETURN 1;" | docker exec -i knowledge-memgraph mgconsole');
    return true;
  });
  
  results.services.qdrantCollection = await checkService('Qdrant Collection', async () => {
    const resp = await axios.get(`${QDRANT_URL}/collections/knowledge`);
    return resp.data.result.points_count;
  });
  
  // Test 2: Hybrid Search
  console.log('\n2️⃣  HYBRID SEARCH');
  console.log('-'.repeat(60));
  
  const searcher = new HybridSearch();
  
  const searchQuery = 'Telegram bot framework';
  process.stdout.write(`Searching: "${searchQuery}"... `);
  try {
    const searchResults = await searcher.search(searchQuery, { limit: 3 });
    results.search.results = searchResults;
    results.search.success = searchResults.length > 0;
    console.log(`✅ (${searchResults.length} results)`);
    
    searchResults.slice(0, 3).forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.name || r.text.substring(0, 40)} (${r.hybridScore.toFixed(3)})`);
    });
  } catch (e) {
    console.log('❌', e.message);
    results.search.success = false;
  }
  
  // Test 3: OpenClaw Integration
  console.log('\n3️⃣  OPENCLAW INTEGRATION');
  console.log('-'.repeat(60));
  
  const adapter = new OpenClawAdapter({ hours: 24 });
  
  results.integration.sessions = await checkService('Session Discovery', async () => {
    const files = await adapter.findSessionFiles();
    return files.length;
  });
  
  results.integration.readSession = await checkService('Session Reading', async () => {
    const files = await adapter.findSessionFiles();
    if (files.length === 0) return 0;
    const session = await adapter.readSession(files[0].path);
    return session ? session.messageCount : 0;
  });
  
  results.integration.extractEntities = await checkService('Entity Extraction', async () => {
    const files = await adapter.findSessionFiles();
    if (files.length === 0) return 0;
    const session = await adapter.readSession(files[0].path);
    if (!session) return 0;
    const entities = adapter.extractEntities(session.messages.map(m => m.content).join('\n'));
    return entities.length;
  });
  
  // Test 4: Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  
  const allPassed = 
    results.services.qdrant &&
    results.services.memgraph &&
    results.services.qdrantCollection > 0 &&
    results.search.success;
  
  console.log(`\nServices:`);
  console.log(`  Qdrant: ${results.services.qdrant ? '✅' : '❌'}`);
  console.log(`  Memgraph: ${results.services.memgraph ? '✅' : '❌'}`);
  console.log(`  Vectors: ${results.services.qdrantCollection || 0}`);
  
  console.log(`\nSearch:`);
  console.log(`  Hybrid search: ${results.search.success ? '✅' : '❌'}`);
  if (results.search.success) {
    console.log(`  Top result: ${results.search.results[0]?.name || 'N/A'}`);
  }
  
  console.log(`\nIntegration:`);
  console.log(`  Sessions found: ${results.integration.sessions || 0}`);
  console.log(`  Entity extraction: ${results.integration.extractEntities || 0} entities`);
  
  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('✅ ALL TESTS PASSED - System is operational');
  } else {
    console.log('⚠️  SOME TESTS FAILED - Check logs above');
  }
  console.log('='.repeat(60));
  
  return allPassed;
}

runTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(e => {
  console.error('\n❌ Fatal error:', e);
  process.exit(1);
});