#!/usr/bin/env node
// Knowledge Search Tool - CLI for OpenClaw integration

const HybridSearch = require('../scripts/hybrid-search');
const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

class KnowledgeSearchTool {
  constructor() {
    this.searcher = new HybridSearch({
      vectorWeight: 0.4,
      bm25Weight: 0.3,
      graphWeight: 0.2,
      textWeight: 0.1
    });
  }

  async init() {
    await this.searcher.init();
  }

  async search(query, options = {}) {
    await this.init();
    
    console.log(`\n🔍 Knowledge Search: "${query}"`);
    console.log('='.repeat(70));
    
    const results = await this.searcher.search(query, { limit: options.limit || 5 });
    
    // Format output for OpenClaw consumption
    const formatted = results.map((r, i) => ({
      rank: i + 1,
      name: r.name,
      type: r.type,
      relevance: (r.hybridScore * 100).toFixed(1) + '%',
      sources: r.sources,
      snippet: r.text?.substring(0, 150) + '...' || 'No text'
    }));
    
    console.log('\n📋 Results:');
    formatted.forEach(r => {
      console.log(`\n${r.rank}. ${r.name}`);
      console.log(`   Type: ${r.type} | Relevance: ${r.relevance} | Sources: [${r.sources.join(', ')}]`);
      console.log(`   ${r.snippet}`);
    });
    
    return {
      query,
      found: results.length,
      results: formatted
    };
  }

  // Get stats about knowledge base
  async stats() {
    try {
      const [qdrantStats, graphStats] = await Promise.all([
        axios.get(`${QDRANT_URL}/collections/${COLLECTION}`).catch(() => ({ data: { result: { points_count: 0 } } })),
        this.getGraphStats().catch(() => ({ entities: 0, relations: 0 }))
      ]);
      
      return {
        vectors: qdrantStats.data?.result?.points_count || 0,
        entities: graphStats.entities || 0,
        relations: graphStats.relations || 0,
        status: 'healthy'
      };
    } catch (e) {
      return { 
        vectors: 0, 
        entities: 0, 
        relations: 0,
        error: e.message 
      };
    }
  }

  async getGraphStats() {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    const { stdout: entitiesOut } = await execAsync(
      'echo "MATCH (n) RETURN count(n)" | docker exec -i knowledge-memgraph mgconsole'
    );
    
    const { stdout: relsOut } = await execAsync(
      'echo "MATCH ()-[r]-() RETURN count(r)" | docker exec -i knowledge-memgraph mgconsole'
    );
    
    return {
      entities: parseInt(entitiesOut.match(/\d+/)?.[0] || 0),
      relations: parseInt(relsOut.match(/\d+/)?.[0] || 0)
    };
  }

  // Quick check if system is available
  async health() {
    try {
      await Promise.all([
        axios.get(`${QDRANT_URL}/healthz`),
        this.getGraphStats()
      ]);
      return { status: 'ok', message: 'All systems operational' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  }
}

// CLI
if (require.main === module) {
  const command = process.argv[2] || 'search';
  const tool = new KnowledgeSearchTool();
  
  if (command === 'search') {
    const query = process.argv.slice(3).join(' ') || 'hybrid search example';
    tool.search(query).then(result => {
      console.log('\n' + '='.repeat(70));
      console.log(`Found: ${result.found} results`);
    }).catch(e => {
      console.error('❌ Error:', e.message);
      process.exit(1);
    });
  } else if (command === 'stats') {
    tool.stats().then(s => {
      console.log('📊 Knowledge Base Stats:');
      console.log(`  Vectors: ${s.vectors}`);
      console.log(`  Entities: ${s.entities}`);
      console.log(`  Relations: ${s.relations}`);
      console.log(`  Status: ${s.status}`);
    });
  } else if (command === 'health') {
    tool.health().then(h => {
      console.log(h.status === 'ok' ? '✅ Healthy' : '❌ Error');
      console.log(h.message);
    });
  }
}

module.exports = KnowledgeSearchTool;