/**
 * Knowledge Graph Walker
 * Walks the knowledge graph and finds unexplored connections
 * Triggers: Daily at 4 AM MSK
 */

const { MemgraphSyncWorker } = require('./evolution/memgraph-sync');
const fs = require('fs').promises;
const path = require('path');

class KnowledgeGraphWalker {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge';
    this.customTopicsPath = options.customTopicsPath || 
      '/root/.openclaw/workspace/knowledge-system/custom-topics.json';
    this.memgraphUrl = options.memgraphUrl || 'bolt://localhost:7687';
  }

  /**
   * Walk the graph from recent nodes
   */
  async walk(options = {}) {
    const maxHops = options.maxHops || 2;
    const maxSuggestions = options.maxSuggestions || 10;
    
    console.log('[GraphWalker] Starting graph walk...');
    
    try {
      // Get recent entities from Memgraph
      const recentEntities = await this.getRecentEntities(10);
      
      const results = {
        entitiesChecked: 0,
        neighborsFound: 0,
        newSuggestions: 0,
        suggestions: []
      };
      
      for (const entity of recentEntities) {
        results.entitiesChecked++;
        
        // Find neighbors up to maxHops
        const neighbors = await this.findNeighbors(entity.name, maxHops);
        
        for (const neighbor of neighbors) {
          results.neighborsFound++;
          
          // Check if neighbor is already learned
          const exists = await this.topicExists(neighbor.name);
          
          if (!exists) {
            const added = await this.addSuggestion(neighbor, entity);
            if (added) {
              results.newSuggestions++;
              results.suggestions.push({
                name: neighbor.name,
                distance: neighbor.hops,
                from: entity.name,
                relation: neighbor.relation
              });
              
              if (results.newSuggestions >= maxSuggestions) {
                break;
              }
            }
          }
        }
        
        if (results.newSuggestions >= maxSuggestions) {
          break;
        }
      }
      
      console.log(`[GraphWalker] Found ${results.newSuggestions} new suggestions`);
      return results;
      
    } catch (err) {
      console.error('[GraphWalker] Error:', err.message);
      return { error: err.message };
    }
  }

  /**
   * Get recently added entities from Memgraph
   */
  async getRecentEntities(limit = 10) {
    try {
      const neo4j = require('neo4j-driver');
      const driver = neo4j.driver(this.memgraphUrl);
      const session = driver.session();
      
      try {
        // Use template literal for LIMIT to avoid Memgraph parameter issue
        const result = await session.run(`
          MATCH (e:Entity)
          WHERE e.createdAt > datetime() - duration('P7D')
          RETURN e.name as name, e.type as type
          ORDER BY e.createdAt DESC
          LIMIT ${parseInt(limit)}
        `);
        
        return result.records.map(r => ({
          name: r.get('name'),
          type: r.get('type')
        }));
      } finally {
        await session.close();
        await driver.close();
      }
    } catch (err) {
      console.error('[GraphWalker] Failed to get recent entities:', err.message);
      return [];
    }
  }

  /**
   * Find neighbors within N hops
   */
  async findNeighbors(entityName, maxHops) {
    const neighbors = [];
    
    try {
      const neo4j = require('neo4j-driver');
      const driver = neo4j.driver(this.memgraphUrl);
      const session = driver.session();
      
      try {
        // Find all nodes within maxHops
        const result = await session.run(`
          MATCH (start:Entity {name: $name})
          MATCH (start)-[r*1..${maxHops}]-(neighbor:Entity)
          WHERE neighbor <> start
          RETURN DISTINCT neighbor.name as name, 
                 neighbor.type as type,
                 length(r) as hops,
                 [rel in r | type(rel)] as relations
          LIMIT 50
        `, { name: entityName });
        
        for (const record of result.records) {
          neighbors.push({
            name: record.get('name'),
            type: record.get('type'),
            hops: record.get('hops').toNumber(),
            relation: record.get('relations')[0] // First relation type
          });
        }
      } finally {
        await session.close();
        await driver.close();
      }
    } catch (err) {
      console.error('[GraphWalker] Failed to find neighbors:', err.message);
    }
    
    return neighbors;
  }

  /**
   * Check if topic exists
   */
  async topicExists(name) {
    try {
      const content = await fs.readFile(this.customTopicsPath, 'utf8');
      const data = JSON.parse(content);
      
      return data.topics.some(t => 
        t.name.toLowerCase() === name.toLowerCase()
      );
    } catch {
      return false;
    }
  }

  /**
   * Add suggestion to learning queue
   */
  async addSuggestion(neighbor, sourceEntity) {
    try {
      const content = await fs.readFile(this.customTopicsPath, 'utf8');
      const data = JSON.parse(content);
      
      const topic = {
        name: neighbor.name,
        type: neighbor.type || 'technology',
        priority: neighbor.hops === 1 ? 'high' : 'medium',
        addedAt: new Date().toISOString(),
        addedBy: 'graph-walker',
        source: 'from_graph',
        parentTopic: sourceEntity.name,
        reason: `Found ${neighbor.hops} hop(s) away from ${sourceEntity.name} via ${neighbor.relation}`
      };
      
      data.topics.push(topic);
      
      await fs.writeFile(
        this.customTopicsPath,
        JSON.stringify(data, null, 2)
      );
      
      console.log(`[GraphWalker] Added: ${topic.name}`);
      return true;
      
    } catch (err) {
      console.error('[GraphWalker] Error adding suggestion:', err.message);
      return false;
    }
  }
}

module.exports = { KnowledgeGraphWalker };
