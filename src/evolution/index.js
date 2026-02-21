/**
 * Self-Evolution System - Main orchestrator
 * Combines all components into unified system
 */

const { FileMessageQueue } = require('./queue/file-queue');
const { LearningLog } = require('./learning-log');
const { ApprovalManager } = require('./approval-manager');
const { PendingProposalsIndex } = require('./pending-index');
const { InputValidator } = require('./validation');
const { EvolutionMetrics } = require('./metrics');
const { AuditLogger } = require('./audit-logger');

class SelfEvolution {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge';
    
    // Core components
    this.queue = new FileMessageQueue({ 
      basePath: `${this.basePath}/queue`, 
      name: options.queueName || 'evolution' 
    });
    this.log = new LearningLog({ 
      basePath: `${this.basePath}/logs` 
    });
    this.approval = new ApprovalManager({ 
      basePath: `${this.basePath}/logs`,
      telegram: options.telegram 
    });
    this.pending = new PendingProposalsIndex({ 
      basePath: `${this.basePath}/logs` 
    });
    this.metrics = new EvolutionMetrics({ 
      basePath: `${this.basePath}/logs` 
    });
    this.audit = new AuditLogger({ 
      basePath: this.basePath 
    });
    
    this.config = options;
    this.isShuttingDown = false;
    
    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`[SelfEvolution] ${signal} received, shutting down gracefully...`);
      this.isShuttingDown = true;
      
      // Save metrics
      await this.metrics.save();
      
      // Close any open resources
      console.log('[SelfEvolution] Shutdown complete');
      process.exit(0);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  async init() {
    await this.queue.init();
    await this.log.init();
    await this.approval.init();
    await this.pending.init();
    await this.metrics.init();
    await this.audit.init();
    
    console.log('[SelfEvolution] System initialized');
    return this;
  }

  /**
   * Propose a system improvement with validation
   */
  async propose(improvement) {
    // Validate input
    const validation = InputValidator.validateProposal(improvement);
    if (!validation.valid) {
      throw new Error(`Invalid proposal: ${validation.errors.join(', ')}`);
    }
    
    // Sanitize input
    improvement.reason = InputValidator.sanitizeString(improvement.reason);
    
    if (this.isShuttingDown) {
      throw new Error('System is shutting down');
    }
    
    // Time the operation
    const result = await this.metrics.time('proposal_creation', async () => {
      return this.approval.proposeChange(improvement);
    });
    
    // Record metrics
    this.metrics.increment(`proposals_${result.level.toLowerCase()}`);
    this.metrics.increment('proposals_total');
    this.metrics.gauge('pending_proposals', (await this.pending.list({ status: 'pending' })).length);
    
    // Audit log proposal
    await this.audit.logProposal({
      id: result.id,
      level: result.level,
      type: improvement.type,
      change: improvement
    });
    
    await this.log.record({
      type: 'improvement_proposed',
      improvement: improvement.type,
      level: result.level,
      status: result.status,
      proposal: result.proposal?.id
    });
    
    return result;
  }

  /**
   * Approve a pending proposal
   */
  async approve(proposalId) {
    if (!InputValidator.isValidId(proposalId)) {
      throw new Error('Invalid proposal ID format');
    }
    
    const result = await this.metrics.time('approval_decision', async () => {
      return this.approval.approve(proposalId);
    });
    
    if (result) {
      this.metrics.increment('proposals_approved');
      this.metrics.gauge('pending_proposals', (await this.pending.list({ status: 'pending' })).length);
      
      // Audit log approval
      await this.audit.logApproval(proposalId, result.approver || 'system', result.level);
      
      await this.log.record({
        type: 'improvement_approved',
        proposal: proposalId,
        level: result.level
      });
    }
    
    return result;
  }

  /**
   * Reject a pending proposal
   */
  async reject(proposalId, reason = '') {
    if (!InputValidator.isValidId(proposalId)) {
      throw new Error('Invalid proposal ID format');
    }
    
    const result = await this.approval.reject(proposalId, InputValidator.sanitizeString(reason));
    
    if (result) {
      this.metrics.increment('proposals_rejected');
      this.metrics.gauge('pending_proposals', (await this.pending.list({ status: 'pending' })).length);
      
      // Audit log rejection
      await this.audit.logRejection(proposalId, reason, result.rejector || 'system');
      
      await this.log.record({
        type: 'improvement_rejected',
        proposal: proposalId,
        reason: InputValidator.sanitizeString(reason)
      });
    }
    
    return result;
  }

  /**
   * Get system status
   */
  async getStatus() {
    const pending = await this.pending.list();
    const recent = await this.log.getRecent(7);
    const metrics = this.metrics.getReport();
    
    return {
      pendingProposals: pending.length,
      pendingByLevel: {
        L1: pending.filter(p => p.level === 'L1').length,
        L2: pending.filter(p => p.level === 'L2').length,
        L3: pending.filter(p => p.level === 'L3').length,
        L4: pending.filter(p => p.level === 'L4').length
      },
      recentActivity: recent.length,
      queueLength: await this.queue.length(),
      metrics: metrics.summary,
      alerts: metrics.alerts
    };
  }

  /**
   * Run daily maintenance
   */
  async daily() {
    console.log('[SelfEvolution] Running daily maintenance...');
    
    // Reset daily counters
    this.metrics.counters.set('proposals_today', 0);
    
    // Cleanup old logs
    const cleanup = await this.log.cleanup(30);
    console.log(`[SelfEvolution] Cleaned ${cleanup.cleaned} old files`);
    
    // Retry failed notifications
    await this.approval.retryFailedTelegrams();
    
    // Get status
    const status = await this.getStatus();
    console.log('[SelfEvolution] Status:', status);
    
    // Check for alerts
    if (status.alerts.length > 0) {
      console.log('[SelfEvolution] Alerts:', status.alerts);
    }
    
    await this.log.record({
      type: 'daily_maintenance',
      cleaned: cleanup.cleaned,
      status
    });
    
    // Save metrics
    await this.metrics.save();
    
    return status;
  }

  /**
   * Get metrics report
   */
  getMetrics() {
    return this.metrics.getReport();
  }
}

module.exports = { 
  SelfEvolution, 
  FileMessageQueue, 
  LearningLog, 
  ApprovalManager, 
  PendingProposalsIndex,
  InputValidator,
  EvolutionMetrics
};
