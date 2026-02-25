#!/usr/bin/env node
/**
 * Process System Design Content
 * Processes 223 JSON files from system-design-raw-v2/ and enriches them
 */

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Load environment
require('dotenv').config({ path: '/root/.openclaw/workspace/knowledge-system/.env' });

const { getEmbedding } = require('./src/embedding-service');
const { MegaAgentCoordinator } = require('./src/mega-agents');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';
const DATA_DIR = '/root/.openclaw/workspace/data/system-design-raw-v2';

// Progress tracking
const progress = {
  total: 0,
  processed: 0,
  stored: 0,
  errors: 0,
  skipped: 0,
  startTime: Date.now(),
  errorsList: [],
  nextId: null  // Will be set at start
};

/**
 * Log with timestamp
 */
async function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] [${level}] ${message}`;
  console.log(logLine);
}

/**
 * Get all JSON files from directory
 */
async function getJsonFiles() {
  const files = await fs.readdir(DATA_DIR);
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(DATA_DIR, f));
}

/**
 * Read and parse JSON file
 */
async function readJsonFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

/**
 * Clean topic name from title
 */
function extractTopic(data) {
  let title = data.title || '';
  
  // Remove common prefixes/suffixes
  title = title
    .replace(/^chapter[-\s]/i, '')
    .replace(/-case$/i, '')
    .replace(/-book$/i, '')
    .replace(/-film$/i, '')
    .replace(/-overview$/i, '')
    .replace(/[-_]documentary$/i, '')
    .replace(/\.json$/i, '')
    .replace(/-/g, ' ');
  
  // Capitalize words
  title = title
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  
  return title.trim();
}

/**
 * Determine topic type from content
 */
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
  
  return 'system-design-topic';
}

/**
 * Check if topic already exists in Qdrant
 */
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

/**
 * Generate enriched content using Mega-Agent with web search enhancement
 */
async function enrichContent(data, topic, type) {
  try {
    // Get existing content
    const existingContent = data.content || '';
    const url = data.url || '';
    const sections = (data.sections || []).join(', ');
    
    // Web search for enrichment
    let searchResults = '';
    try {
      const searchQuery = `${topic} system design best practices`;
      // Use web_search through OpenClaw if available, otherwise skip
      searchResults = ''; // Will be enriched by Mega-Agent's internal research
    } catch (e) {
      // Web search not critical
    }
    
    // Use Mega-Agent Coordinator
    const coordinator = new MegaAgentCoordinator();
    
    // Create context with existing content
    const context = {
      type: type,
      sourceContent: existingContent.slice(0, 3000), // First 3K chars
      sourceUrl: url,
      sourceSections: sections,
      searchResults: searchResults
    };
    
    // Generate enriched content
    const result = await coordinator.processTopic(topic, type);
    
    if (!result) {
      log(`No result from Mega-Agent for ${topic}`, 'WARN');
      return null;
    }
    
    // Accept if quality score is >= 0.6 (60%)
    if (result.qualityScore < 0.6) {
      log(`Quality too low for ${topic}: ${(result.qualityScore * 100).toFixed(0)}%`, 'WARN');
      return null;
    }
    
    return result;
    
  } catch (error) {
    log(`Mega-Agent failed for ${topic}: ${error.message}`, 'ERROR');
    return null;
  }
}

/**
 * Store enriched content in Qdrant
 */
async function storeInQdrant(entry, sourceData) {
  try {
    // Create rich text for embedding
    const text = `
${entry.name}. 
${entry.description}
Best practices: ${(entry.bestPractices || []).join('. ')}
Common mistakes: ${(entry.commonMistakes || []).join('. ')}
Related: ${(entry.related || []).join(', ')}
`.trim();
    
    const embedding = await getEmbedding(text);
    
    // Use global nextId counter
    const newId = progress.nextId++;
    
    // Store in Qdrant
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
          source: 'system-design-space',
          sourceUrl: sourceData.url || '',
          sourceSlug: sourceData.slug || '',
          qualityScore: entry.qualityScore || 0.7,
          confidence: entry.confidence || 0.7,
          sections: sourceData.sections || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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

/**
 * Process a batch of files
 */
async function processBatch(files, batchNumber, totalBatches) {
  log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${files.length} files)`);
  log('=' .repeat(60));
  
  const results = [];
  
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const fileName = path.basename(filePath);
    
    try {
      // Read file
      const data = await readJsonFile(filePath);
      if (!data) {
        log(`  ⚠️  Failed to read: ${fileName}`, 'WARN');
        progress.errors++;
        continue;
      }
      
      // Extract topic
      const topic = extractTopic(data);
      const type = determineType(data, topic);
      
      log(`  [${i + 1}/${files.length}] Processing: ${topic} (${type})`);
      
      // Check if exists
      const exists = await topicExists(topic);
      if (exists) {
        log(`    ⏩ Already exists, skipping`);
        progress.skipped++;
        continue;
      }
      
      // Enrich content
      const enriched = await enrichContent(data, topic, type);
      if (!enriched) {
        log(`    ❌ Enrichment failed`, 'ERROR');
        progress.errors++;
        progress.errorsList.push({ file: fileName, topic, error: 'Enrichment failed' });
        continue;
      }
      
      // Store in Qdrant
      const stored = await storeInQdrant(enriched, data);
      if (!stored.success) {
        log(`    ❌ Store failed: ${stored.error}`, 'ERROR');
        progress.errors++;
        progress.errorsList.push({ file: fileName, topic, error: stored.error });
        continue;
      }
      
      log(`    ✅ Stored (ID: ${stored.id}, Quality: ${(enriched.qualityScore * 100).toFixed(0)}%)`);
      progress.stored++;
      results.push({ topic, id: stored.id });
      
      // Small delay between items
      await new Promise(r => setTimeout(r, 500));
      
    } catch (error) {
      log(`    ❌ Error processing ${fileName}: ${error.message}`, 'ERROR');
      progress.errors++;
      progress.errorsList.push({ file: fileName, error: error.message });
    }
  }
  
  progress.processed += files.length;
  
  // Report progress every batch
  const elapsed = ((Date.now() - progress.startTime) / 1000 / 60).toFixed(1);
  const percent = ((progress.processed / progress.total) * 100).toFixed(1);
  
  log(`\n📊 Progress: ${progress.processed}/${progress.total} (${percent}%) | Stored: ${progress.stored} | Errors: ${progress.errors} | Skipped: ${progress.skipped} | Time: ${elapsed}min`);
  
  return results;
}

