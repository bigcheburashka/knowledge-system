#!/usr/bin/env node
// Auto-extract from OpenClaw sessions and store in knowledge base

const OpenClawAdapter = require('../src/openclaw-adapter');
const { getEmbeddingsBatch } = require('../src/embedding-service');
const { getFeatureFlags } = require('../src/feature-flags');
const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const MEMGRAPH_HOST = process.env.MEMGRAPH_HOST || 'localhost';
const MEMGRAPH_PORT = process.env.MEMGRAPH_PORT || '7687';
const COLLECTION = 'knowledge';

// Initialize feature flags
const flags = getFeatureFlags();

async function getNextId() {
  try {
    const response = await axios.post(
      `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
      { limit: 1, with_payload: false }
    );
    const maxId = response.data.result.points.reduce((max, p) => Math.max(max, p.id), 0);
    return maxId + 1;
  } catch (e) {
    return 1000; // Start from 1000 for auto-extracted
  }
}

async function storeInQdrant(points) {
  if (points.length === 0) return;
  
  await axios.put(
    `${QDRANT_URL}/collections/${COLLECTION}/points`,
    { points },
    { headers: { 'Content-Type': 'application/json' } }
  );
}

// Store entities in Memgraph (Graph DB)
async function storeInMemgraph(entities, sessionId) {
  if (entities.length === 0) return;
  
  const neo4j = require('neo4j-driver');
  const driver = neo4j.driver(
    `bolt://${MEMGRAPH_HOST}:7687`,
    neo4j.auth.basic('', '')
  );
  
  const session = driver.session();
  
  try {
    for (const entity of entities) {
      // Create node
      await session.run(
        `MERGE (e:Entity {name: $name})
         SET e.type = $type,
             e.sessionId = $sessionId,
             e.createdAt = coalesce(e.createdAt, datetime()),
             e.updatedAt = datetime()`,
        {
          name: entity.text,
          type: entity.type,
          sessionId: sessionId
        }
      );
      
      // Create relations
      for (const other of entities) {
        if (entity.text !== other.text) {
          await session.run(
            `MATCH (a:Entity {name: $nameA})
             MATCH (b:Entity {name: $nameB})
             MERGE (a)-[r:MENTIONED_WITH]->(b)
             ON CREATE SET r.count = 1
             ON MATCH SET r.count = r.count + 1`,
            {
              nameA: entity.text,
              nameB: other.text
            }
          );
        }
      }
    }
  } finally {
    await session.close();
    await driver.close();
  }
}

async function extractAndStore() {
  console.log('🤖 AUTO-EXTRACTION FROM OPENCLAW SESSIONS\n');
  console.log('=' .repeat(60));
  
  // Check if auto-extract is enabled
  if (!flags.isEnabled('AUTO_EXTRACT')) {
    console.log('⏸️ Auto-extraction is disabled via feature flags');
    return;
  }
  
  const adapter = new OpenClawAdapter({ hours: 24 });
  
  // Get recent sessions
  console.log('\n📁 Scanning for recent sessions...');
  const sessions = await adapter.getRecentSessions();
  
  if (sessions.length === 0) {
    console.log('ℹ️  No recent sessions found');
    return;
  }
  
  console.log(`\n📊 Processing ${sessions.length} sessions...`);
  
  let totalEntities = 0;
  let nextId = await getNextId();
  
  for (const session of sessions) {
    console.log(`\n📝 Session: ${session.id}`);
    console.log(`   Messages: ${session.messageCount}`);
    
    // Extract knowledge
    const knowledge = await adapter.extractKnowledge(session);
    
    // Extract entities
    const entities = adapter.extractEntities(knowledge.text);
    console.log(`   Raw entities found: ${entities.length}`);
    
    if (entities.length === 0) continue;
    
    // Filter unique entities (by text)
    const uniqueEntities = [];
    const seen = new Set();
    for (const e of entities) {
      const key = `${e.type}:${e.text.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEntities.push(e);
      }
    }
    
    console.log(`   Unique entities: ${uniqueEntities.length}`);
    
    if (uniqueEntities.length === 0) continue;
    
    // Generate embeddings
    const texts = uniqueEntities.map(e => `${e.type}: ${e.text}. Context: ${e.context.substring(0, 200)}`);
    
    console.log(`   🧠 Generating embeddings...`);
    const embeddings = await getEmbeddingsBatch(texts, (done, total) => {
      process.stdout.write(`\r      Progress: ${done}/${total}`);
    });
    console.log();
    
    // Prepare points for Qdrant
    const points = uniqueEntities.map((e, i) => {
      if (!embeddings[i]) return null;
      
      return {
        id: nextId++,
        vector: embeddings[i],
        payload: {
          name: e.text,
          type: e.type,
          text: e.context,
          sessionId: session.id,
          source: 'auto-extraction',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      };
    }).filter(p => p !== null);
    
    // Store in Qdrant
    if (points.length > 0) {
      await storeInQdrant(points);
      console.log(`   ✅ Stored ${points.length} entities in Qdrant`);
      totalEntities += points.length;
    }
    
    // Store in Memgraph (Graph DB)
    console.log(`   🕸️  Storing in Memgraph...`);
    await storeInMemgraph(uniqueEntities, session.id);
    console.log(`   ✅ Stored in Memgraph`);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`\n✅ EXTRACTION COMPLETE`);
  console.log(`   Total entities stored: ${totalEntities}`);
  
  // Get final count
  try {
    const response = await axios.get(`${QDRANT_URL}/collections/${COLLECTION}`);
    console.log(`   Total vectors in Qdrant: ${response.data.result.points_count}`);
  } catch (e) {
    // Ignore
  }
  
  // Get Memgraph count
  try {
    const neo4j = require('neo4j-driver');
    const driver = neo4j.driver(`bolt://${MEMGRAPH_HOST}:7687`, neo4j.auth.basic('', ''));
    const session = driver.session();
    const result = await session.run('MATCH (n) RETURN count(n) as count');
    const count = result.records[0].get('count').toNumber();
    await session.close();
    await driver.close();
    console.log(`   Total entities in Memgraph: ${count}`);
  } catch (e) {
    console.log(`   Memgraph count: unavailable (${e.message})`);
  }
}

// Run
const { FrequencyTracker } = require('../src/frequency-tracker');

async function runWithFrequencyTracking() {
  // First run auto-extraction
  await extractAndStore();
  
  // Then run frequency tracker
  console.log('\n');
  const tracker = new FrequencyTracker();
  await tracker.processSessions(24);
}

runWithFrequencyTracking().catch(e => {
  console.error('\n❌ Error:', e.message);
  if (e.response) {
    console.error('Response:', e.response.data);
  }
  process.exit(1);
});