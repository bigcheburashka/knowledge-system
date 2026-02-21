#!/usr/bin/env node
/**
 * 2-hop Topic Expansion
 * Discovers related topics through graph traversal
 * Example: Docker → Container Orchestration → Kubernetes
 */

const neo4j = require('neo4j-driver');
const fs = require('fs');
const path = require('path');
const { getFeatureFlags } = require('./feature-flags');

const MEMGRAPH_URL = process.env.MEMGRAPH_URL || 'bolt://localhost:7687';
const TOPICS_PATH = path.join(__dirname, '..', 'custom-topics.json');

class TwoHopExpansion {
  constructor() {
    this.flags = getFeatureFlags();
    this.driver = null;
    this.expandedTopics = new Set();
    this.stats = {
      processed: 0,
      discovered: 0,
      added: 0,
      skipped: 0
    };
  }

  async connect() {
    if (!this.driver) {
      this.driver = neo4j.driver(MEMGRAPH_URL, neo4j.auth.basic('', ''));
    }
  }

  async disconnect() {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
    }
  }

  /**
   * Get 2-hop related topics from Memgraph
   * Path: (Topic)-[:RELATED_TO]->(Related1)-[:RELATED_TO]->(Related2)
   */
  async getTwoHopTopics(topicName, maxDepth = 2) {
    await this.connect();
    const session = this.driver.session();

    try {
      // Cypher query for 2-hop traversal
      const query = `
        MATCH (start:Entity {name: $topicName})-[:RELATED_TO*1..${maxDepth}]-(related:Entity)
        WHERE related.name <> $topicName
        WITH related, min(length(shortestPath((start)-[:RELATED_TO*]-(related)))) as distance
        RETURN related.name as name, 
               related.type as type, 
               related.description as description,
               distance
        ORDER BY distance, related.name
        LIMIT 20
      `;

      const result = await session.run(query, { topicName });
      
      const topics = result.records.map(record => ({
        name: record.get('name'),
        type: record.get('type') || 'technology',
        description: record.get('description'),
        distance: record.get('distance').toNumber(),
        sourceTopic: topicName
      }));

      return topics;
    } catch (error) {
      console.error(`Error querying 2-hop for "${topicName}":`, error.message);
      return [];
    } finally {
      await session.close();
    }
  }

  /**
   * Get all topics that need 2-hop expansion
   */
  async getTopicsForExpansion() {
    await this.connect();
    const session = this.driver.session();

    try {
      // Get all entities that have related topics
      const query = `
        MATCH (e:Entity)-[:RELATED_TO]->()
        RETURN DISTINCT e.name as name, e.type as type
        LIMIT 50
      `;

      const result = await session.run(query);
      
      return result.records.map(record => ({
        name: record.get('name'),
        type: record.get('type') || 'technology'
      }));
    } catch (error) {
      console.error('Error getting topics for expansion:', error.message);
      return [];
    } finally {
      await session.close();
    }
  }

  /**
   * Check if topic already exists in custom topics
   */
  async topicExistsInQueue(topicName) {
    try {
      if (!fs.existsSync(TOPICS_PATH)) {
        return false;
      }

      const data = JSON.parse(fs.readFileSync(TOPICS_PATH, 'utf8'));
      return data.topics.some(t => 
        t.name.toLowerCase() === topicName.toLowerCase()
      );
    } catch (error) {
      console.error('Error checking topic existence:', error.message);
      return false;
    }
  }

  /**
   * Check if topic already exists in knowledge base
   */
  async topicExistsInKnowledgeBase(topicName) {
    try {
      const session = this.driver.session();
      
      const query = `
        MATCH (e:Entity {name: $topicName})
        RETURN count(e) as count
      `;
      
      const result = await session.run(query, { topicName });
      const count = result.records[0].get('count').toNumber();
      
      await session.close();
      return count > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Add topic to learning queue
   */
  async addToQueue(topic) {
    try {
      if (!fs.existsSync(TOPICS_PATH)) {
        fs.writeFileSync(TOPICS_PATH, JSON.stringify({ topics: [] }, null, 2));
      }

      const data = JSON.parse(fs.readFileSync(TOPICS_PATH, 'utf8'));

      // Check if already exists
      const exists = data.topics.some(t => 
        t.name.toLowerCase() === topic.name.toLowerCase()
      );

      if (exists) {
        this.stats.skipped++;
        return { added: false, reason: 'already_exists' };
      }

      // Add to queue
      data.topics.push({
        name: topic.name,
        type: topic.type || 'technology',
        priority: 'medium', // 2-hop topics get medium priority
        description: topic.description || `Discovered via 2-hop from ${topic.sourceTopic}`,
        source: '2-hop-expansion',
        sourceTopic: topic.sourceTopic,
        distance: topic.distance,
        addedAt: new Date().toISOString()
      });

      fs.writeFileSync(TOPICS_PATH, JSON.stringify(data, null, 2));
      
      this.stats.added++;
      return { added: true };

    } catch (error) {
      console.error(`Error adding "${topic.name}" to queue:`, error.message);
      return { added: false, reason: 'error' };
    }
  }

  /**
   * Run 2-hop expansion for a specific topic
   */
  async expandTopic(topicName) {
    console.log(`\n🔍 Expanding: ${topicName}`);
    
    const twoHopTopics = await this.getTwoHopTopics(topicName, 2);
    
    if (twoHopTopics.length === 0) {
      console.log('  ℹ️  No 2-hop topics found');
      return [];
    }

    console.log(`  Found ${twoHopTopics.length} related topics:`);
    
    const added = [];
    
    for (const topic of twoHopTopics) {
      // Skip if already in knowledge base
      const existsInKB = await this.topicExistsInKnowledgeBase(topic.name);
      if (existsInKB) {
        console.log(`  ⏩ ${topic.name} (already in KB)`);
        continue;
      }

      // Skip if already in queue
      const existsInQueue = await this.topicExistsInQueue(topic.name);
      if (existsInQueue) {
        console.log(`  ⏩ ${topic.name} (already in queue)`);
        continue;
      }

      // Add to queue
      const result = await this.addToQueue(topic);
      
      if (result.added) {
        console.log(`  ✅ ${topic.name} (${topic.distance}-hop from ${topic.sourceTopic})`);
        added.push(topic);
      }
    }

    return added;
  }

  /**
   * Run full 2-hop expansion
   */
  async run(options = {}) {
    const limit = options.limit || 5;
    const specificTopic = options.topic;

    console.log('\n' + '='.repeat(70));
    console.log('🔗 2-HOP TOPIC EXPANSION');
    console.log('='.repeat(70));

    // Check if enabled
    if (!this.flags.isEnabled('RELATED_TOPICS')) {
      console.log('⏸️ 2-hop expansion disabled via feature flags');
      return this.stats;
    }

    await this.connect();

    let topicsToExpand = [];

    if (specificTopic) {
      // Expand specific topic
      topicsToExpand = [{ name: specificTopic, type: 'technology' }];
    } else {
      // Get all topics from knowledge base
      topicsToExpand = await this.getTopicsForExpansion();
    }

    console.log(`\n📚 Found ${topicsToExpand.length} topics to expand`);
    console.log(`🎯 Will process up to ${limit} topics\n`);

    const allDiscovered = [];

    for (let i = 0; i < Math.min(topicsToExpand.length, limit); i++) {
      const topic = topicsToExpand[i];
      this.stats.processed++;

      const discovered = await this.expandTopic(topic.name);
      allDiscovered.push(...discovered);

      // Small delay to avoid overwhelming the system
      await new Promise(r => setTimeout(r, 100));
    }

    this.stats.discovered = allDiscovered.length;

    await this.disconnect();

    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 2-HOP EXPANSION COMPLETE');
    console.log('='.repeat(70));
    console.log(`Topics processed: ${this.stats.processed}`);
    console.log(`Topics discovered: ${this.stats.discovered}`);
    console.log(`Topics added to queue: ${this.stats.added}`);
    console.log(`Topics skipped: ${this.stats.skipped}`);
    console.log('='.repeat(70) + '\n');

    return {
      ...this.stats,
      discoveredTopics: allDiscovered.map(t => t.name)
    };
  }

  /**
   * Get expansion statistics
   */
  async getStats() {
    await this.connect();
    const session = this.driver.session();

    try {
      // Count entities with relationships
      const relatedResult = await session.run(`
        MATCH (e:Entity)-[:RELATED_TO]->()
        RETURN count(DISTINCT e) as withRelations
      `);

      // Count total entities
      const totalResult = await session.run(`
        MATCH (e:Entity)
        RETURN count(e) as total
      `);

      const withRelations = relatedResult.records[0].get('withRelations').toNumber();
      const total = totalResult.records[0].get('total').toNumber();

      return {
        totalEntities: total,
        withRelations: withRelations,
        expandable: withRelations,
        coverage: total > 0 ? ((withRelations / total) * 100).toFixed(1) : 0
      };

    } catch (error) {
      console.error('Error getting stats:', error.message);
      return { error: error.message };
    } finally {
      await session.close();
      await this.disconnect();
    }
  }
}

// CLI
async function main() {
  const expansion = new TwoHopExpansion();
  
  const command = process.argv[2];

  if (command === 'run') {
    const limit = parseInt(process.argv[3]) || 5;
    const result = await expansion.run({ limit });
    console.log('Result:', JSON.stringify(result, null, 2));
  } else if (command === 'expand') {
    const topic = process.argv[3];
    if (!topic) {
      console.log('Usage: node two-hop-expansion.js expand "Topic Name"');
      return;
    }
    const result = await expansion.run({ topic, limit: 1 });
    console.log('Result:', JSON.stringify(result, null, 2));
  } else if (command === 'stats') {
    const stats = await expansion.getStats();
    console.log('\n📊 2-hop Expansion Stats:');
    console.log('='.repeat(50));
    console.log(`Total entities: ${stats.totalEntities}`);
    console.log(`With relations: ${stats.withRelations}`);
    console.log(`Expandable: ${stats.expandable}`);
    console.log(`Coverage: ${stats.coverage}%`);
    console.log('='.repeat(50) + '\n');
  } else {
    console.log('Usage: node two-hop-expansion.js [run [limit]|expand "Topic"|stats]');
    console.log('');
    console.log('Commands:');
    console.log('  run [limit]          Run expansion on all topics (default: 5)');
    console.log('  expand "Topic"       Expand specific topic');
    console.log('  stats                Show expansion statistics');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { TwoHopExpansion };
