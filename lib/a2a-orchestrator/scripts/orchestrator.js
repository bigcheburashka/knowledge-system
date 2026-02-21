const { Agents } = require('../../a2a-agents/scripts/agents');
const { TaskMonitor } = require('./task-monitor');

/**
 * A2A Orchestrator v11 - Async Functions Architecture
 * No fork(), no processes - pure async/await
 */
class A2AOrchestrator {
  constructor(options = {}) {
    this.agents = new Agents(options.basePath);
    this.taskMonitor = new TaskMonitor();
    this.running = false;
    this.stats = {
      pipelinesCompleted: 0,
      pipelinesFailed: 0,
      totalDuration: 0
    };
  }

  /**
   * Initialize orchestrator
   */
  async init() {
    await this.agents.init();
    console.log('[Orchestrator] Initialized (async mode)');
  }

  /**
   * Execute pipeline with async agents
   */
  async executePipeline(task) {
    console.log('[Orchestrator] Starting pipeline execution');
    const startTime = Date.now();
    
    try {
      // Execute all 4 agents sequentially
      const result = await this.agents.executePipeline(task);
      
      const duration = Date.now() - startTime;
      this.stats.pipelinesCompleted++;
      this.stats.totalDuration += duration;
      
      console.log(`[Orchestrator] Pipeline complete in ${duration}ms`);
      return result;
      
    } catch (err) {
      const duration = Date.now() - startTime;
      this.stats.pipelinesFailed++;
      
      console.error(`[Orchestrator] Pipeline failed after ${duration}ms:`, err.message);
      throw err;
    }
  }

  /**
   * Execute single agent directly
   */
  async executeAgent(agentType, input) {
    console.log(`[Orchestrator] Executing ${agentType} agent`);
    
    switch (agentType) {
      case 'research':
        return await this.agents.researchAgent(input);
      case 'factcheck':
        return await this.agents.factCheckAgent(input);
      case 'quality':
        return await this.agents.qualityAgent(input);
      case 'composer':
        return await this.agents.composerAgent(input);
      default:
        throw new Error(`Unknown agent type: ${agentType}`);
    }
  }

  /**
   * Get orchestrator statistics
   */
  getStats() {
    const avgDuration = this.stats.pipelinesCompleted > 0 
      ? this.stats.totalDuration / this.stats.pipelinesCompleted 
      : 0;
    
    return {
      ...this.stats,
      averageDuration: Math.round(avgDuration),
      agentStats: this.agents.getStats()
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      pipelinesCompleted: 0,
      pipelinesFailed: 0,
      totalDuration: 0
    };
    this.agents.resetStats();
  }
}

module.exports = { A2AOrchestrator };

// CLI usage
if (require.main === module) {
  async function main() {
    const orchestrator = new A2AOrchestrator();
    await orchestrator.init();
    
    const task = { topic: 'AI Safety', query: 'current challenges' };
    const result = await orchestrator.executePipeline(task);
    
    console.log('\n=== Result ===');
    console.log('Success:', result.success);
    console.log('Duration:', result.duration, 'ms');
    console.log('Stats:', orchestrator.getStats());
    
    process.exit(result.success ? 0 : 1);
  }
  
  main().catch(console.error);
}
