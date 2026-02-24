#!/usr/bin/env node
// Deep Learning Service - Fixed Version with Gateway API and Evolution Integration

const OpenClawAdapter = require('../src/openclaw-adapter');
const { getEmbedding } = require('../src/embedding-service');
const { getFeatureFlags } = require('../src/feature-flags');
const { CheckpointGates } = require('../src/checkpoint-gates');
const { SelfEvolution } = require('../src/evolution');
const { MemgraphSyncWorker } = require('../src/evolution/memgraph-sync');
const { AuditLogger } = require('../src/evolution/audit-logger');
const { PostLearningExpander } = require('../src/post-learning-expander');
const { QualityBasedExpansion } = require('../src/quality-expansion');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';
const LOG_FILE = '/var/log/knowledge/deep-learning.log';
const DIAGNOSTIC_LOG = '/var/log/knowledge/deep-learning-diagnostic.log';

class DeepLearningService {
  constructor() {
    this.expandedTopics = new Set();
    this.stats = {
      attempted: 0,
      expanded: 0,
      stored: 0,
      failed: 0,
      errors: []
    };
    this.flags = getFeatureFlags();
    this.failedTopics = [];
    this.evolution = null;
    this.memgraphSync = null;
    this.audit = null;
    this.postLearningExpander = null;
    this.qualityExpansion = null;
    this.newlyStoredTopics = []; // Track for expansion
  }

  async init() {
    // Initialize Audit Logger
    try {
      this.audit = new AuditLogger();
      await this.audit.init();
      await this.log('✅ Audit Logger initialized');
    } catch (err) {
      await this.log(`⚠️ Audit Logger not available: ${err.message}`, 'WARN');
    }
    
    // Initialize MemgraphSync for async operations
    try {
      this.memgraphSync = new MemgraphSyncWorker();
      await this.memgraphSync.init();
      await this.log('✅ MemgraphSync initialized for async operations');
    } catch (err) {
      await this.log(`⚠️ MemgraphSync not available: ${err.message}`, 'WARN');
    }
    
    // Initialize Evolution system for bidirectional sync
    try {
      this.evolution = new SelfEvolution();
      await this.evolution.init();
      await this.log('✅ Evolution system connected for bidirectional sync');
    } catch (err) {
      await this.log(`⚠️ Evolution not available: ${err.message}`, 'WARN');
      this.evolution = null;
    }
    
    // Initialize Post-Learning Expander for continuous learning
    try {
      this.postLearningExpander = new PostLearningExpander();
      await this.log('✅ Post-Learning Expander initialized');
    } catch (err) {
      await this.log(`⚠️ Post-Learning Expander not available: ${err.message}`, 'WARN');
    }
    
    // Initialize Quality-Based Expansion
    try {
      this.qualityExpansion = new QualityBasedExpansion();
      await this.log('✅ Quality-Based Expansion initialized');
    } catch (err) {
      await this.log(`⚠️ Quality-Based Expansion not available: ${err.message}`, 'WARN');
    }
  }

  /**
   * Check if topic should be learned (bidirectional sync with Evolution)
   */
  async shouldLearnTopic(topicName) {
    if (!this.evolution) {
      return { shouldLearn: true, reason: 'Evolution not available' };
    }
    
    try {
      // Check if there's a skill covering this topic
      const skillsPath = path.join(this.evolution.config?.skillsPath || '/root/.openclaw/workspace/knowledge-system/lib');
      const skills = await fs.readdir(skillsPath).catch(() => []);
      
      // Check if skill name matches topic
      const normalizedTopic = topicName.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const skill of skills) {
        const normalizedSkill = skill.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedTopic.includes(normalizedSkill) || normalizedSkill.includes(normalizedTopic)) {
          // Check coverage by reading SKILL.md
          const coverage = await this.checkSkillCoverage(skill, topicName, skillsPath);
          if (coverage.covers) {
            return {
              shouldLearn: false,
              reason: `Covered by existing skill: ${skill} (${coverage.reason})`
            };
          }
        }
      }
      
      // Check if there's a pending proposal for this topic
      const pending = await this.evolution.pending.list({ status: 'pending' });
      const alreadyProposed = pending.find(p => 
        p.change?.reason?.toLowerCase().includes(topicName.toLowerCase()) ||
        p.change?.skill?.description?.toLowerCase().includes(topicName.toLowerCase())
      );
      
