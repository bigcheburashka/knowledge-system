const { FileQueue } = require('../../a2a-file-queue/scripts/file-queue');

/**
 * A2A Async Agents - Four sequential agent functions
 * No fork(), no subagents - pure async/await
 */
class Agents {
  constructor(basePath = '/knowledge-system/queues') {
    this.queues = {
      research: new FileQueue('research', basePath),
      factcheck: new FileQueue('factcheck', basePath),
      quality: new FileQueue('quality', basePath),
      composer: new FileQueue('composer', basePath)
    };
    this.stats = {
      research: { runs: 0, errors: 0 },
      factcheck: { runs: 0, errors: 0 },
      quality: { runs: 0, errors: 0 },
      composer: { runs: 0, errors: 0 }
    };
  }

  /**
   * Initialize all queues
   */
  async init() {
    for (const queue of Object.values(this.queues)) {
      await queue.init();
    }
  }

  /**
   * Research Agent - Step 1
   * @param {Object} task - Direct input or null (reads from queue)
   * @returns {Object} Research result
   */
  async researchAgent(task = null) {
    const input = task || await this.queues.research.pop();
    if (!input) {
      throw new Error('ResearchAgent: No input provided or in queue');
    }

    console.log('[Research] Processing:', input.data?.topic || input.topic);
    this.stats.research.runs++;

    try {
      // Simulate research work
      const result = await this.simulateResearch(input.data || input);
      
      // Log to decision graph
      await this.logDecision('research', 'completed', {
        input: input.data?.topic,
        sources: result.sources,
        confidence: result.confidence
      });

      // Send to next agent
      await this.queues.factcheck.push({
        type: 'RESEARCH_RESULT',
        data: result,
        from: 'research',
        timestamp: Date.now()
      });

      console.log('[Research] Complete:', result.sources, 'sources');
      return result;

    } catch (err) {
      this.stats.research.errors++;
      console.error('[Research] Error:', err.message);
      throw err;
    }
  }

  /**
   * FactCheck Agent - Step 2
   * @param {Object} input - Direct input or null (reads from queue)
   * @returns {Object} Verified result
   */
  async factCheckAgent(input = null) {
    const task = input || await this.queues.factcheck.pop();
    if (!task) {
      throw new Error('FactCheckAgent: No input provided or in queue');
    }

    console.log('[FactCheck] Verifying:', task.data?.topic || 'unknown');
    this.stats.factcheck.runs++;

    try {
      // Simulate fact checking
      const verified = await this.simulateFactCheck(task.data);
      
      await this.logDecision('factcheck', 'completed', {
        accuracy: verified.accuracy,
        claims_verified: verified.claimsVerified
      });

      await this.queues.quality.push({
        type: 'FACTCHECK_RESULT',
        data: verified,
        from: 'factcheck',
        timestamp: Date.now()
      });

      console.log('[FactCheck] Complete: accuracy', verified.accuracy);
      return verified;

    } catch (err) {
      this.stats.factcheck.errors++;
      console.error('[FactCheck] Error:', err.message);
      throw err;
    }
  }

  /**
   * Quality Agent - Step 3
   * @param {Object} input - Direct input or null (reads from queue)
   * @returns {Object} Reviewed result
   */
  async qualityAgent(input = null) {
    const task = input || await this.queues.quality.pop();
    if (!task) {
      throw new Error('QualityAgent: No input provided or in queue');
    }

    console.log('[Quality] Reviewing:', task.data?.topic || 'unknown');
    this.stats.quality.runs++;

    try {
      // Simulate quality review
      const reviewed = await this.simulateQualityCheck(task.data);
      
      await this.logDecision('quality', 'completed', {
        score: reviewed.score,
        issues: reviewed.issues
      });

      await this.queues.composer.push({
        type: 'QUALITY_RESULT',
        data: reviewed,
        from: 'quality',
        timestamp: Date.now()
      });

      console.log('[Quality] Complete: score', reviewed.score);
      return reviewed;

    } catch (err) {
      this.stats.quality.errors++;
      console.error('[Quality] Error:', err.message);
      throw err;
    }
  }

