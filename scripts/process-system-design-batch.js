#!/usr/bin/env node
/**
 * System Design Content Processor
 * Process JSON files from system-design-raw-v2 in batches of 5
 */

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Configuration
const DATA_DIR = '/root/.openclaw/workspace/data/system-design-raw-v2';
const KNOWLEDGE_DIR = '/root/.openclaw/workspace/knowledge-system';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';

// Stats
const stats = {
  totalFiles: 0,
  processed: 0,
  stored: 0,
  errors: 0,
  skipped: 0,
  startTime: Date.now()
};

// Load custom topics manager
async function loadCustomTopicsManager() {
  try {
    const TopicsManager = require(path.join(KNOWLEDGE_DIR, 'custom-topics.js'));
    return new TopicsManager();
  } catch (e) {
    console.log(`⚠️ Custom topics manager not available: ${e.message}`);
    return null;
  }
}

// Load embedding service
async function getEmbedding(text) {
  try {
    const { getEmbedding } = require(path.join(KNOWLEDGE_DIR, 'src/embedding-service.js'));
    return await getEmbedding(text);
  } catch (e) {
    console.log(`⚠️ Embedding service error: ${e.message}`);
    throw e;
  }
}

// Check if topic exists in Qdrant
async function topicExists(topicName) {
  try {
    const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
      filter: { must: [{ key: 'name', match: { value: topicName } }] },
      limit: 1
    });
    return response.data.result.points?.length > 0;
  } catch (e) {
    return false;
  }
}

