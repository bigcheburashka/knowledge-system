/**
 * Adaptive RAG
 * Dynamic retrieval strategy selection
 */

class AdaptiveRAG {
  constructor(options = {}) {
    this.bm25 = options.bm25;
    this.vector = options.vector;
    this.graph = options.graph;
    this.thresholds = {
      simple: options.simpleThreshold || 0.8,
      moderate: options.moderateThreshold || 0.6
    };
  }

  /**
   * Classify query complexity
   */
  classifyQuery(query) {
    const complexity = this.assessComplexity(query);
    
    if (complexity <= this.thresholds.simple) {
      return 'SIMPLE';
    } else if (complexity <= this.thresholds.moderate) {
      return 'MODERATE';
    }
    return 'COMPLEX';
  }

  /**
   * Assess query complexity
   */
  assessComplexity(query) {
    let score = 0.5; // Base complexity
    
    // Length factor
    const words = query.split(/\s+/).length;
    if (words > 10) score += 0.1;
    if (words > 20) score += 0.1;
    
    // Technical terms
    const technical = /\b(api|database|architecture|optimization|algorithm)\b/i;
    if (technical.test(query)) score += 0.15;
    
    // Comparison/complexity indicators
    const complex = /\b(compare|difference|best|worst|pros?\s+cons)\b/i;
    if (complex.test(query)) score += 0.1;
    
    return Math.min(score, 1.0);
  }

  /**
   * Retrieve based on query classification
   */
  async retrieve(query, options = {}) {
    const complexity = this.classifyQuery(query);
    
    switch (complexity) {
      case 'SIMPLE':
        return this.retrieveSimple(query, options);
      case 'MODERATE':
        return this.retrieveModerate(query, options);
      case 'COMPLEX':
        return this.retrieveComplex(query, options);
      default:
        return this.retrieveModerate(query, options);
    }
  }

  /**
   * Simple retrieval: BM25 only (fast)
   */
  async retrieveSimple(query, options) {
    if (!this.bm25) return [];
    
    const results = await this.bm25.search(query, { limit: options.limit || 5 });
    
    return {
      strategy: 'SIMPLE',
      complexity: 'low',
      results,
      sources: ['bm25']
    };
  }

  /**
   * Moderate retrieval: Vector + BM25 (balanced)
   */
  async retrieveModerate(query, options) {
    const [vectorResults, bm25Results] = await Promise.all([
      this.vector ? this.vector.search(query, { limit: 3 }) : [],
      this.bm25 ? this.bm25.search(query, { limit: 3 }) : []
    ]);
    
    // Merge and deduplicate
    const merged = this.mergeResults(vectorResults, bm25Results);
    
    return {
      strategy: 'MODERATE',
      complexity: 'medium',
      results: merged.slice(0, options.limit || 5),
      sources: ['vector', 'bm25']
    };
  }

  /**
   * Complex retrieval: Vector + BM25 + Graph + Two-hop
   */
  async retrieveComplex(query, options) {
    const [vectorResults, bm25Results, graphResults] = await Promise.all([
      this.vector ? this.vector.search(query, { limit: 3 }) : [],
      this.bm25 ? this.bm25.search(query, { limit: 3 }) : [],
      this.graph ? this.graph.search(query, { limit: 3 }) : []
    ]);
    
    // Two-hop expansion for complex queries
    const twoHop = await this.twoHopExpansion(query, vectorResults);
    
    // Merge all sources
    const merged = this.mergeResults(vectorResults, bm25Results, graphResults, twoHop);
    
    return {
      strategy: 'COMPLEX',
      complexity: 'high',
      results: merged.slice(0, options.limit || 8),
      sources: ['vector', 'bm25', 'graph', 'two-hop']
    };
  }

  /**
   * Two-hop expansion
   */
  async twoHopExpansion(query, initialResults) {
    // Extract entities from initial results
    const entities = this.extractEntities(initialResults);
    
    // Search for related entities
    const related = [];
    for (const entity of entities.slice(0, 3)) {
      if (this.graph) {
        const neighbors = await this.graph.getNeighbors(entity);
        related.push(...neighbors);
      }
    }
    
    return related;
  }

  /**
   * Extract entities from results
   */
  extractEntities(results) {
    const entities = new Set();
    for (const r of results) {
      if (r.entities) {
        r.entities.forEach(e => entities.add(e));
      }
    }
    return Array.from(entities);
  }

  /**
   * Merge results from multiple sources
   */
  mergeResults(...resultSets) {
    const seen = new Set();
    const merged = [];
    
    for (const results of resultSets) {
      for (const r of results) {
        const key = r.id || r.content;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(r);
        }
      }
    }
    
    return merged;
  }

  /**
   * Get retrieval statistics
   */
  getStats() {
    return {
      strategies: {
        simple: 0,
        moderate: 0,
        complex: 0
      }
    };
  }
}

module.exports = { AdaptiveRAG };
