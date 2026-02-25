#!/usr/bin/env node
/**
 * Find and process missing system design topics
 * Identifies JSON files not yet in Qdrant and processes them
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';
const DATA_DIR = '/root/.openclaw/workspace/data/system-design-raw-v2';

// Load environment
require('dotenv').config({ path: '/root/.openclaw/workspace/knowledge-system/.env' });

const { getEmbedding } = require('./src/embedding-service');

function extractTopic(data) {
  let title = data.title || '';
  title = title
    .replace(/^chapter[-\s]/i, '')
    .replace(/-case$/i, '')
    .replace(/-book$/i, '')
    .replace(/-film$/i, '')
    .replace(/-overview$/i, '')
    .replace(/[-_]documentary$/i, '')
    .replace(/\.json$/i, '')
    .replace(/-/g, ' ');
  
  title = title
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  
  return title.trim();
}

function determineType(data, topic) {
  const title = (data.title || '').toLowerCase();
  const content = (data.content || '').toLowerCase();
  const sections = (data.sections || []).join(' ').toLowerCase();
  
  if (title.includes('case') || sections.includes('case study')) return 'case-study';
  if (title.includes('book')) return 'book';
  if (title.includes('film') || title.includes('documentary')) return 'film';
  if (content.includes('architecture') || content.includes('design')) return 'architecture-pattern';
  if (content.includes('kubernetes') || content.includes('docker')) return 'technology';
  if (content.includes('algorithm') || content.includes('data structure')) return 'algorithm';
  if (content.includes('interview') || content.includes('system design interview')) return 'interview';
  if (content.includes('pattern') || title.includes('pattern')) return 'pattern';
  if (content.includes('overview') || title.includes('overview')) return 'overview';
  if (title.includes('security') || content.includes('security')) return 'security';
  if (title.includes('database') || content.includes('database')) return 'database';
  if (title.includes('cache') || content.includes('cache')) return 'caching';
  if (title.includes('microservice') || content.includes('microservice')) return 'microservices';
  if (title.includes('api') || content.includes('api')) return 'api';
  if (title.includes('ml') || title.includes('ai') || content.includes('machine learning')) return 'ai-ml';
  if (title.includes('frontend') || title.includes('react') || title.includes('angular')) return 'frontend';
  if (title.includes('distributed') || content.includes('distributed')) return 'distributed-systems';
  if (title.includes('network') || content.includes('network')) return 'networking';
  
  return 'system-design-topic';
}

function determineCategory(data, topic, type) {
  const title = (data.title || '').toLowerCase();
  const content = (data.content || '').toLowerCase();
  const sections = (data.sections || []).join(' ').toLowerCase();
  
  const categories = [];
  
  // Databases
  if (title.includes('sql') || title.includes('database') || title.includes('postgres') || 
      title.includes('mysql') || title.includes('redis') || title.includes('mongodb') ||
      title.includes('cassandra') || title.includes('elasticsearch') || content.includes('database')) {
    categories.push('Databases');
  }
  
  // Distributed Systems
  if (title.includes('distributed') || title.includes('consensus') || title.includes('raft') ||
      title.includes('paxos') || title.includes('kafka') || title.includes('zookeeper') ||
      content.includes('distributed system') || content.includes('distributed computing')) {
    categories.push('Distributed Systems');
  }
  
  // Microservices
  if (title.includes('microservice') || title.includes('service mesh') || title.includes('istio') ||
      title.includes('consul') || content.includes('microservices')) {
    categories.push('Microservices');
  }
  
  // Security
  if (title.includes('security') || title.includes('auth') || title.includes('oauth') ||
      title.includes('jwt') || title.includes('acl') || title.includes('rbac') ||
      title.includes('encryption') || title.includes('tls') || title.includes('ssl') ||
      content.includes('security') || content.includes('authentication')) {
    categories.push('Security');
  }
  
  // AI/ML
  if (title.includes('ai') || title.includes('ml') || title.includes('machine learning') ||
      title.includes('neural') || title.includes('tensorflow') || title.includes('pytorch') ||
      title.includes('llm') || title.includes('embedding') || title.includes('vector') ||
      content.includes('machine learning') || content.includes('deep learning')) {
    categories.push('AI/ML');
  }
  
  // Frontend
  if (title.includes('react') || title.includes('angular') || title.includes('vue') ||
      title.includes('frontend') || title.includes('webpack') || title.includes('babel') ||
      content.includes('frontend') || content.includes('client-side')) {
    categories.push('Frontend');
  }
  
  // DevOps/Infrastructure
  if (title.includes('docker') || title.includes('kubernetes') || title.includes('k8s') ||
      title.includes('cicd') || title.includes('jenkins') || title.includes('terraform') ||
      title.includes('ansible') || title.includes('devops') || content.includes('deployment')) {
    categories.push('DevOps');
  }
  
  // Networking
  if (title.includes('network') || title.includes('tcp') || title.includes('http') ||
      title.includes('grpc') || title.includes('websocket') || title.includes('load balancer') ||
      title.includes('nginx') || title.includes('cdn') || content.includes('networking')) {
    categories.push('Networking');
  }
  
  // Caching
  if (title.includes('cache') || title.includes('redis') || title.includes('memcached') ||
      title.includes('cdn') || content.includes('caching')) {
    categories.push('Caching');
  }
  
  // Storage
  if (title.includes('s3') || title.includes('storage') || title.includes('blob') ||
      title.includes('file system') || title.includes('hdfs') || content.includes('storage')) {
    categories.push('Storage');
  }
  
  // System Design Interviews
  if (title.includes('interview') || title.includes('sdi') || 
      content.includes('system design interview')) {
    categories.push('Interview Prep');
  }
  
  // Case Studies
  if (type === 'case-study' || title.includes('case study') || title.includes('whatsapp') ||
      title.includes('twitter') || title.includes('netflix') || title.includes('uber') ||
      title.includes('airbnb') || title.includes('url shortener')) {
    categories.push('Case Studies');
  }
  
  // Books/Films
  if (type === 'book' || type === 'film') {
    categories.push('Learning Resources');
  }
  
  // Default
  if (categories.length === 0) {
    categories.push('System Design');
  }
  
  return categories;
}

async function getAllQdrantTopics() {
  const topics = new Set();
  let offset = 0;
  const limit = 100;
  
  while (true) {
    try {
      const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
        limit: limit,
        offset: offset,
        with_payload: true
      });
      
      const points = response.data.result.points || [];
      if (points.length === 0) break;
      
      points.forEach(p => {
        if (p.payload?.name) {
          topics.add(p.payload.name.toLowerCase().trim());
        }
      });
      
      offset += limit;
      if (offset > 5000) break;
    } catch (e) {
      console.error('Error scrolling Qdrant:', e.message);
      break;
    }
  }
  
  return topics;
}

async function findMissingTopics() {
  console.log('🔍 Finding missing topics...\n');
  
  // Get all Qdrant topics
  console.log('  Fetching topics from Qdrant...');
  const qdrantTopics = await getAllQdrantTopics();
  console.log(`  Found ${qdrantTopics.size} topics in Qdrant\n`);
  
  // Get all JSON files
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  console.log(`  Found ${files.length} JSON files\n`);
  
  const missing = [];
  const existing = [];
  
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
      const data = JSON.parse(content);
      const topic = extractTopic(data);
      const normalizedTopic = topic.toLowerCase().trim();
      
      if (!qdrantTopics.has(normalizedTopic)) {
        missing.push({
          file: file,
          topic: topic,
          type: determineType(data, topic),
          categories: determineCategory(data, topic, determineType(data, topic)),
          data: data
        });
      } else {
        existing.push({
          file: file,
          topic: topic
        });
      }
    } catch (e) {
      console.error(`  Error reading ${file}:`, e.message);
    }
  }
  
  return { missing, existing };
}

async function storeInQdrant(entry, sourceData) {
  try {
    const text = `${entry.name}. ${entry.description}
Best practices: ${(entry.bestPractices || []).join('. ')}
Common mistakes: ${(entry.commonMistakes || []).join('. ')}
Related: ${(entry.related || []).join(', ')}
Categories: ${(entry.categories || []).join(', ')}`.trim();
    
    const embedding = await getEmbedding(text);
    
    // Generate unique ID
    const newId = Date.now() + Math.floor(Math.random() * 1000000);
    
    await axios.put(`${QDRANT_URL}/collections/${COLLECTION}/points`, {
      points: [{
        id: newId,
        vector: embedding,
        payload: {
          name: entry.name,
          type: entry.type || 'system-design-topic',
          text: entry.description,
          related: entry.related || [],
          bestPractices: entry.bestPractices || [],
          commonMistakes: entry.commonMistakes || [],
          categories: entry.categories || ['System Design'],
          source: 'system-design-space',
          sourceUrl: sourceData.url || '',
          sourceSlug: sourceData.slug || '',
          sections: sourceData.sections || [],
          enriched: true,
          enrichedAt: new Date().toISOString()
        }
      }]
    });
    
    return { success: true, id: newId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function generateEnrichedContent(topic, type, data, categories) {
  const content = data.content || '';
  const sections = data.sections || [];
  
  // Extract key concepts from sections
  const keyConcepts = sections.slice(0, 5).join(', ');
  
  // Generate description based on type and content
  let description = content.slice(0, 500);
  if (description.length < 100) {
    description = `${topic} is a ${type} concept in system design. It covers key principles and best practices for building scalable and reliable systems.`;
  }
  
  // Generate related topics based on categories
  const relatedMap = {
    'Databases': ['Database Sharding', 'Replication', 'Indexing', 'ACID', 'CAP Theorem'],
    'Distributed Systems': ['Consensus', 'CAP Theorem', 'Eventual Consistency', 'Distributed Transactions'],
    'Microservices': ['API Gateway', 'Service Discovery', 'Circuit Breaker', 'Load Balancing'],
    'Security': ['Authentication', 'Authorization', 'OAuth 2.0', 'JWT', 'TLS'],
    'AI/ML': ['Machine Learning', 'Neural Networks', 'Vector Embeddings', 'LLM'],
    'Frontend': ['React', 'Angular', 'State Management', 'Performance Optimization'],
    'DevOps': ['Docker', 'Kubernetes', 'CI/CD', 'Infrastructure as Code'],
    'Networking': ['Load Balancing', 'CDN', 'HTTP/2', 'gRPC', 'WebSocket'],
    'Caching': ['Redis', 'Memcached', 'CDN', 'Cache Invalidation'],
    'Storage': ['Object Storage', 'Block Storage', 'File Systems', 'Data Lake']
  };
  
  const related = new Set();
  categories.forEach(cat => {
    if (relatedMap[cat]) {
      relatedMap[cat].forEach(r => related.add(r));
    }
  });
  
  // Generate best practices
  const bestPractices = [
    `Understand ${topic} fundamentals before implementation`,
    'Consider trade-offs based on system requirements',
    'Monitor and measure performance metrics',
    'Document architectural decisions'
  ];
  
  // Generate common mistakes
  const commonMistakes = [
    'Over-engineering solutions for simple use cases',
    'Ignoring monitoring and observability',
    'Not considering failure scenarios',
    'Lack of proper documentation'
  ];
  
  return {
    name: topic,
    type: type,
    description: description,
    related: Array.from(related).slice(0, 6),
    bestPractices: bestPractices,
    commonMistakes: commonMistakes,
    categories: categories,
    qualityScore: 0.75,
    confidence: 0.8
  };
}

async function processMissingTopics(missingTopics, limit = 25) {
  console.log(`\n🚀 Processing up to ${limit} missing topics...\n`);
  
  const results = {
    processed: 0,
    stored: 0,
    errors: []
  };
  
  const toProcess = missingTopics.slice(0, limit);
  
  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    console.log(`  [${i + 1}/${toProcess.length}] ${item.topic} (${item.type})`);
    console.log(`      Categories: ${item.categories.join(', ')}`);
    
    try {
      const enriched = generateEnrichedContent(
        item.topic,
        item.type,
        item.data,
        item.categories
      );
      
      const stored = await storeInQdrant(enriched, item.data);
      
      if (stored.success) {
        console.log(`      ✅ Stored (ID: ${stored.id})`);
        results.stored++;
      } else {
        console.log(`      ❌ Store failed: ${stored.error}`);
        results.errors.push({ topic: item.topic, error: stored.error });
      }
      
      results.processed++;
      
      // Delay between items
      await new Promise(r => setTimeout(r, 200));
      
    } catch (error) {
      console.log(`      ❌ Error: ${error.message}`);
      results.errors.push({ topic: item.topic, error: error.message });
    }
  }
  
  return results;
}

async function main() {
  console.log('='.repeat(70));
  console.log('🧠 SYSTEM DESIGN TOPICS - FIND & PROCESS MISSING');
  console.log('='.repeat(70));
  
  const { missing, existing } = await findMissingTopics();
  
  console.log(`\n📊 ANALYSIS RESULTS:`);
  console.log(`  Existing in Qdrant: ${existing.length}`);
  console.log(`  Missing from Qdrant: ${missing.length}`);
  
  if (missing.length > 0) {
    console.log(`\n📋 Missing topics (showing first 20):`);
    missing.slice(0, 20).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.topic} [${m.categories.join(', ')}]`);
    });
    
    // Process missing topics
    const results = await processMissingTopics(missing, 25);
    
    console.log(`\n📊 PROCESSING RESULTS:`);
    console.log(`  Processed: ${results.processed}`);
    console.log(`  Stored: ${results.stored}`);
    console.log(`  Errors: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      console.log(`\n❌ Errors:`);
      results.errors.slice(0, 5).forEach(e => {
        console.log(`  - ${e.topic}: ${e.error}`);
      });
    }
  }
  
  console.log('\n' + '='.repeat(70));
  console.log('✅ COMPLETE');
  console.log('='.repeat(70));
  
  return { missing: missing.length, existing: existing.length };
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { findMissingTopics, processMissingTopics, determineCategory };