// Extract topic name from file data
function extractTopicName(fileData, filename) {
  // Use title if available
  if (fileData.title && fileData.title.trim()) {
    // Clean up common prefixes
    return fileData.title
      .replace(/^(Chapter|Case Study|Case):?\s*/i, '')
      .replace(/^The\s+/i, '')
      .trim();
  }
  
  // Fallback to filename
  return filename
    .replace(/^chapter-/, '')
    .replace(/\.json$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

// Determine topic type from content
function determineTopicType(fileData, topicName, filename) {
  const content = (fileData.content || '').toLowerCase();
  const title = (fileData.title || '').toLowerCase();
  const combined = `${title} ${content}`;
  const filenameLower = (filename || '').toLowerCase();
  
  // Check for patterns
  if (combined.includes('case study') || (combined.includes('system design') && topicName.toLowerCase().includes('case'))) {
    return 'case_study';
  }
  if (combined.includes('book') || filenameLower.includes('-book')) {
    return 'book';
  }
  if (combined.includes('film') || combined.includes('documentary') || filenameLower.includes('-film')) {
    return 'documentary';
  }
  if (combined.includes('pattern') || combined.includes('architecture')) {
    return 'pattern';
  }
  if (combined.includes('protocol') || combined.includes('http') || combined.includes('tcp')) {
    return 'protocol';
  }
  if (combined.includes('database') || combined.includes('storage') || combined.includes('cache')) {
    return 'technology';
  }
  
  return 'concept';
}

// Generate comprehensive knowledge using Mega-Agent
async function generateKnowledge(topic, fileData, type) {
  try {
    const { MegaAgentCoordinator } = require(path.join(KNOWLEDGE_DIR, 'src/mega-agents.js'));
    const coordinator = new MegaAgentCoordinator();
    
    // Create context from file content
    const context = {
      type: type,
      source: 'system-design-space',
      content: fileData.content?.substring(0, 8000) || '',
      url: fileData.url,
      sections: fileData.sections || []
    };
    
    const result = await coordinator.processTopic(topic, type, context);
    return result;
  } catch (e) {
    console.log(`⚠️ Mega-Agent failed for ${topic}: ${e.message}`);
    // Return basic entry
    return createBasicEntry(topic, fileData, type);
  }
}

// Create basic entry as fallback
function createBasicEntry(topic, fileData, type) {
  const content = fileData.content || '';
  
  // Extract description from content
  const description = content.substring(0, 500).replace(/\s+/g, ' ').trim();
  
  return {
    name: topic,
    type: type,
    description: description || `${topic} - System Design topic from system-design.space`,
    related: fileData.sections?.slice(0, 10) || [],
    bestPractices: [],
    commonMistakes: [],
    tools: [],
    source: 'system-design-space',
    url: fileData.url,
    qualityScore: 0.5
  };
}

// Store knowledge in Qdrant
async function storeInQdrant(entry) {
  try {
    const text = `${entry.name}. ${entry.description}. ${entry.bestPractices?.join('. ') || ''}`;
    const embedding = await getEmbedding(text);
    
    // Get current max ID
    let maxId = 0;
    try {
      const scroll = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
        limit: 1000, with_payload: false
      });
      maxId = scroll.data.result.points?.reduce((max, p) => Math.max(max, p.id), 0) || 0;
    } catch (e) {
      maxId = Date.now();
    }
    
    const newId = maxId + 1;
    
    // Store in Qdrant
    await axios.put(`${QDRANT_URL}/collections/${COLLECTION}/points`, {
      points: [{
        id: newId,
        vector: embedding,
        payload: {
          name: entry.name,
          type: entry.type,
          text: entry.description,
          related: entry.related || [],
          bestPractices: entry.bestPractices || [],
          commonMistakes: entry.commonMistakes || [],
          tools: entry.tools || [],
          source: 'system-design-space',
          url: entry.url,
          qualityScore: entry.qualityScore || 0.7,
          createdAt: new Date().toISOString()
        }
      }]
    });
    
    return { success: true, id: newId };
  } catch (e) {
    console.log(`❌ Qdrant store error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// Save to Memgraph
async function saveToMemgraph(entry) {
  try {
    const neo4j = require('neo4j-driver');
    const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('', ''));
    const session = driver.session();
    
    try {
      // Create main entity
      await session.run(`
        MERGE (e:Entity {name: $name})
        SET e.type = $type,
            e.description = $description,
            e.source = 'system-design-space',
            e.updatedAt = datetime()
      `, {
        name: entry.name,
        type: entry.type,
        description: entry.description?.substring(0, 500) || ''
      });
      
      // Create relationships
      for (const related of (entry.related || []).slice(0, 10)) {
        if (related && related !== entry.name) {
          await session.run(`
            MERGE (r:Entity {name: $relatedName})
            MERGE (e:Entity {name: $name})
            MERGE (e)-[:RELATED_TO {source: 'system-design'}]->(r)
          `, { name: entry.name, relatedName: related });
        }
      }
      
      console.log(`🕸️  Memgraph: ${entry.name}`);
    } finally {
      await session.close();
      await driver.close();
    }
    
    return true;
  } catch (e) {
    console.log(`⚠️ Memgraph error: ${e.message}`);
    return false;
  }
}

// Mark topic as learned
async function markAsLearned(topicsManager, topicName) {
  if (!topicsManager) return false;
  
  try {
    await topicsManager.markLearned(topicName, {
      learnedAt: new Date().toISOString(),
      source: 'system-design-deep-learning'
    });
    return true;
  } catch (e) {
    console.log(`⚠️ Failed to mark ${topicName} as learned: ${e.message}`);
    return false;
  }
}

// Process a single file
async function processFile(filepath, topicsManager) {
  const filename = path.basename(filepath);
  
  try {
    // Read and parse file
    const content = await fs.readFile(filepath, 'utf8');
    const data = JSON.parse(content);
    
    // Extract topic name
    const topicName = extractTopicName(data, filename);
    
    // Check if already exists
    const exists = await topicExists(topicName);
    if (exists) {
      console.log(`⏩ ${topicName} - already exists`);
      stats.skipped++;
      return { success: false, reason: 'exists', topic: topicName };
    }
    
    // Determine type
    const type = determineTopicType(data, topicName, filename);
    
    // Generate knowledge
    console.log(`🧠 Processing: ${topicName}`);
    const entry = await generateKnowledge(topicName, data, type);
    
    // Store in Qdrant
    const qdrantResult = await storeInQdrant(entry);
    if (!qdrantResult.success) {
      throw new Error(`Qdrant store failed: ${qdrantResult.error}`);
    }
    
    // Save to Memgraph
    await saveToMemgraph(entry);
    
    // Mark as learned
    await markAsLearned(topicsManager, topicName);
    
    stats.stored++;
    console.log(`✅ Stored: ${topicName} (ID: ${qdrantResult.id})`);
    
    return { success: true, topic: topicName, id: qdrantResult.id };
    
  } catch (e) {
    stats.errors++;
    console.log(`❌ Error processing ${filename}: ${e.message}`);
    return { success: false, reason: 'error', error: e.message, filename };
  }
}

// Process batch of files
async function processBatch(files, batchNum, totalBatches, topicsManager) {
  console.log(`\n📦 BATCH ${batchNum}/${totalBatches} (${files.length} files)`);
  console.log('=' .repeat(50));
  
  const results = [];
  for (const filepath of files) {
    stats.processed++;
    const result = await processFile(filepath, topicsManager);
    results.push(result);
    
    // Small delay between files
    await new Promise(r => setTimeout(r, 500));
  }
  
  // Report batch results
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success && r.reason === 'error').length;
  const skipped = results.filter(r => !r.success && r.reason === 'exists').length;
  
  console.log(`\n📊 BATCH ${batchNum} COMPLETE:`);
  console.log(`   ✅ Stored: ${successful}`);
  console.log(`   ⏩ Skipped (exists): ${skipped}`);
  console.log(`   ❌ Errors: ${failed}`);
  
  return results;
}

// Main processing function
async function processAllFiles(batchSize = 5, startBatch = 1) {
  console.log('🚀 SYSTEM DESIGN CONTENT PROCESSOR');
  console.log('=' .repeat(60));
  
  // Load topics manager
  const topicsManager = await loadCustomTopicsManager();
  
  // Get all files
  const allFiles = await fs.readdir(DATA_DIR);
  const jsonFiles = allFiles
    .filter(f => f.endsWith('.json') && f !== '.json')
    .map(f => path.join(DATA_DIR, f))
    .sort();
  
  stats.totalFiles = jsonFiles.length;
  console.log(`📁 Total files to process: ${jsonFiles.length}`);
  console.log(`📦 Batch size: ${batchSize}`);
  console.log(`🚀 Starting from batch: ${startBatch}`);
  console.log('');
  
  // Calculate batches
  const totalBatches = Math.ceil(jsonFiles.length / batchSize);
  const startIndex = (startBatch - 1) * batchSize;
  const filesToProcess = jsonFiles.slice(startIndex);
  
  // Process in batches
  const allResults = [];
  let currentBatch = startBatch;
  
  for (let i = 0; i < filesToProcess.length; i += batchSize) {
    const batchFiles = filesToProcess.slice(i, i + batchSize);
    const results = await processBatch(batchFiles, currentBatch, totalBatches, topicsManager);
    allResults.push(...results);
    
    // Progress report
    const elapsed = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
    const percent = ((stats.processed / stats.totalFiles) * 100).toFixed(1);
    console.log(`\n📈 OVERALL PROGRESS: ${stats.processed}/${stats.totalFiles} (${percent}%) | Time: ${elapsed}min`);
    console.log(`   Stored: ${stats.stored} | Skipped: ${stats.skipped} | Errors: ${stats.errors}`);
    
    currentBatch++;
    
    // Delay between batches
    if (i + batchSize < filesToProcess.length) {
      console.log('\n⏳ Pausing 2 seconds before next batch...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // Final report
  const totalTime = ((Date.now() - stats.startTime) / 1000 / 60).toFixed(1);
  console.log('\n' + '='.repeat(60));
  console.log('🏁 FINAL REPORT');
  console.log('='.repeat(60));
  console.log(`📁 Total files: ${stats.totalFiles}`);
  console.log(`✅ Successfully stored: ${stats.stored}`);
  console.log(`⏩ Skipped (already exist): ${stats.skipped}`);
  console.log(`❌ Errors: ${stats.errors}`);
  console.log(`⏱️  Total time: ${totalTime} minutes`);
  console.log('='.repeat(60));
  
  return {
    stats,
    results: allResults
  };
}

// Run if called directly
if (require.main === module) {
  const batchSize = parseInt(process.argv[2]) || 5;
  const startBatch = parseInt(process.argv[3]) || 1;
  
  processAllFiles(batchSize, startBatch).catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}

module.exports = { processAllFiles, processFile };
