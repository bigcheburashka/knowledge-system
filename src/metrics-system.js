#!/usr/bin/env node
/**
 * Metrics System for Expert Knowledge System
 * Measures: Recall@K, Precision, Response Time
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';
const METRICS_DIR = path.join(__dirname, '..', 'metrics');

// Test dataset: questions with expected answers
const TEST_DATASET = [
  {
    query: "How to prevent memory leaks in Node.js?",
    expectedTopics: ["Memory Leaks in Node.js", "V8 JavaScript Engine", "Node.js EventEmitter"],
    category: "problem"
  },
  {
    query: "What is microservices architecture?",
    expectedTopics: ["Microservices Architecture", "Docker", "Kubernetes"],
    category: "concept"
  },
  {
    query: "How to optimize database queries?",
    expectedTopics: ["PostgreSQL Replication", "Database Indexing", "Query Optimization"],
    category: "howto"
  },
  {
    query: "Best practices for CI/CD pipelines",
    expectedTopics: ["CI/CD Pipeline Acceleration", "GitHub Actions", "DevOps"],
    category: "bestpractices"
  },
  {
    query: "Explainable AI systems",
    expectedTopics: ["Explainable AI", "Machine Learning", "AI Ethics"],
    category: "concept"
  },
  {
    query: "Android UI testing frameworks",
    expectedTopics: ["Espresso Android Testing", "Android Development", "UI Test Generation"],
    category: "technology"
  },
  {
    query: "Graph database for knowledge systems",
    expectedTopics: ["GraphRAG", "Knowledge Graph Construction", "Memgraph"],
    category: "technology"
  },
  {
    query: "Event-driven architecture patterns",
    expectedTopics: ["Event-Driven Architecture", "Message Queue", "CQRS"],
    category: "pattern"
  },
  {
    query: "Web performance optimization",
    expectedTopics: ["Web Performance Optimization", "INP", "LCP", "CLS"],
    category: "optimization"
  },
  {
    query: "Container orchestration with Kubernetes",
    expectedTopics: ["Kubernetes Best Practices", "Docker", "Microservices Architecture"],
    category: "technology"
  },
  {
    query: "Rust ownership and borrowing",
    expectedTopics: ["Rust Ownership Model", "Memory Safety", "Rust"],
    category: "concept"
  },
  {
    query: "Telegram bot development",
    expectedTopics: ["Telegraf Bot Framework", "Node.js", "Bot Development"],
    category: "technology"
  },
  {
    query: "Local machine learning inference",
    expectedTopics: ["TinyML Local Inference", "Ollama", "LLM"],
    category: "technology"
  },
  {
    query: "EU AI Act compliance requirements",
    expectedTopics: ["EU AI Act Compliance", "AI Ethics", "Regulation"],
    category: "regulation"
  },
  {
    query: "Proactive help systems design",
    expectedTopics: ["Proactive Help Systems", "Context Awareness Systems", "AI"],
    category: "concept"
  },
  {
    query: "Hybrid search ranking",
    expectedTopics: ["Hybrid Search Reranking", "BM25", "Vector Search"],
    category: "algorithm"
  },
  {
    query: "Code parsing and AST analysis",
    expectedTopics: ["Code AST Parsing", "Static Analysis", "Compiler"],
    category: "technology"
  },
  {
    query: "Knowledge visualization",
    expectedTopics: ["Visual Knowledge Graph", "Data Visualization", "Graph"],
    category: "visualization"
  },
  {
    query: "Temporal knowledge decay",
    expectedTopics: ["Temporal Knowledge Decay", "Knowledge Management", "Outdated Info"],
    category: "concept"
  },
  {
    query: "Agentic workflows automation",
    expectedTopics: ["Agentic Workflows 2.0", "AI Agents", "Automation"],
    category: "concept"
  }
];

class MetricsSystem {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      summary: {},
      details: []
    };
  }

  async runSearch(query) {
    const startTime = Date.now();
    
    try {
      // Hybrid search: vector + BM25
      const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/search`, {
        vector: await this.getQueryEmbedding(query),
        limit: 10,
        with_payload: true
      });

      const searchTime = Date.now() - startTime;
      
      return {
        results: response.data.result.map(r => ({
          id: r.id,
          score: r.score,
          name: r.payload.name,
          type: r.payload.type
        })),
        responseTime: searchTime
      };
    } catch (error) {
      console.error(`Search failed for "${query}":`, error.message);
      return { results: [], responseTime: 0 };
    }
  }

  async getQueryEmbedding(query) {
    // Use OpenAI for embedding
    const { EmbeddingService } = require('../src/embedding-service');
    const embedder = new EmbeddingService();
    await embedder.initialize();
    
    const embedding = await embedder.getEmbedding(query);
    return embedding;
  }

  calculateRecallAtK(results, expectedTopics, k) {
    const topK = results.slice(0, k);
    const found = topK.filter(r => 
      expectedTopics.some(expected => 
        r.name.toLowerCase().includes(expected.toLowerCase()) ||
        expected.toLowerCase().includes(r.name.toLowerCase())
      )
    );
    
    return found.length / expectedTopics.length;
  }

  calculatePrecision(results, expectedTopics) {
    if (results.length === 0) return 0;
    
    const relevant = results.filter(r => 
      expectedTopics.some(expected => 
        r.name.toLowerCase().includes(expected.toLowerCase()) ||
        expected.toLowerCase().includes(r.name.toLowerCase())
      )
    );
    
    return relevant.length / results.length;
  }

  async runFullEvaluation() {
    console.log('🔍 Running Full Metrics Evaluation\n');
    console.log(`Test dataset: ${TEST_DATASET.length} queries\n`);

    let totalRecall1 = 0;
    let totalRecall3 = 0;
    let totalRecall5 = 0;
    let totalPrecision = 0;
    let totalResponseTime = 0;

    for (let i = 0; i < TEST_DATASET.length; i++) {
      const test = TEST_DATASET[i];
      console.log(`[${i + 1}/${TEST_DATASET.length}] "${test.query.substring(0, 50)}..."`);

      const searchResult = await this.runSearch(test.query);
      
      const recall1 = this.calculateRecallAtK(searchResult.results, test.expectedTopics, 1);
      const recall3 = this.calculateRecallAtK(searchResult.results, test.expectedTopics, 3);
      const recall5 = this.calculateRecallAtK(searchResult.results, test.expectedTopics, 5);
      const precision = this.calculatePrecision(searchResult.results, test.expectedTopics);

      totalRecall1 += recall1;
      totalRecall3 += recall3;
      totalRecall5 += recall5;
      totalPrecision += precision;
      totalResponseTime += searchResult.responseTime;

      this.results.details.push({
        query: test.query,
        category: test.category,
        recall1,
        recall3,
        recall5,
        precision,
        responseTime: searchResult.responseTime,
        found: searchResult.results.slice(0, 5).map(r => r.name)
      });

      console.log(`  Recall@1: ${(recall1 * 100).toFixed(1)}% | Recall@3: ${(recall3 * 100).toFixed(1)}% | Recall@5: ${(recall5 * 100).toFixed(1)}%`);
    }

    const count = TEST_DATASET.length;
    
    this.results.summary = {
      totalQueries: count,
      recallAt1: (totalRecall1 / count * 100).toFixed(2),
      recallAt3: (totalRecall3 / count * 100).toFixed(2),
      recallAt5: (totalRecall5 / count * 100).toFixed(2),
      precision: (totalPrecision / count * 100).toFixed(2),
      avgResponseTime: (totalResponseTime / count).toFixed(0),
      totalVectors: await this.getVectorCount()
    };

    return this.results;
  }

  async getVectorCount() {
    try {
      const response = await axios.get(`${QDRANT_URL}/collections/${COLLECTION}`);
      return response.data.result.points_count;
    } catch (error) {
      return 0;
    }
  }

  saveResults() {
    if (!fs.existsSync(METRICS_DIR)) {
      fs.mkdirSync(METRICS_DIR, { recursive: true });
    }

    const filename = path.join(METRICS_DIR, `metrics-${Date.now()}.json`);
    fs.writeFileSync(filename, JSON.stringify(this.results, null, 2));
    
    // Also save as latest
    const latestFile = path.join(METRICS_DIR, 'latest.json');
    fs.writeFileSync(latestFile, JSON.stringify(this.results, null, 2));

    return filename;
  }

  printReport() {
    const s = this.results.summary;
    
    console.log('\n' + '='.repeat(70));
    console.log('📊 METRICS REPORT');
    console.log('='.repeat(70));
    console.log(`Timestamp: ${this.results.timestamp}`);
    console.log(`Total Vectors: ${s.totalVectors}`);
    console.log(`Queries Tested: ${s.totalQueries}`);
    console.log('-'.repeat(70));
    console.log('');
    console.log('🎯 RECALL (как много правильных нашлось):');
    console.log(`  Recall@1:  ${s.recallAt1}%`);
    console.log(`  Recall@3:  ${s.recallAt3}%`);
    console.log(`  Recall@5:  ${s.recallAt5}%`);
    console.log('');
    console.log('🎯 PRECISION (какая доля найденного релевантна):');
    console.log(`  Precision: ${s.precision}%`);
    console.log('');
    console.log('⚡ PERFORMANCE:');
    console.log(`  Avg Response Time: ${s.avgResponseTime}ms`);
    console.log('='.repeat(70));
    console.log('');

    // Threshold check
    if (parseFloat(s.recallAt5) < 60) {
      console.log('⚠️  WARNING: Recall@5 is below 60% threshold!');
      console.log('   Consider: Adding more vectors, improving embeddings');
    } else {
      console.log('✅ Recall@5 meets 60% threshold');
    }
  }
}

// CLI
async function main() {
  const metrics = new MetricsSystem();
  const results = await metrics.runFullEvaluation();
  metrics.printReport();
  
  const filename = metrics.saveResults();
  console.log(`📁 Results saved: ${filename}\n`);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { MetricsSystem, TEST_DATASET };