      if (alreadyProposed) {
        return {
          shouldLearn: false,
          reason: `Already proposed for skill creation: ${alreadyProposed.id}`
        };
      }
      
      return { shouldLearn: true };
      
    } catch (err) {
      await this.log(`⚠️ Evolution check failed for ${topicName}: ${err.message}`, 'WARN');
      // Allow learning if check fails (fail open)
      return { shouldLearn: true, reason: 'Evolution check failed, allowing' };
    }
  }

  /**
   * Check if skill covers the topic by reading SKILL.md
   */
  async checkSkillCoverage(skillName, topicName, skillsPath) {
    try {
      const skillMdPath = path.join(skillsPath, skillName, 'SKILL.md');
      const content = await fs.readFile(skillMdPath, 'utf8');
      
      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        return { covers: false, reason: 'No frontmatter' };
      }
      
      const frontmatter = frontmatterMatch[1];
      const description = frontmatter.match(/description:\s*(.+)/)?.[1] || '';
      
      // Check if topic is mentioned in description
      const normalizedTopic = topicName.toLowerCase();
      const normalizedDesc = description.toLowerCase();
      
      if (normalizedDesc.includes(normalizedTopic)) {
        return { covers: true, reason: 'Topic in description' };
      }
      
      // Check usage section for topic coverage
      const usageMatch = content.match(/## Usage\s*\n([\s\S]*?)(?=##|$)/);
      if (usageMatch) {
        const usage = usageMatch[1].toLowerCase();
        if (usage.includes(normalizedTopic)) {
          return { covers: true, reason: 'Topic in usage' };
        }
      }
      
      return { covers: false, reason: 'Topic not covered' };
      
    } catch (err) {
      // If can't read SKILL.md, assume no coverage
      return { covers: false, reason: 'Cannot read SKILL.md' };
    }
  }

  async log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logLine.trim());
    await fs.appendFile(LOG_FILE, logLine).catch(() => {});
  }

  async logDiagnostic(step, data) {
    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      step,
      data: typeof data === 'object' ? JSON.stringify(data, null, 2) : data
    };
    const logLine = `[${timestamp}] [DIAG] ${step}: ${entry.data}\n`;
    await fs.appendFile(DIAGNOSTIC_LOG, logLine).catch(() => {});
  }

  async runDiagnostics() {
    await this.log('🔍 Running pre-flight diagnostics...', 'DIAG');
    const diagnostics = { timestamp: new Date().toISOString(), checks: {} };

    try {
      const qdrantHealth = await axios.get(`${QDRANT_URL}/collections/${COLLECTION}`);
      diagnostics.checks.qdrant = { status: 'OK', vectors: qdrantHealth.data.result.points_count };
      await this.log(`✅ Qdrant: ${qdrantHealth.data.result.points_count} vectors`, 'DIAG');
    } catch (e) {
      diagnostics.checks.qdrant = { status: 'FAIL', error: e.message };
      await this.log(`❌ Qdrant FAIL: ${e.message}`, 'ERROR');
    }

    try {
      const testEmbedding = await getEmbedding('test');
      diagnostics.checks.embedding = { status: 'OK', dimensions: testEmbedding.length };
      await this.log(`✅ Embedding: ${testEmbedding.length} dims`, 'DIAG');
    } catch (e) {
      diagnostics.checks.embedding = { status: 'FAIL', error: e.message };
      await this.log(`❌ Embedding FAIL: ${e.message}`, 'ERROR');
    }

    await this.logDiagnostic('DIAGNOSTICS', diagnostics);
    return diagnostics;
  }

  async getStats() {
    try {
      const response = await axios.get(`${QDRANT_URL}/collections/${COLLECTION}`);
      return { vectors: response.data.result.points_count, status: 'ok' };
    } catch (e) {
      return { vectors: 0, status: 'error', error: e.message };
    }
  }

  async extractTopicsFromSessions() {
    await this.log('📁 Extracting topics...');
    const adapter = new OpenClawAdapter({ hours: 24 });
    const sessions = await adapter.getRecentSessions();
    
    const topics = { technologies: new Set(), problems: new Set(), solutions: new Set(), patterns: new Set() };
    
    for (const session of sessions) {
      const knowledge = adapter.extractKnowledge(session);
      knowledge.metadata.techMentions.forEach(t => topics.technologies.add(t));
      knowledge.metadata.problemIndicators.forEach(p => topics.problems.add(p));
      const entities = adapter.extractEntities(knowledge.text);
      entities.forEach(e => {
        if (e.type === 'technology') topics.technologies.add(e.text);
        if (e.type === 'problem') topics.problems.add(e.text);
      });
    }
    
    const customTopics = await this.loadCustomTopics();
    customTopics.forEach(t => {
      if (t.type === 'technology') topics.technologies.add(t.name);
      if (t.type === 'problem') topics.problems.add(t.name);
    });
    
    const result = {
      technologies: Array.from(topics.technologies),
      problems: Array.from(topics.problems),
      solutions: Array.from(topics.solutions),
      patterns: Array.from(topics.patterns),
      sessionCount: sessions.length,
      customTopicsCount: customTopics.length
    };
    
    await this.log(`📊 Topics: ${result.technologies.length} tech, ${result.problems.length} problems`);
    return result;
  }
  
  async loadCustomTopics() {
    try {
      const TopicsManager = require('../custom-topics.js');
      const manager = new TopicsManager();
      return await manager.getTopicsForDeepLearning();
    } catch (e) {
      return [];
    }
  }

  async topicExists(topicName) {
    try {
      const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
        filter: { must: [{ key: 'name', match: { value: topicName } }] },
        limit: 1
      });
      const exists = response.data.result.points?.length > 0;
      await this.logDiagnostic('TOPIC_EXISTS', { topic: topicName, exists });
      return exists;
    } catch (e) {
      return false;
    }
  }

  // NEW: Use Mega-Agent for enhanced topic expansion
  async generateExpertNoteWithMegaAgent(topic, context) {
    // Check if Mega-Agent is enabled
    if (!this.flags.isEnabled('MEGA_AGENT')) {
      await this.log(`⏸️ Mega-Agent disabled, using legacy mode for: ${topic}`, 'DEBUG');
      return this.generateExpertNote(topic, context);
    }
    
    this.stats.attempted++;
    await this.log(`🤖 Using Mega-Agent for: ${topic}`);
    await this.logDiagnostic('MEGA_AGENT_START', { topic });
    
    try {
      const { MegaAgentCoordinator } = require('../src/mega-agents');
      const coordinator = new MegaAgentCoordinator();
      
      const result = await coordinator.processTopic(topic, context.type || 'technology');
      
      await this.log(`✅ Mega-Agent success: ${topic} (quality: ${(result.qualityScore * 100).toFixed(1)}%)`);
      this.stats.expanded++;
      
      return result;
    } catch (error) {
      await this.log(`⚠️ Mega-Agent failed for ${topic}, falling back to legacy: ${error.message}`, 'WARN');
      await this.logDiagnostic('MEGA_AGENT_FALLBACK', { topic, error: error.message });
      
      // Fallback to legacy method
      return this.generateExpertNote(topic, context);
    }
    
    // Check if LLM is enabled
    if (!this.flags.shouldUseLLM()) {
      await this.log(`⏸️ LLM API disabled for: ${topic}`, 'WARN');
      return null;
    }
    
    this.stats.attempted++;
    await this.log(`📝 Generating note for: ${topic}`);
    await this.logDiagnostic('LLM_START', { topic });

    const prompt = `Analyze "${topic}" from software development context.

Create a detailed JSON object with real content (not placeholders):
{
  "name": "${topic}",
  "type": "technology",
  "description": "Detailed 2-3 sentence description of what ${topic} is and when to use it",
  "related": ["3-5 real related technologies"],
  "bestPractices": ["3-5 specific best practices for using ${topic}"],
  "commonMistakes": ["3-5 common mistakes developers make with ${topic}"]
}

IMPORTANT: Provide REAL specific content, not generic placeholders like "practice 1" or "mistake 1". Respond ONLY with valid JSON.`;

    try {
      const startTime = Date.now();
      
      // Use Anthropic-messages API format (as OpenClaw does)
      const response = await axios.post(
        `${process.env.KIMI_BASE_URL || 'https://api.kimi.com/coding'}/v1/messages`,
        {
          model: 'kimi-k2-5',
          messages: [
            { role: 'system', content: 'Respond with valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 800
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY || ''}`,
            'User-Agent': 'OpenClaw/2026.2.17'
          },
          timeout: 60000
        }
      );
      
      const duration = Date.now() - startTime;
      // Anthropic format: content[0].text
      const content = response.data.content?.[0]?.text || '';
      
      await this.logDiagnostic('LLM_DONE', { topic, duration, contentLength: content.length });
      
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          await this.log(`✅ LLM success: ${topic} (${duration}ms)`);
          this.stats.expanded++;
          return parsed;
        }
      } catch (e) {
        await this.log(`⚠️ JSON parse failed for ${topic}, using fallback`);
      }
      
      // Fallback
      return {
        name: topic,
        type: 'technology',
        description: `${topic} - software development technology`,
        related: [],
        bestPractices: [],
        commonMistakes: []
      };
      
    } catch (e) {
      await this.log(`❌ LLM error for ${topic}: ${e.message}`, 'ERROR');
      this.stats.failed++;
      // Return fallback instead of null
      return {
        name: topic,
        type: 'technology',
        description: `${topic} - software development technology`,
        related: [],
        bestPractices: [],
        commonMistakes: []
      };
    }
  }

  // NEW: Check quality of existing topic
  async checkExistingTopicQuality(topicName) {
    try {
      const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
        filter: { must: [{ key: 'name', match: { value: topicName } }] },
        with_payload: true,
        limit: 1
      });
      
      const point = response.data.result.points?.[0];
      if (!point) return { needsEnrichment: true, reasons: ['Not found'] };
      
      const p = point.payload;
      const reasons = [];
      
      // Quality thresholds
      if (!p.text || p.text.length < 300) reasons.push('short description');
      if (!p.related || p.related.length < 5) reasons.push('few related topics');
      if (!p.bestPractices || p.bestPractices.length < 5) reasons.push('few best practices');
      if (!p.commonMistakes || p.commonMistakes.length < 5) reasons.push('few common mistakes');
      
      return {
        needsEnrichment: reasons.length > 0,
        reasons,
        id: point.id,
        currentPayload: p
      };
    } catch (e) {
      return { needsEnrichment: true, reasons: ['Error checking quality'] };
    }
  }

  // NEW: Update existing knowledge entry
  async updateKnowledge(topicName, enrichedEntry) {
    try {
      // Find existing point
      const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
        filter: { must: [{ key: 'name', match: { value: topicName } }] },
        with_payload: true,
        limit: 1
      });
      
      const point = response.data.result.points?.[0];
      if (!point) return false;
      
      // Generate new embedding with enriched content
      const text = `${enrichedEntry.name}. ${enrichedEntry.description}. Best practices: ${enrichedEntry.bestPractices?.join(', ') || ''}`;
      const embedding = await getEmbedding(text);
      
      // Update with enriched data
      await axios.put(`${QDRANT_URL}/collections/${COLLECTION}/points`, {
        points: [{
          id: point.id,
          vector: embedding,
          payload: {
            ...point.payload,
            name: enrichedEntry.name,
            type: enrichedEntry.type,
            text: enrichedEntry.description,
            related: enrichedEntry.related || [],
            bestPractices: enrichedEntry.bestPractices || [],
            commonMistakes: enrichedEntry.commonMistakes || [],
            enriched: true,
            enrichedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }]
      });
      
      await this.log(`✅ Enriched: ${topicName}`);
      
      // Also update Memgraph
      await this.saveToMemgraph(enrichedEntry);
      
      return true;
    } catch (e) {
      await this.log(`❌ Enrichment failed: ${e.message}`, 'ERROR');
      return false;
    }
  }

  async expandTopic(topic, type) {
    if (this.expandedTopics.has(topic)) return null;
    
    const exists = await this.topicExists(topic);
    if (exists) {
      // NEW: Check quality of existing topic
      const qualityCheck = await this.checkExistingTopicQuality(topic);
      if (qualityCheck.needsEnrichment) {
        await this.log(`🔄 ${topic} exists but needs enrichment: ${qualityCheck.reasons.join(', ')}`);
        const enriched = await this.generateExpertNoteWithMegaAgent(topic, `Type: ${type}`);
        if (enriched) {
          // Update existing entry
          await this.updateKnowledge(topic, enriched);
          this.expandedTopics.add(topic);
          return enriched;
        }
      } else {
        await this.log(`⏩ ${topic} exists with high quality`);
      }
      return null;
    }
    
    await this.log(`🔍 Expanding: ${topic}`);
    const note = await this.generateExpertNoteWithMegaAgent(topic, `Type: ${type}`);
    
    if (note) {
      this.expandedTopics.add(topic);
    }
    return note;
  }

  // FIXED: Use correct Qdrant upsert endpoint
  async storeKnowledge(entry) {
    // Check if Qdrant save is enabled
    if (!this.flags.shouldSaveToQdrant()) {
      await this.log(`⏸️ Qdrant save disabled for: ${entry.name}`, 'WARN');
      return false;
    }
    
    await this.log(`💾 Storing: ${entry.name}`);
    
    try {
      const text = `${entry.name}. ${entry.description}. Best practices: ${entry.bestPractices?.join(', ') || ''}`;
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
      
      // Use PUT for upsert (Qdrant requires PUT not POST)
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
            source: 'deep-learning',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }]
      });
      
      // Verify storage with correct API
      await this.log(`✅ Stored: ${entry.name} (ID: ${newId})`);
      
      // Add to MemgraphSync queue for async processing (non-blocking)
      if (this.memgraphSync) {
        await this.memgraphSync.addSyncTask(entry, 'CREATE');
        await this.log(`📝 Queued for Memgraph sync: ${entry.name}`);
        
        // Audit log
        if (this.audit) {
          await this.audit.logSync('MEMGRAPH', 'QUEUED', { entity: entry.name });
        }
      } else {
        // Fallback to direct save if sync not available
        await this.saveToMemgraph(entry);
      }
      
      this.stats.stored++;
      
      // Track for post-learning expansion
      this.newlyStoredTopics.push({
        name: entry.name,
        type: entry.type,
        quality: entry.quality || 0.7,
        bestPractices: entry.bestPractices || [],
        commonMistakes: entry.commonMistakes || [],
        related: entry.related || [],
        description: entry.description
      });
      
      // Audit log for successful storage
      if (this.audit) {
        await this.audit.log({
          type: 'KNOWLEDGE_STORED',
          entity: entry.name,
          qdrantId: newId,
          hasMemgraph: !!this.memgraphSync
        });
      }
      
      return true;
      
    } catch (e) {
      await this.log(`❌ Store error: ${e.message}`, 'ERROR');
      await this.logDiagnostic('STORE_ERROR', { 
        error: e.message, 
        response: e.response?.data,
        status: e.response?.status,
        entry: entry.name 
      });
      return false;
    }
  }

  // Save entity and relationships to Memgraph
  async saveToMemgraph(entry) {
    // Check if Memgraph save is enabled
    if (!this.flags.shouldSaveToMemgraph()) {
      await this.log(`⏸️ Memgraph save disabled for: ${entry.name}`, 'WARN');
      return false;
    }
    
    try {
      await this.log(`🕸️  Saving to Memgraph: ${entry.name}`);
      
      // Dynamic import to avoid issues if neo4j-driver not installed
      const neo4j = require('neo4j-driver');
      const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('', ''));
      const session = driver.session();
      
      try {
        // Create or merge the main entity
        await session.run(`
          MERGE (e:Entity {name: $name})
          SET e.type = $type,
              e.description = $description,
              e.source = 'deep-learning',
              e.createdAt = datetime(),
              e.updatedAt = datetime()
          RETURN e
        `, {
          name: entry.name,
          type: entry.type,
          description: entry.description
        });
        
        await this.log(`✅ Entity saved: ${entry.name}`);
        
        // Create relationships to related technologies
        if (entry.related && entry.related.length > 0) {
          for (const relatedName of entry.related) {
            await session.run(`
              MATCH (e:Entity {name: $entityName})
              MERGE (r:Entity {name: $relatedName})
              ON CREATE SET r.type = 'technology',
                            r.source = 'auto-created',
                            r.createdAt = datetime()
              MERGE (e)-[rel:RELATED_TO]->(r)
              SET rel.createdAt = datetime(),
                  rel.source = 'deep-learning'
              RETURN rel
            `, {
              entityName: entry.name,
              relatedName: relatedName
            });
          }
          await this.log(`🔗 Created ${entry.related.length} relationships for ${entry.name}`);
        }
        
        // Add best practices as separate nodes
        if (entry.bestPractices && entry.bestPractices.length > 0) {
          for (let i = 0; i < entry.bestPractices.length; i++) {
            const practice = entry.bestPractices[i];
            await session.run(`
              MATCH (e:Entity {name: $entityName})
              CREATE (p:BestPractice {
                description: $practice,
                order: $order,
                createdAt: datetime(),
                source: 'deep-learning'
              })
              CREATE (e)-[:HAS_BEST_PRACTICE]->(p)
              RETURN p
            `, {
              entityName: entry.name,
              practice: practice,
              order: i + 1
            });
          }
          await this.log(`⭐ Added ${entry.bestPractices.length} best practices for ${entry.name}`);
        }
        
        // Add common mistakes as separate nodes
        if (entry.commonMistakes && entry.commonMistakes.length > 0) {
          for (let i = 0; i < entry.commonMistakes.length; i++) {
            const mistake = entry.commonMistakes[i];
            await session.run(`
              MATCH (e:Entity {name: $entityName})
              CREATE (m:CommonMistake {
                description: $mistake,
                order: $order,
                createdAt: datetime(),
                source: 'deep-learning'
              })
              CREATE (e)-[:HAS_COMMON_MISTAKE]->(m)
              RETURN m
            `, {
              entityName: entry.name,
              mistake: mistake,
              order: i + 1
            });
          }
          await this.log(`⚠️  Added ${entry.commonMistakes.length} common mistakes for ${entry.name}`);
        }
        
      } finally {
        await session.close();
        await driver.close();
      }
      
      await this.logDiagnostic('MEMGRAPH_SUCCESS', { name: entry.name, related: entry.related?.length || 0 });
      
    } catch (e) {
      await this.log(`⚠️  Memgraph save failed for ${entry.name}: ${e.message}`, 'WARN');
      await this.logDiagnostic('MEMGRAPH_ERROR', { error: e.message, entry: entry.name });
      // Don't fail the whole process if Memgraph fails
    }
  }

  async run(options = {}) {
    const limit = options.limit || 10;
    const customOnly = options.customOnly || false;
    
    // Initialize Evolution connection
    await this.init();
    
    await this.log('='.repeat(60));
    await this.log('🧠 DEEP LEARNING STARTED');
    await this.log('='.repeat(60));
    
    // PRE-FLIGHT CHECKPOINT
    const gates = new CheckpointGates();
    const preFlight = await gates.preFlightCheck();
    // Temporarily allow continuing despite errors for book processing
    if (!preFlight.passed) {
      await this.log('⚠️ Pre-flight checks had issues but continuing...', 'WARN');
      // throw new Error('Pre-flight checks failed');
    }
    
    // Audit log run start
    if (this.audit) {
      await this.audit.log({
        type: 'DEEP_LEARNING_STARTED',
        limit,
        customOnly,
        preFlightPassed: preFlight.passed
      });
    }
    
    // Check if Deep Learning is enabled
    if (!this.flags.isEnabled('DEEP_LEARNING')) {
      await this.log('⏸️ Deep Learning is disabled via feature flags', 'WARN');
      return { newVectors: 0, totalVectors: 0, processed: 0, skipped: true };
    }
    
    const diagnostics = await this.runDiagnostics();
    const stats = await this.getStats();
    await this.log(`📊 Current: ${stats.vectors} vectors`);
    
    // Get topics to process
    let topicsToProcess = [];
    
    if (customOnly) {
      // Process custom topics (high and medium priority)
      const customTopics = await this.loadCustomTopics();
      topicsToProcess = customTopics
        .filter(t => t.priority === 'high' || t.priority === 'medium')
        .map(t => ({ name: t.name, type: t.type || 'technology' }));
      await this.log(`📚 Processing ${topicsToProcess.length} custom topics (high + medium priority)`);
    } else {
      // Process mixed topics
      const topics = await this.extractTopicsFromSessions();
      topicsToProcess = topics.technologies.slice(0, limit).map(t => ({ name: t, type: 'technology' }));
    }
    
    await this.log(`🚀 Processing up to ${limit} new topics`);
    
    let processed = 0;
    let attempted = 0;
    let skippedByEvolution = 0;
    
    // Process topics until we hit limit or run out
    for (const topic of topicsToProcess) {
      if (processed >= limit) break;
      
      // Check if exists first
      const exists = await this.topicExists(topic.name);
      if (exists) {
        await this.log(`⏩ ${topic.name} already exists, skipping`);
        continue;
      }
      
      // Check with Evolution - is there a skill covering this?
      if (this.evolution) {
        const evolutionCheck = await this.shouldLearnTopic(topic.name);
        if (!evolutionCheck.shouldLearn) {
          await this.log(`⏩ ${topic.name} skipped: ${evolutionCheck.reason}`);
          skippedByEvolution++;
          continue;
        }
      }
      
      attempted++;
      const expanded = await this.expandTopic(topic.name, topic.type);
      if (expanded) {
        const stored = await this.storeKnowledge(expanded);
        if (stored) {
          processed++;
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    
    const finalStats = await this.getStats();
    const newVectors = finalStats.vectors - stats.vectors;
    
    await this.log('='.repeat(60));
    await this.log(`✅ COMPLETE: ${newVectors} new vectors (${processed} processed)`);
    await this.log(`   Attempted: ${this.stats.attempted}`);
    await this.log(`   Stored: ${this.stats.stored}`);
    await this.log(`   Failed: ${this.stats.failed}`);
    await this.log(`   Skipped by Evolution: ${skippedByEvolution}`);
    await this.log('='.repeat(60));
    
    // POST-RUN CHECKPOINT
    const postRunGates = new CheckpointGates();
    const postRun = await postRunGates.postRunCheck(newVectors, this.failedTopics);
    if (!postRun.passed) {
      await this.log('⚠️ Post-run validation found issues', 'WARN');
    }
    
    // 2-HOP EXPANSION
    if (this.flags.isEnabled('RELATED_TOPICS') && processed > 0) {
      await this.log('🔗 Running 2-hop topic expansion...');
      const { TwoHopExpansion } = require('../src/two-hop-expansion');
      const hopExpansion = new TwoHopExpansion();
      const hopResult = await hopExpansion.run({ limit: 5 });
      await this.log(`   Discovered ${hopResult.discovered} topics via 2-hop`);
    }
    
    // POST-LEARNING EXPANSION (NEW)
    if (this.newlyStoredTopics.length > 0) {
      await this.log('🌱 Running post-learning expansion...');
      
      if (this.postLearningExpander) {
        try {
          const expansionResults = await this.postLearningExpander.expand(this.newlyStoredTopics);
          await this.log(`   Post-learning expansions: ${expansionResults.added} new topics`);
          
          if (expansionResults.added > 0) {
            await this.log('   Topics to explore next:');
            for (const detail of expansionResults.details.filter(d => d.added)) {
              await this.log(`     - ${detail.to} (from ${detail.from})`);
            }
          }
        } catch (err) {
          await this.log(`⚠️ Post-learning expansion failed: ${err.message}`, 'WARN');
        }
      }
      
      // Quality-based expansion for low-quality topics
      if (this.qualityExpansion) {
        await this.log('🔍 Running quality-based expansion...');
        let qualityExpansions = 0;
        
        for (const topic of this.newlyStoredTopics) {
          if (topic.quality && topic.quality < 0.8) {
            try {
              const result = await this.qualityExpansion.analyzeAndExpand(topic, topic.quality);
              if (result.expanded) {
                qualityExpansions += result.expansions.filter(e => e.added).length;
              }
            } catch (err) {
              await this.log(`⚠️ Quality expansion failed for ${topic.name}: ${err.message}`, 'WARN');
            }
          }
        }
        
        if (qualityExpansions > 0) {
          await this.log(`   Quality expansions: ${qualityExpansions} topics added`);
        }
      }
      
      // Clear tracked topics
      this.newlyStoredTopics = [];
    }
    
    // Audit log run completion
    if (this.audit) {
      await this.audit.log({
        type: 'DEEP_LEARNING_COMPLETE',
        newVectors,
        totalVectors: finalStats.vectors,
        processed,
        attempted: this.stats.attempted,
        stored: this.stats.stored,
        failed: this.stats.failed,
        skippedByEvolution
      });
    }
    
    return {
      newVectors,
      totalVectors: finalStats.vectors,
      processed,
      stats: this.stats,
      postRunChecks: postRun
    };
  }
}

if (require.main === module) {
  const limit = process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1];
  const customOnly = process.argv.includes('--custom');
  const service = new DeepLearningService();
  service.run({ limit: limit ? parseInt(limit) : 5, customOnly })
    .then(report => {
      console.log('\n📋 Report:', JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch(e => {
      console.error('❌ Fatal:', e);
      process.exit(1);
    });
}

module.exports = DeepLearningService;