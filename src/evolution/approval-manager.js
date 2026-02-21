/**
 * ApprovalManager - L1-L4 approval system with Telegram integration
 */

const { LearningLog } = require('./learning-log');
const { FileMessageQueue } = require('./queue/file-queue');
const { PendingProposalsIndex } = require('./pending-index');
const { ChangeApplier } = require('./change-applier');
const fs = require('fs').promises;
const path = require('path');

class ApprovalManager {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge/logs';
    this.log = new LearningLog(options);
    this.queue = new FileMessageQueue({ ...options, name: 'approval-queue' });
    this.pending = new PendingProposalsIndex(options);
    this.applier = new ChangeApplier(options);  // NEW
    this.telegram = options.telegram;
  }

  async init() {
    await this.log.init();
    await this.queue.init();
    await this.pending.init();
    await this.applier.init();  // NEW
  }

  async proposeChange(change) {
    const level = this.determineLevel(change);
    
    const proposal = {
      id: `prop-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: change.type,
      level,
      change,
      proposedAt: new Date().toISOString(),
      status: 'pending'
    };
    
    // Add to pending index (O(1) lookup)
    await this.pending.add(proposal);
    
    // L1: Auto-apply low-impact config changes
    if (level === 'L1') {
      return this.handleL1(proposal);
    }
    
    // L2: Queue for batch review
    if (level === 'L2') {
      return this.handleL2(proposal);
    }
    
    // L3: Telegram notification required
    if (level === 'L3') {
      return this.handleL3(proposal);
    }
    
    // L4: Block until approved
    if (level === 'L4') {
      return this.handleL4(proposal);
    }
  }

  async handleL1(proposal) {
    try {
      await this.applyChange(proposal);
      proposal.status = 'applied';
      proposal.appliedAt = new Date().toISOString();
      
      await this.pending.update(proposal.id, { status: 'applied' });
      await this.log.record({
        type: 'l1_applied',
        proposal: proposal.id,
        change: proposal.change.type
      });
      
      return { approved: true, level: 'L1', proposal };
    } catch (err) {
      proposal.status = 'failed';
      await this.pending.update(proposal.id, { status: 'failed', error: err.message });
      throw err;
    }
  }

  async handleL2(proposal) {
    await this.queue.push(proposal);
    
    await this.log.record({
      type: 'l2_queued',
      proposal: proposal.id,
      skill: proposal.change.skill?.name
    });
    
    return { approved: false, level: 'L2', status: 'queued', proposal };
  }

  async handleL3(proposal) {
    await this.queue.push(proposal);
    
    // Try Telegram with fallback
    const telegramResult = await this.sendTelegramWithFallback(proposal);
    
    await this.log.record({
      type: 'l3_pending',
      proposal: proposal.id,
      notified: telegramResult.sent,
      channel: telegramResult.channel
    });
    
    return { approved: false, level: 'L3', status: 'pending_approval', proposal };
  }

  async handleL4(proposal) {
    await this.queue.push(proposal);
    
    // Try Telegram with fallback
    const telegramResult = await this.sendTelegramWithFallback(proposal, true);
    
    await this.log.record({
      type: 'l4_blocked',
      proposal: proposal.id,
      notified: telegramResult.sent,
      requires: 'immediate_approval'
    });
    
    // BLOCK until approved
    const result = await this.waitForApproval(proposal.id, {
      timeout: 7 * 24 * 60 * 60 * 1000, // 7 days
      pollInterval: 60000 // Check every minute
    });
    
    if (!result.approved) {
      throw new Error(`L4 proposal ${proposal.id} ${result.reason}`);
    }
    
    return { approved: true, level: 'L4', proposal };
  }

  determineLevel(change) {
    // L1: Config changes with low impact (< 10%)
    if (change.type === 'config' && change.impactScore < 0.1) {
      return 'L1';
    }
    
    // L2: New skills
    if (change.type === 'new_skill') {
      return 'L2';
    }
    
    // L3: Updates to existing
    if (change.type === 'update') {
      return 'L3';
    }
    
    // L4: Self-modification
    if (change.type === 'self_modification') {
      return 'L4';
    }
    
    return 'L3'; // Default
  }

  async applyChange(proposal) {
    console.log(`[ApprovalManager] Applying ${proposal.change.type}:`, proposal.id);
    
    // Use ChangeApplier for actual implementation
    return this.applier.apply(proposal);
  }

  async sendTelegramWithFallback(proposal, isUrgent = false) {
    const text = isUrgent 
      ? this.formatUrgentRequest(proposal)
      : this.formatApprovalRequest(proposal);
    
    // Try Telegram with timeout
    if (this.telegram) {
      try {
        const timeout = 10000; // 10 seconds
        const result = await Promise.race([
          this.telegram.sendMessage({ text }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Telegram timeout')), timeout)
          )
        ]);
        
        return { sent: true, channel: 'telegram', messageId: result.messageId };
      } catch (err) {
        // Fall through to file fallback
      }
    }
    
    // Fallback: write to file
    await this.fallbackToFile(proposal, text);
    return { sent: true, channel: 'file' };
  }

  formatApprovalRequest(proposal) {
    return `
📝 **Approval Request (L${proposal.level})**

Type: ${proposal.change.type}
${proposal.change.skill ? `Skill: ${proposal.change.skill.name}` : ''}
Reason: ${proposal.change.reason}

[Approve] [Reject] [Modify]
    `.trim();
  }

  formatUrgentRequest(proposal) {
    return `
🚨 **URGENT Approval Required (L4)**

Type: ${proposal.change.type}
This is a self-modification that requires immediate approval.

[Approve Required] [Reject]
    `.trim();
  }

  async fallbackToFile(proposal, text) {
    const fallbackPath = path.join(this.basePath, 'urgent-approvals.jsonl');
    const entry = {
      timestamp: new Date().toISOString(),
      proposal: proposal.id,
      level: proposal.level,
      text,
      telegramFailed: true
    };
    
    await fs.appendFile(fallbackPath, JSON.stringify(entry) + '\n');
    console.error(`[ApprovalManager] URGENT: Check ${fallbackPath} for ${proposal.id}`);
  }

  async waitForApproval(proposalId, options = {}) {
    const { timeout = 86400000, pollInterval = 60000 } = options;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const proposal = await this.pending.get(proposalId);
      
      if (!proposal) {
        return { approved: false, reason: 'proposal_not_found' };
      }
      
      if (proposal.status === 'approved') {
        return { approved: true, proposal };
      }
      
      if (proposal.status === 'rejected') {
        return { approved: false, reason: 'rejected', proposal };
      }
      
      if (proposal.status === 'timeout') {
        return { approved: false, reason: 'timeout' };
      }
      
      // Still pending — wait
      await this.sleep(pollInterval);
    }
    
    // Timeout reached
    await this.pending.update(proposalId, { 
      status: 'timeout',
      timeoutAt: new Date().toISOString()
    });
    
    return { approved: false, reason: 'timeout' };
  }

  async approve(proposalId) {
    const proposal = await this.pending.get(proposalId);
    if (!proposal) return null;
    
    proposal.status = 'approved';
    proposal.approvedAt = new Date().toISOString();
    
    await this.applyChange(proposal);
    await this.pending.update(proposalId, { 
      status: 'approved',
      approvedAt: proposal.approvedAt
    });
    
    await this.log.record({
      type: 'approved',
      proposal: proposalId,
      level: proposal.level
    });
    
    // Cleanup after 24 hours
    setTimeout(() => this.pending.remove(proposalId), 86400000);
    
    return proposal;
  }

  async reject(proposalId, reason = '') {
    const proposal = await this.pending.get(proposalId);
    if (!proposal) return null;
    
    proposal.status = 'rejected';
    proposal.rejectedAt = new Date().toISOString();
    proposal.rejectionReason = reason;
    
    await this.pending.update(proposalId, {
      status: 'rejected',
      rejectedAt: proposal.rejectedAt,
      rejectionReason: reason
    });
    
    await this.log.record({
      type: 'rejected',
      proposal: proposalId,
      level: proposal.level,
      reason
    });
    
    return proposal;
  }

  async retryFailedTelegrams() {
    const fallbackPath = path.join(this.basePath, 'urgent-approvals.jsonl');
    
    try {
      const content = await fs.readFile(fallbackPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      
      const remaining = [];
      
      for (const line of lines) {
        const entry = JSON.parse(line);
        
        // Skip if older than 7 days
        if (Date.now() - new Date(entry.timestamp) > 7 * 86400000) {
          continue;
        }
        
        const proposal = await this.pending.get(entry.proposal);
        if (proposal && proposal.status === 'pending' && this.telegram) {
          try {
            await this.telegram.sendMessage({ text: entry.text });
            continue; // Success, don't add to remaining
          } catch {}
        }
        
        remaining.push(line);
      }
      
      await fs.writeFile(
        fallbackPath, 
        remaining.join('\n') + (remaining.length ? '\n' : '')
      );
      
    } catch {
      // File doesn't exist or empty
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { ApprovalManager };