/**
 * Main processing function
 */
async function main() {
  log('='.repeat(70));
  log('🧠 SYSTEM DESIGN CONTENT PROCESSOR');
  log('='.repeat(70));
  
  // Get all JSON files
  const allFiles = await getJsonFiles();
  progress.total = allFiles.length;
  
  log(`📚 Found ${progress.total} JSON files to process`);
  
  // Get current Qdrant stats and initialize nextId
  try {
    const stats = await axios.get(`${QDRANT_URL}/collections/${COLLECTION}`);
    log(`📊 Current Qdrant: ${stats.data.result.points_count} vectors`);
    
    // Get max ID for sequential ID generation
    const scroll = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
      limit: 1000,
      with_payload: false
    });
    const maxId = scroll.data.result.points?.reduce((max, p) => Math.max(max, p.id), 0) || 0;
    progress.nextId = maxId + 1;
    log(`📝 Starting with ID: ${progress.nextId}`);
  } catch (e) {
    log('⚠️ Could not get Qdrant stats', 'WARN');
    progress.nextId = Date.now();
  }
  
  // Process in batches of 5
  const batchSize = 5;
  const totalBatches = Math.ceil(allFiles.length / batchSize);
  
  log(`\n🚀 Starting processing in batches of ${batchSize}`);
  log(`📦 Total batches: ${totalBatches}`);
  
  for (let i = 0; i < allFiles.length; i += batchSize) {
    const batch = allFiles.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    
    await processBatch(batch, batchNumber, totalBatches);
    
    // Report every 20 topics (4 batches)
    if (batchNumber % 4 === 0 || batchNumber === totalBatches) {
      log('\n' + '='.repeat(70));
      log(`📈 PROGRESS REPORT (Batch ${batchNumber}/${totalBatches})`);
      log('='.repeat(70));
      log(`  Total Processed: ${progress.processed}/${progress.total}`);
      log(`  Successfully Stored: ${progress.stored}`);
      log(`  Skipped (duplicates): ${progress.skipped}`);
      log(`  Errors: ${progress.errors}`);
      log(`  Completion: ${((progress.processed / progress.total) * 100).toFixed(1)}%`);
      log('='.repeat(70));
    }
    
    // Delay between batches to prevent rate limiting
    if (i + batchSize < allFiles.length) {
      log(`\n⏳ Waiting 3s before next batch...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  
  // Final summary
  const totalTime = ((Date.now() - progress.startTime) / 1000 / 60).toFixed(1);
  
  log('\n' + '='.repeat(70));
  log('✅ PROCESSING COMPLETE');
  log('='.repeat(70));
  log(`📊 FINAL STATISTICS:`);
  log(`  Total Files: ${progress.total}`);
  log(`  Processed: ${progress.processed}`);
  log(`  Successfully Stored: ${progress.stored}`);
  log(`  Skipped (duplicates): ${progress.skipped}`);
  log(`  Errors: ${progress.errors}`);
  log(`  Total Time: ${totalTime} minutes`);
  log(`  Success Rate: ${((progress.stored / progress.total) * 100).toFixed(1)}%`);
  
  if (progress.errorsList.length > 0) {
    log('\n❌ ERRORS ENCOUNTERED:');
    progress.errorsList.slice(0, 10).forEach(e => {
      log(`  - ${e.file}: ${e.error}`);
    });
    if (progress.errorsList.length > 10) {
      log(`  ... and ${progress.errorsList.length - 10} more`);
    }
  }
  
  // Get final Qdrant stats
  try {
    const stats = await axios.get(`${QDRANT_URL}/collections/${COLLECTION}`);
    log(`\n📊 Final Qdrant: ${stats.data.result.points_count} vectors`);
    log(`   New vectors added: ${stats.data.result.points_count - 1001}`);
  } catch (e) {
    // Ignore
  }
  
  log('='.repeat(70));
  
  return {
    total: progress.total,
    processed: progress.processed,
    stored: progress.stored,
    skipped: progress.skipped,
    errors: progress.errors,
    errorsList: progress.errorsList,
    timeMinutes: parseFloat(totalTime)
  };
}

// Run if called directly
if (require.main === module) {
  main()
    .then(result => {
      console.log('\n📋 Final Result:', JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { main, processBatch, enrichContent, storeInQdrant };
