/**
 * Self-Evolution System
 * Final integration of all components
 */

const { A2AOrchestrator } = require('../skills/a2a-orchestrator/scripts/orchestrator');
const { CheckpointStore } = require('../skills/graph-schema/scripts/checkpoint-store');
const { SelfHealingController } = require('../skills/self-healing/scripts/controller');
const { PatternDetector } = require('../skills/pattern-detector/scripts/detector');
const { MetaCognition } = require('../skills/meta-cognition/scripts/metacog');
const { SkillChallenger } = require('../skills/skill-challenger/scripts/challenger');
const { AdaptiveRAG } = require('../skills/adaptive-rag/scripts/adaptive-rag');
const { TelegramBridge } = require('../skills/telegram-bridge/scripts/bridge');

class SelfEvolutionSystem {
  constructor(options = {}) {
    this.basePath = options.basePath || '/tmp/self-evolution';
    
    // Core components
    this.orchestrator = new A2AOrchestrator({ basePath: this.basePath });
    this.checkpoints = new CheckpointStore({ checkpointPath: `${this.basePath}/checkpoints` });
    this.healing = new SelfHealingController({ checkpointStore: this.checkpoints });
    
    // Meta components
    this.patterns = new PatternDetector();
    this.meta = new MetaCognition();
    this.challenger = new SkillChallenger();
    
    // External components
    this.rag = new AdaptiveRAG(options.rag);
    this.telegram = new TelegramBridge(options.telegram);
    
    // State
    this.running = false;
    this.config = options;
  }

  async init() {
    await this.orchestrator.init();
    await this.checkpoints.init();
    console.log('[SelfEvolution] System initialized');
  }

  /**
   * Process a task with full self-evolution capabilities
   */
  async processTask(task) {
    const startTime = Date.now();
    let checkpointId = null;
    
    try {
      // Create checkpoint
      checkpointId = await this.checkpoints.save({
        status: 'running',
        agent: task.agent || 'pipeline',
        data: task
      });
      
      // Execute with orchestrator
      const result = await this.orchestrator.executePipeline(task);
      
      // Record success
      this.meta.recordAgentPerformance(
        task.agent || 'pipeline',
        task,
        { success: true, duration: Date.now() - startTime }
      );
      
      // Update checkpoint
      await this.checkpoints.save({
        id: checkpointId,
        status: 'completed',
        result,
        completedAt: Date.now()
      });
      
      return { success: true, result, checkpointId };
      
    } catch (error) {
      // Record failure
      this.meta.recordAgentPerformance(
        task.agent || 'pipeline',
        task,
        { success: false, duration: Date.now() - startTime }
      );
      
      // Attempt self-healing
      const recovery = await this.healing.handleFailure(checkpointId, error, task);
      
      // Notify if escalated
      if (recovery.action === 'ESCALATE') {
        await this.telegram.sendEscalation(
          await this.checkpoints.load(checkpointId),
          error
        );
      }
      
      return { success: false, error, recovery, checkpointId };
    }
  }

  /**
   * Run system analysis and generate improvements
   */
  async analyzeAndImprove() {
    console.log('[SelfEvolution] Running analysis...');
    
    // Get all checkpoints
    const checkpoints = await this.checkpoints.list();
    
    // Detect patterns
    const logs = checkpoints.map(cp => ({
      level: cp.status === 'completed' ? 'info' : 'error',
      message: cp.lastError || 'success',
      duration: cp.completedAt ? cp.completedAt - cp.savedAt : 0
    }));
    
    const patterns = await this.patterns.analyze(logs);
    
    // Get meta insights
    const health = this.meta.getHealthSummary();
    const suggestions = this.meta.generateSuggestions();
    
    // Challenge skills
    const skillReports = this.challenger.getAllReports();
    
    // Send health report
    await this.telegram.sendHealthReport(health);
    
    // Alert on patterns
    for (const pattern of patterns.errors.filter(p => p.severity === 'high')) {
      await this.telegram.sendPatternAlert({
        type: 'error_pattern',
        ...pattern
      });
    }
    
    return {
      patterns,
      health,
      suggestions,
      skillReports
    };
  }

  /**
   * Start continuous improvement loop
   */
  async start() {
    this.running = true;
    console.log('[SelfEvolution] System running');
    
    while (this.running) {
      try {
        await this.analyzeAndImprove();
        
        // Wait before next cycle
        await this.sleep(this.config.cycleInterval || 3600000); // 1 hour default
      } catch (err) {
        console.error('[SelfEvolution] Cycle error:', err.message);
        await this.sleep(60000); // 1 min on error
      }
    }
  }

  /**
   * Stop the system
   */
  stop() {
    this.running = false;
    console.log('[SelfEvolution] Stopping...');
  }

  /**
   * Get system status
   */
  async getStatus() {
    const checkpoints = await this.checkpoints.list();
    const health = this.meta.getHealthSummary();
    
    return {
      running: this.running,
      totalCheckpoints: checkpoints.length,
      health,
      telegramConfigured: this.telegram.isConfigured()
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { SelfEvolutionSystem };

// CLI
if (require.main === module) {
  async function main() {
    const system = new SelfEvolutionSystem();
    await system.init();
    
    // Run quick test
    console.log('\n=== Self-Evolution System Test ===\n');
    
    const result = await system.processTask({
      topic: 'Test',
      query: 'self-evolution test'
    });
    
    console.log('Task result:', result.success ? 'SUCCESS' : 'FAILED');
    
    const status = await system.getStatus();
    console.log('System status:', status);
    
    console.log('\n=== Test Complete ✅ ===');
  }
  
  main().catch(console.error);
}
