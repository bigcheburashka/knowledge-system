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
    // Validate the change before creating proposal
    const validation = this.validateChange(change);
    if (!validation.valid) {
      console.log(`[ApprovalManager] Invalid proposal rejected: ${validation.reason}`);
      throw new Error(`Invalid proposal: ${validation.reason}`);
    }
    
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
  
  /**
   * Validate change before creating proposal
   */
  validateChange(change) {
    // Check for new_skill type
    if (change.type === 'new_skill' && change.skill) {
      const skillName = change.skill.name || '';
      const skillDesc = change.skill.description || '';
      const reason = change.reason || '';
      
      // 1. Check for empty or minimal names
      if (!skillName || skillName.length < 5) {
        return { valid: false, reason: 'skill_name_too_short' };
      }
      
      // 2. Check for markdown in name or description
      if (skillName.includes('**') || skillName.includes('##') || skillName.includes('`')) {
        return { valid: false, reason: 'skill_name_contains_markdown' };
      }
      
      // 3. Check if it's a garbage pattern (starts with prevent- and has no substance)
      if (skillName.match(/^prevent-?$/)) {
        return { valid: false, reason: 'invalid_skill_name_pattern' };
      }
      
      // 4. Check if description is just a message fragment
      if (skillDesc.match(/^[✅📊📝🔍🎯❌⚠️🎉🚀📈📉]/)) {
        return { valid: false, reason: 'description_starts_with_emoji' };
      }
      
      // 5. Check if reason contains too much markdown
      const markdownCount = (reason.match(/[\*#`]/g) || []).length;
      if (markdownCount > 5) {
        return { valid: false, reason: 'reason_contains_excessive_markdown' };
      }
      
      // 6. Check minimum reason length
      if (reason.length < 20) {
        return { valid: false, reason: 'reason_too_short' };
      }
    }
    
    return { valid: true };
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
    
    // Send Telegram notification with detailed context
    const telegramResult = await this.sendTelegramWithFallback(proposal);
    
    await this.log.record({
      type: 'l2_queued',
      proposal: proposal.id,
      skill: proposal.change.skill?.name,
      notified: telegramResult.sent,
      channel: telegramResult.channel
    });
    
    return { approved: false, level: 'L2', status: 'queued', proposal, notified: telegramResult.sent };
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
    const level = proposal.level;
    const change = proposal.change;
    
    // L2: New Skill - detailed format
    if (level === 'L2' && change.type === 'new_skill') {
      return this.formatL2NewSkillRequest(proposal);
    }
    
    // L3: Update - standard format
    if (level === 'L3') {
      return this.formatL3UpdateRequest(proposal);
    }
    
    // Default format for other types
    return `
📝 **Approval Request (L${level})**

Type: ${change.type}
${change.skill ? `Skill: ${change.skill.name}` : ''}
Reason: ${change.reason || 'No reason provided'}

✅ Approve: /approve ${proposal.id}
❌ Reject: /reject ${proposal.id} [reason]
    `.trim();
  }
  
  formatL2NewSkillRequest(proposal) {
    const change = proposal.change;
    const skill = change.skill || {};
    const patterns = change.patterns || [];
    
    let message = `📝 **Новый Skill требует approval (L2)**\n\n`;
    
    // What is being proposed
    message += `📋 **Что предлагается:**\n`;
    message += `Создать skill "${skill.name || 'Unknown'}"\n\n`;
    
    // Reason with context
    message += `🎯 **Причина:**\n`;
    if (change.reason) {
      message += `${change.reason}\n`;
    }
    if (patterns.length > 0) {
      message += `\nОбнаруженные паттерны:\n`;
      patterns.slice(0, 3).forEach(p => {
        message += `• ${p.description || p}\n`;
      });
      if (patterns.length > 3) {
        message += `• ... и ещё ${patterns.length - 3}\n`;
      }
    }
    message += `\n`;
    
    // Impact
    message += `📊 **Impact:**\n`;
    message += `• Предотвратит повторяющиеся ошибки\n`;
    message += `• Автоматическая помощь в сессиях\n`;
    message += `• Улучшение качества кода\n\n`;
    
    // What will be created
    const skillName = skill.name || 'unknown-skill';
    const skillSlug = skillName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    message += `📁 **Что будет создано:**\n`;
    message += `• lib/${skillSlug}/SKILL.md\n`;
    message += `• lib/${skillSlug}/scripts/${skillSlug}.js\n`;
    message += `• lib/${skillSlug}/scripts/${skillSlug}.test.js\n`;
    message += `• lib/${skillSlug}/package.json\n\n`;
    
    // Actions
    message += `✅ **Approve:** /approve ${proposal.id}\n`;
    message += `❌ **Reject:** /reject ${proposal.id} [причина]\n`;
    message += `📋 **Список всех:** /pending\n\n`;
    
    message += `_Proposal ID: \`${proposal.id}\`_`;
    
    return message;
  }
  
  formatL3UpdateRequest(proposal) {
    const change = proposal.change;
    
    let message = `📝 **Обновление требует approval (L3)**\n\n`;
    
    message += `📋 **Что обновляется:**\n`;
    message += `${change.skill?.name || 'Unknown skill'}\n\n`;
    
    message += `🎯 **Причина обновления:**\n`;
    message += `${change.reason || 'No reason provided'}\n\n`;
    
    if (change.updates) {
      message += `📊 **Изменения:**\n`;
      Object.entries(change.updates).forEach(([key, value]) => {
        message += `• ${key}: ${value}\n`;
      });
      message += `\n`;
    }
    
    message += `✅ **Approve:** /approve ${proposal.id}\n`;
    message += `❌ **Reject:** /reject ${proposal.id} [причина]\n\n`;
    message += `_Proposal ID: \`${proposal.id}\`_`;
    
    return message;
  }

  formatUrgentRequest(proposal) {
    const change = proposal.change;
    
    let message = `🚨 **СРОЧНО: Требуется approval (L4)**\n\n`;
    
    message += `⚠️ **Тип изменения:**\n`;
    message += `${change.type}\n\n`;
    
    message += `🎯 **Причина:**\n`;
    message += `${change.reason || 'No reason provided'}\n\n`;
    
    message += `⚡ **Важность:**\n`;
    message += `Это изменение самой системы (self-modification).\n`;
    message += `Без approval система будет заблокирована.\n\n`;
    
    message += `✅ **Approve:** /approve ${proposal.id}\n`;
    message += `❌ **Reject:** /reject ${proposal.id} [причина]\n\n`;
    
    message += `_Proposal ID: \`${proposal.id}\`_`;
    
    return message;
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
