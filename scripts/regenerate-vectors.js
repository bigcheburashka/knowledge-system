#!/usr/bin/env node
// Regenerate all vectors with real embeddings

const { getEmbeddingsBatch } = require('../src/embedding-service');
const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';

// All entities from the graph
const entities = [
  { id: 1, text: "cashback-advisor-bot Telegram bot for cashback management using Node.js and Telegraf", type: "project", name: "cashback-advisor-bot" },
  { id: 2, text: "Node.js JavaScript runtime for server-side applications popular for microservices", type: "technology", name: "Node.js" },
  { id: 3, text: "Telegraf Telegram bot framework for Node.js with middleware support", type: "technology", name: "Telegraf" },
  { id: 4, text: "PostgreSQL relational database with JSON support and ACID compliance", type: "technology", name: "PostgreSQL" },
  { id: 5, text: "Docker containerization platform for deploying applications in isolated environments", type: "technology", name: "Docker" },
  { id: 6, text: "Redis in-memory data store used for caching and real-time applications", type: "technology", name: "Redis" },
  { id: 7, text: "Prisma ORM for Node.js with type-safe database access", type: "technology", name: "Prisma" },
  { id: 8, text: "React JavaScript library for building user interfaces", type: "technology", name: "React" },
  { id: 9, text: "TypeScript typed superset of JavaScript that compiles to plain JavaScript", type: "technology", name: "TypeScript" },
  { id: 10, text: "Express fast unopinionated web framework for Node.js", type: "technology", name: "Express" },
  { id: 11, text: "JWT JSON Web Tokens for secure authentication", type: "technology", name: "JWT" },
  { id: 12, text: "Docker Compose tool for defining and running multi-container Docker applications", type: "technology", name: "Docker Compose" },
  { id: 13, text: "Race condition protection using Set for duplicate prevention in Telegram bot handlers", type: "pattern", name: "Race Condition Protection" },
  { id: 14, text: "UI lifecycle management preventing early ctx.scene.leave before button clicks", type: "pattern", name: "UI Lifecycle Management" },
  { id: 15, text: "add_cashback infinite loop in Telegram bot critical bug now resolved", type: "problem", name: "add_cashback infinite loop" },
  { id: 16, text: "Mini App keyboard overlap on mobile medium severity issue resolved", type: "problem", name: "Mini App keyboard overlap" },
  { id: 17, text: "Post-save buttons not working high severity issue resolved", type: "problem", name: "Post-save buttons not working" },
  { id: 18, text: "Use Set for duplicate protection in handlers solution with 95 percent effectiveness", type: "solution", name: "Set duplicate protection" },
  { id: 19, text: "Fullscreen form instead of modal solution with 90 percent effectiveness", type: "solution", name: "Fullscreen form solution" },
  { id: 20, text: "Do not call ctx.scene.leave before buttons solution with 95 percent effectiveness", type: "solution", name: "No early scene leave" },
  { id: 21, text: "Artem Burla developer working on cashback-advisor-bot", type: "person", name: "Artem Burla" },
  { id: 22, text: "Configuration error in docker compose setup", type: "entity", name: "Configuration error" },
  { id: 23, text: "Port mapping fix for Docker containers", type: "entity", name: "Port mapping fix" },
  { id: 24, text: "Configuration update solution", type: "entity", name: "Configuration update" },
  { id: 25, text: "Node.js ecosystem of npm packages and frameworks", type: "entity", name: "Node.js ecosystem" },
  { id: 26, text: "Docker common issues and best practices", type: "entity", name: "Docker issues" },
  { id: 27, text: "Cross reference connect Technology Problem Solution", type: "entity", name: "Cross reference" },
  { id: 28, text: "Auto extraction from sessions timestamped entity", type: "autoextraction", name: "Auto Extraction" },
  { id: 29, text: "Expert Knowledge System autonomous implementation", type: "project", name: "Expert Knowledge System" }
];

async function clearCollection() {
  console.log('🧹 Clearing old vectors...');
  try {
    await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/delete`, {
      filter: {}
    });
    console.log('✅ Collection cleared');
  } catch (e) {
    console.log('ℹ️  Collection already empty or error:', e.message);
  }
}

async function uploadToQdrant(points) {
  console.log(`📤 Uploading ${points.length} vectors to Qdrant...`);
  
  // Upload in batches
  const batchSize = 10;
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    await axios.put(
      `${QDRANT_URL}/collections/${COLLECTION}/points`,
      { points: batch },
      { headers: { 'Content-Type': 'application/json' } }
    );
    console.log(`   Uploaded batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(points.length/batchSize)}`);
  }
  
  console.log('✅ Upload complete');
}

async function regenerate() {
  console.log('🔄 REGENERATING VECTORS WITH REAL EMBEDDINGS\n');
  console.log(`Entities to process: ${entities.length}`);
  
  // Clear old vectors
  await clearCollection();
  
  // Generate embeddings with progress
  const texts = entities.map(e => e.text);
  console.log('\n🧠 Generating embeddings (this may take a few minutes)...');
  
  const embeddings = await getEmbeddingsBatch(texts, (done, total) => {
    process.stdout.write(`\r   Progress: ${done}/${total} (${Math.round(done/total*100)}%)`);
  });
  
  console.log('\n');
  
  // Prepare points
  const points = entities.map((e, i) => ({
    id: e.id,
    vector: embeddings[i],
    payload: { 
      name: e.name,
      type: e.type, 
      text: e.text,
      source: 'regenerated',
      timestamp: new Date().toISOString()
    }
  })).filter(p => p.vector !== null);
  
  if (points.length === 0) {
    console.error('❌ No vectors generated successfully');
    process.exit(1);
  }
  
  // Upload
  await uploadToQdrant(points);
  
  // Verify
  const response = await axios.get(`${QDRANT_URL}/collections/${COLLECTION}`);
  console.log(`\n✅ Done! Collection now has ${response.data.result.points_count} real vectors`);
}

regenerate().catch(e => {
  console.error('\n❌ Error:', e.message);
  process.exit(1);
});