  /**
   * Composer Agent - Step 4 (Final)
   * @param {Object} input - Direct input or null (reads from queue)
   * @returns {Object} Final output
   */
  async composerAgent(input = null) {
    const task = input || await this.queues.composer.pop();
    if (!task) {
      throw new Error('ComposerAgent: No input provided or in queue');
    }

    console.log('[Composer] Finalizing:', task.data?.topic || 'unknown');
    this.stats.composer.runs++;

    try {
      // Simulate composition
      const final = await this.simulateComposition(task.data);
      
      await this.logDecision('composer', 'completed', {
        output_length: final.output?.length,
        final_score: final.score
      });

      console.log('[Composer] Pipeline complete!');
      console.log('[Composer] Final output:', final.output?.substring(0, 100) + '...');
      
      return final;

    } catch (err) {
      this.stats.composer.errors++;
      console.error('[Composer] Error:', err.message);
      throw err;
    }
  }

  /**
   * Execute full pipeline
   * @param {Object} task - Initial task
   * @returns {Object} Final result
   */
  async executePipeline(task) {
    console.log('[Pipeline] Starting execution');
    const startTime = Date.now();

    try {
      // Sequential execution
      const research = await this.researchAgent(task);
      const factcheck = await this.factCheckAgent();
      const quality = await this.qualityAgent();
      const final = await this.composerAgent();

      const duration = Date.now() - startTime;
      console.log(`[Pipeline] Complete in ${duration}ms`);

      return {
        success: true,
        duration,
        output: final,
        stats: this.stats
      };

    } catch (err) {
      const duration = Date.now() - startTime;
      console.error(`[Pipeline] Failed after ${duration}ms:`, err.message);
      
      return {
        success: false,
        duration,
        error: err.message,
        stats: this.stats
      };
    }
  }

  /**
   * Log decision to graph (placeholder for memgraph integration)
   */
  async logDecision(agent, action, details) {
    // TODO: Integrate with Memgraph Log Layer (Week 2)
    console.log(`[Log] ${agent}: ${action}`, JSON.stringify(details));
  }

  // Simulation methods (replace with real implementations)
  
  async simulateResearch(data) {
    await this.sleep(1000 + Math.random() * 500);
    return {
      ...data,
      researched: true,
      sources: Math.floor(Math.random() * 5) + 3,
      confidence: 0.85 + Math.random() * 0.1,
      findings: ['finding 1', 'finding 2', 'finding 3']
    };
  }

  async simulateFactCheck(data) {
    await this.sleep(800 + Math.random() * 400);
    return {
      ...data,
      verified: true,
      accuracy: 0.9 + Math.random() * 0.08,
      claimsVerified: Math.floor(Math.random() * 10) + 5,
      issues: []
    };
  }

  async simulateQualityCheck(data) {
    await this.sleep(600 + Math.random() * 300);
    const score = Math.floor(Math.random() * 3) + 7; // 7-10
    return {
      ...data,
      reviewed: true,
      score,
      issues: score < 9 ? ['minor improvement needed'] : [],
      approved: score >= 8
    };
  }

  async simulateComposition(data) {
    await this.sleep(500 + Math.random() * 300);
    return {
      ...data,
      final: true,
      output: `Final result for: ${data.topic || 'task'}`,
      score: data.score || 9,
      completed: new Date().toISOString()
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get agent statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      research: { runs: 0, errors: 0 },
      factcheck: { runs: 0, errors: 0 },
      quality: { runs: 0, errors: 0 },
      composer: { runs: 0, errors: 0 }
    };
  }
}

module.exports = { Agents };

// CLI usage
if (require.main === module) {
  async function main() {
    const agents = new Agents('/tmp/test-agents');
    await agents.init();

    // Test: Execute full pipeline
    const task = { topic: 'AI Safety', query: 'current challenges' };
    const result = await agents.executePipeline(task);

    console.log('\n=== Result ===');
    console.log('Success:', result.success);
    console.log('Duration:', result.duration, 'ms');
    console.log('Stats:', result.stats);

    process.exit(result.success ? 0 : 1);
  }

  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
