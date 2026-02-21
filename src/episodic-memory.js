#!/usr/bin/env node
// Episodic Memory Service - Stores problem-solving traces

const fs = require('fs').promises;
const path = require('path');
const { getEmbedding } = require('./embedding-service');
const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = 'knowledge';
const EPISODIC_DIR = '/root/.openclaw/workspace/knowledge-state/episodic';

class EpisodicMemory {
  constructor() {
    this.traces = [];
  }

  async init() {
    await fs.mkdir(EPISODIC_DIR, { recursive: true });
    await this.loadTraces();
  }

  async loadTraces() {
    try {
      const files = await fs.readdir(EPISODIC_DIR);
      for (const file of files.filter(f => f.endsWith('.json'))) {
        const data = await fs.readFile(path.join(EPISODIC_DIR, file), 'utf-8');
        this.traces.push(JSON.parse(data));
      }
    } catch (e) {
      this.traces = [];
    }
  }

  // Record a problem-solving attempt
  async recordTrace({
    problem,
    attemptedSolution,
    outcome, // 'success' | 'failure' | 'partial'
    context,
    errorMessage = null,
    sessionId = null
  }) {
    const trace = {
      id: `trace_${Date.now()}`,
      timestamp: new Date().toISOString(),
      problem: problem.substring(0, 500),
      attemptedSolution: attemptedSolution.substring(0, 1000),
      outcome,
      context: context?.substring(0, 500),
      errorMessage: errorMessage?.substring(0, 500),
      sessionId,
      tags: this.extractTags(problem + ' ' + attemptedSolution)
    };

    // Store locally
    await fs.writeFile(
      path.join(EPISODIC_DIR, `${trace.id}.json`),
      JSON.stringify(trace, null, 2)
    );

    // Store in Qdrant for similarity search
    await this.storeInVectorDB(trace);

    this.traces.push(trace);
    
    console.log(`✅ Recorded trace: ${trace.id} (${outcome})`);
    return trace;
  }

  extractTags(text) {
    const keywords = [
      'error', 'bug', 'fix', 'crash', 'timeout', 'memory', 'database',
      'docker', 'nodejs', 'react', 'api', 'auth', 'deploy'
    ];
    
    const textLower = text.toLowerCase();
    return keywords.filter(k => textLower.includes(k));
  }

  async storeInVectorDB(trace) {
    try {
      const text = `Problem: ${trace.problem}. Solution: ${trace.attemptedSolution}. Outcome: ${trace.outcome}`;
      const embedding = await getEmbedding(text);
      
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/scroll`,
        { limit: 1, with_payload: false }
      );
      const maxId = response.data.result.points?.reduce((max, p) => Math.max(max, p.id), 0) || 0;
      
      await axios.put(
        `${QDRANT_URL}/collections/${COLLECTION}/points`,
        {
          points: [{
            id: maxId + 1,
            vector: embedding,
            payload: {
              name: `Trace: ${trace.problem.substring(0, 50)}...`,
              type: 'episodic_trace',
              traceId: trace.id,
              outcome: trace.outcome,
              text: trace.problem,
              solution: trace.attemptedSolution,
              timestamp: trace.timestamp,
              tags: trace.tags
            }
          }]
        }
      );
    } catch (e) {
      console.error('Failed to store in vector DB:', e.message);
    }
  }

  // Mark entity with success/failure
  async markEntity(entityName, outcome, details = '') {
    const marker = {
      entityName,
      outcome, // 'works' | 'failed' | 'deprecated'
      details,
      timestamp: new Date().toISOString()
    };

    await fs.writeFile(
      path.join(EPISODIC_DIR, `marker_${entityName.replace(/\W/g, '_')}.json`),
      JSON.stringify(marker, null, 2)
    );

    console.log(`🏷️  Marked "${entityName}" as: ${outcome}`);
    return marker;
  }

  // Find similar problems
  async findSimilarProblems(query, limit = 5) {
    try {
      const embedding = await getEmbedding(query);
      
      const response = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION}/points/search`,
        {
          vector: embedding,
          limit: limit * 2,
          with_payload: true,
          filter: {
            must: [
              { key: 'type', match: { value: 'episodic_trace' } }
            ]
          }
        }
      );
      
      const traces = response.data.result
        .filter(r => r.payload.type === 'episodic_trace')
        .slice(0, limit)
        .map(r => ({
          problem: r.payload.text,
          solution: r.payload.solution,
          outcome: r.payload.outcome,
          relevance: (r.score * 100).toFixed(1) + '%',
          timestamp: r.payload.timestamp
        }));
      
      return traces;
    } catch (e) {
      console.error('Similarity search error:', e.message);
      return [];
    }
  }

  // Get lessons learned
  async getLessonsLearned(tags = []) {
    const relevant = this.traces.filter(t => 
      tags.some(tag => t.tags.includes(tag))
    );
    
    const successes = relevant.filter(t => t.outcome === 'success');
    const failures = relevant.filter(t => t.outcome === 'failure');
    
    return {
      successes: successes.map(t => ({
        whatWorked: t.attemptedSolution,
        context: t.context
      })),
      failures: failures.map(t => ({
        whatFailed: t.attemptedSolution,
        error: t.errorMessage,
        lesson: `Avoid: ${t.attemptedSolution.substring(0, 100)}...`
      }))
    };
  }

  // Generate warning if similar problem failed before
  async checkForWarnings(problem) {
    const similar = await this.findSimilarProblems(problem, 3);
    const failures = similar.filter(s => s.outcome === 'failure');
    
    if (failures.length > 0) {
      return {
        warning: true,
        message: `⚠️  Similar problem failed ${failures.length} time(s) before`,
        previousAttempts: failures,
        suggestion: 'Consider alternative approach or review previous errors'
      };
    }
    
    return { warning: false };
  }
}

// CLI
if (require.main === module) {
  const episodic = new EpisodicMemory();
  const command = process.argv[2];
  
  episodic.init().then(async () => {
    switch (command) {
      case 'record':
        await episodic.recordTrace({
          problem: process.argv[3] || 'Unknown problem',
          attemptedSolution: process.argv[4] || 'No solution recorded',
          outcome: process.argv[5] || 'partial',
          context: 'CLI recording'
        });
        break;
        
      case 'mark':
        await episodic.markEntity(
          process.argv[3] || 'Unknown',
          process.argv[4] || 'works',
          process.argv[5] || ''
        );
        break;
        
      case 'similar':
        const similar = await episodic.findSimilarProblems(process.argv[3] || 'test');
        console.log('\nSimilar problems:');
        similar.forEach((s, i) => {
          console.log(`${i + 1}. [${s.outcome}] ${s.problem.substring(0, 80)}... (${s.relevance})`);
        });
        break;
        
      case 'check':
        const warning = await episodic.checkForWarnings(process.argv[3] || 'test problem');
        console.log(warning.warning ? warning.message : '✅ No warnings');
        break;
        
      default:
        console.log('Usage:');
        console.log('  episodic-memory.js record "problem" "solution" [success|failure|partial]');
        console.log('  episodic-memory.js mark "EntityName" [works|failed|deprecated] [details]');
        console.log('  episodic-memory.js similar "problem description"');
        console.log('  episodic-memory.js check "problem description"');
    }
  });
}

module.exports = EpisodicMemory;