// Hybrid Search - With BM25 + Vector + Graph
const { getEmbedding } = require('../src/embedding-service');
const BM25Index = require('./bm25-index');
const axios = require('axios');
const { exec } = require('child_process');
const util = require('util');

const execAsync = util.promisify(exec);
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';

class HybridSearch {
  constructor(options = {}) {
    this.weights = {
      vector: options.vectorWeight || 0.4,
      bm25: options.bm25Weight || 0.3,
      graph: options.graphWeight || 0.2,
      text: options.textWeight || 0.1
    };
    this.bm25 = new BM25Index();
  }

  async init() {
    await this.bm25.load();
  }

  async vectorSearch(query, limit = 10) {
    try {
      const embedding = await getEmbedding(query);
      
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/search`,
        {
          vector: embedding,
          limit: limit,
          with_payload: true
        }
      );
      
      return response.data.result.map(r => ({
        source: 'vector',
        score: r.score,
        name: r.payload.name,
        type: r.payload.type,
        text: r.payload.text,
        id: r.id
      }));
    } catch (e) {
      console.error('Vector search error:', e.message);
      return [];
    }
  }

  // BM25 search in MEMORY.md
  async bm25Search(query, limit = 5) {
    try {
      const results = this.bm25.search(query, limit);
      return results.map((r, i) => ({
        source: 'bm25',
        score: r.score / (r.score + 1), // Normalize to 0-1
        name: r.title,
        type: 'memory',
        text: `From ${r.id}.md`,
        path: r.path,
        id: r.id
      }));
    } catch (e) {
      console.error('BM25 search error:', e.message);
      return [];
    }
  }

  async graphSearch(query, limit = 10) {
    try {
      const keywords = query.toLowerCase().match(/[a-z0-9.]+/g) || [];
      
      if (keywords.length === 0) return [];
      
      const conditions = [];
      for (const k of keywords.slice(0, 3)) {
        if (k.length > 2) {
          conditions.push(`toLower(n.name) CONTAINS '${k}'`);
        }
      }
      
      if (conditions.length === 0) return [];
      
      const cypher = `MATCH (n) WHERE ${conditions.join(' OR ')} RETURN n.name as name, labels(n)[0] as type LIMIT ${limit};`;
      
      const cmd = `echo "${cypher}" | docker exec -i knowledge-memgraph mgconsole`;
      
      const { stdout } = await execAsync(cmd, { timeout: 10000 });
      
      const lines = stdout.split('\n')
        .filter(l => l.includes('|') && !l.includes('name') && !l.includes('type') && !l.includes('---+') && l.trim() !== '|');
      
      return lines.map((line, i) => {
        const parts = line.split('|').map(p => p.trim()).filter(p => p && p !== '"');
        return {
          source: 'graph',
          score: 1 - (i * 0.1),
          name: parts[0]?.replace(/"/g, '') || 'Unknown',
          type: parts[1] || 'Unknown',
          text: ''
        };
      });
    } catch (e) {
      console.error('Graph search error:', e.message);
      return [];
    }
  }

  async textSearch(query) {
    try {
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
        { limit: 100, with_payload: true }
      );
      
      const keywords = query.toLowerCase().split(/\s+/);
      
      return response.data.result.points
        .map(p => {
          const text = (p.payload.text || '').toLowerCase();
          const name = (p.payload.name || '').toLowerCase();
          const combined = text + ' ' + name;
          
          const matches = keywords.filter(k => combined.includes(k)).length;
          return {
            source: 'text',
            score: matches / keywords.length,
            name: p.payload.name,
            type: p.payload.type,
            text: p.payload.text,
            id: p.id
          };
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } catch (e) {
      console.error('Text search error:', e.message);
      return [];
    }
  }

  async search(query, options = {}) {
    console.log(`\n🔍 Hybrid Search: "${query}"`);
    console.log('='.repeat(60));
    
    // Initialize BM25 if needed
    if (!this.bm25.N) {
      await this.init();
    }
    
    const startTime = Date.now();
    
    const [vectorResults, bm25Results, graphResults, textResults] = await Promise.all([
      this.vectorSearch(query, options.limit || 10).catch(() => []),
      this.bm25Search(query, 5).catch(() => []),
      this.graphSearch(query, options.limit || 10).catch(() => []),
      this.textSearch(query).catch(() => [])
    ]);
    
    const searchTime = Date.now() - startTime;
    
    console.log(`📊 Found: ${vectorResults.length} (vector) + ${bm25Results.length} (bm25) + ${graphResults.length} (graph) + ${textResults.length} (text)`);
    console.log(`⏱️  Search time: ${searchTime}ms`);
    
    // Combine results
    const combined = new Map();
    
    // Vector
    vectorResults.forEach((r, i) => {
      const key = r.name || r.text;
      combined.set(key, {
        ...r,
        hybridScore: (r.score * this.weights.vector) / (i + 1),
        sources: ['vector']
      });
    });
    
    // BM25
    bm25Results.forEach((r, i) => {
      const key = r.name || r.text;
      const existing = combined.get(key);
      const score = r.score * this.weights.bm25 / (i + 1);
      
      if (existing) {
        existing.hybridScore += score;
        existing.sources.push('bm25');
      } else {
        combined.set(key, { ...r, hybridScore: score, sources: ['bm25'] });
      }
    });
    
    // Graph
    graphResults.forEach((r, i) => {
      const key = r.name || r.text;
      const existing = combined.get(key);
      const score = r.score * this.weights.graph / (i + 1);
      
      if (existing) {
        existing.hybridScore += score;
        existing.sources.push('graph');
      } else {
        combined.set(key, { ...r, hybridScore: score, sources: ['graph'] });
      }
    });
    
    // Text
    textResults.forEach((r, i) => {
      const key = r.name || r.text;
      const existing = combined.get(key);
      const score = r.score * this.weights.text / (i + 1);
      
      if (existing) {
        existing.hybridScore += score;
        existing.sources.push('text');
      } else {
        combined.set(key, { ...r, hybridScore: score, sources: ['text'] });
      }
    });
    
    const results = Array.from(combined.values())
      .sort((a, b) => b.hybridScore - a.hybridScore)
      .slice(0, options.limit || 5);
    
    console.log('\n🎯 Top Results:');
    results.forEach((r, i) => {
      const sources = r.sources ? `[${r.sources.join('+')}]` : `[${r.source}]`;
      console.log(`  ${i + 1}. ${r.name || r.text?.substring(0, 40)}...`);
      console.log(`     Score: ${r.hybridScore.toFixed(3)} ${sources}`);
    });
    
    return results;
  }
}

if (require.main === module) {
  const query = process.argv[2] || 'Telegram bot framework';
  const searcher = new HybridSearch();
  
  searcher.search(query).then(() => {
    console.log('\n✅ Search complete');
  }).catch(e => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  });
}

module.exports = HybridSearch;