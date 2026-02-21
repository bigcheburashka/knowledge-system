/**
 * Telegram Bot for Self-Evolution Approval System
 * Responds only to authorized user (ID: 908231)
 */

const { SelfEvolution } = require('./index');

class EvolutionTelegramBot {
  constructor(options = {}) {
    this.token = options.token || process.env.EVOLUTION_BOT_TOKEN;
    this.authorizedUserId = options.authorizedUserId || '908231';
    this.basePath = options.basePath || '/var/lib/knowledge';
    this.evolution = null;
    this.bot = null;
  }

  async init() {
    // Initialize evolution system
    this.evolution = new SelfEvolution({ basePath: this.basePath });
    await this.evolution.init();
    
    // Initialize Telegram bot
    if (!this.token) {
      console.error('[EvolutionBot] No token provided');
      return false;
    }
    
    try {
      const { Telegraf } = require('telegraf');
      this.bot = new Telegraf(this.token);
      this.setupHandlers();
      
      console.log('[EvolutionBot] Initialized');
      return true;
    } catch (err) {
      console.error('[EvolutionBot] Failed to initialize:', err.message);
      return false;
    }
  }

  setupHandlers() {
    // Authorization middleware
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id?.toString();
      
      if (userId !== this.authorizedUserId) {
        console.warn(`[EvolutionBot] Unauthorized access attempt from: ${userId}`);
        await ctx.reply('⛔ Unauthorized. This bot is private.');
        return;
      }
      
      await next();
    });

    // Start command
    this.bot.command('start', async (ctx) => {
      await ctx.reply(
        '🤖 *Self-Evolution System*\n\n' +
        'Available commands:\n' +
        '/pending — List pending proposals\n' +
        '/approve \u003cid\u003e — Approve a proposal\n' +
        '/reject \u003cid\u003e [reason] — Reject a proposal\n' +
        '/status — System status\n' +
        '/metrics — Show metrics',
        { parse_mode: 'Markdown' }
      );
    });

    // List pending proposals
    this.bot.command('pending', async (ctx) => {
      try {
        const pending = await this.evolution.pending.list({ status: 'pending' });
        
        if (pending.length === 0) {
          await ctx.reply('✅ No pending proposals');
          return;
        }
        
        let message = '📋 *Pending Proposals*\n\n';
        for (const p of pending.slice(0, 10)) {
          // Safely extract and encode text
          const id = p.id || 'unknown';
          const level = p.level || 'N/A';
          const type = p.type || 'unknown';
          let reason = 'N/A';
          
          if (p.change?.reason) {
            // Sanitize reason: remove newlines, limit length, ensure UTF-8
            reason = String(p.change.reason)
              .replace(/[\n\r]/g, ' ')
              .substring(0, 50);
          }
          
          message += `*${id}*\n`;
          message += `Level: ${level} | Type: ${type}\n`;
          message += `Reason: ${reason}...\n\n`;
        }
        
        if (pending.length > 10) {
          message += `... and ${pending.length - 10} more`;
        }
        
        // Ensure message is valid UTF-8
        message = Buffer.from(message).toString('utf8');
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error('[EvolutionBot] /pending error:', err);
        await ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    // Approve proposal
    this.bot.command('approve', async (ctx) => {
      const proposalId = ctx.message.text.split(' ')[1];
      
      if (!proposalId) {
        await ctx.reply('❌ Usage: /approve \u003cproposal_id\u003e');
        return;
      }
      
      try {
        const result = await ctx.reply('⏳ Approving...');
        const approved = await this.evolution.approve(proposalId);
        
        if (approved) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            result.message_id,
            null,
            `✅ *Approved*\n\nID: \`${proposalId}\`\nType: ${approved.type}\nLevel: ${approved.level}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            result.message_id,
            null,
            `❌ Proposal not found: \`${proposalId}\``,
            { parse_mode: 'Markdown' }
          );
        }
      } catch (err) {
        await ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    // Reject proposal
    this.bot.command('reject', async (ctx) => {
      const parts = ctx.message.text.split(' ');
      const proposalId = parts[1];
      const reason = parts.slice(2).join(' ') || 'No reason provided';
      
      if (!proposalId) {
        await ctx.reply('❌ Usage: /reject \u003cproposal_id\u003e [reason]');
        return;
      }
      
      try {
        const rejected = await this.evolution.reject(proposalId, reason);
        
        if (rejected) {
          await ctx.reply(
            `❌ *Rejected*\n\nID: \`${proposalId}\`\nReason: ${reason}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.reply(`❌ Proposal not found: \`${proposalId}\``);
        }
      } catch (err) {
        await ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    // Status command
    this.bot.command('status', async (ctx) => {
      try {
        const status = await this.evolution.getStatus();
        
        const message = 
          '📊 *System Status*\n\n' +
          `Pending: ${status.pendingProposals}\n` +
          `  - L1: ${status.pendingByLevel.L1}\n` +
          `  - L2: ${status.pendingByLevel.L2}\n` +
          `  - L3: ${status.pendingByLevel.L3}\n` +
          `  - L4: ${status.pendingByLevel.L4}\n\n` +
          `Recent (7d): ${status.recentActivity}\n` +
          `Queue: ${status.queueLength}\n\n` +
          `Approved: ${status.metrics.approvedTotal}\n` +
          `Rejected: ${status.metrics.rejectedTotal}`;
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
      } catch (err) {
        await ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    // Metrics command
    this.bot.command('metrics', async (ctx) => {
      try {
        const report = this.evolution.getMetrics();
        
        let message = '📈 *Metrics*\n\n';
        message += `*Today:* ${report.summary.proposalsToday} proposals\n`;
        message += `*Total:* ${report.summary.approvedTotal} approved\n`;
        message += `*Rejected:* ${report.summary.rejectedTotal}\n\n`;
        
        if (report.alerts.length > 0) {
          message += '*⚠️ Alerts:*\n';
          for (const alert of report.alerts) {
            message += `- ${alert.message}\n`;
          }
        } else {
          message += '✅ No alerts';
        }
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
      } catch (err) {
        await ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    // Handle inline buttons for approvals
    this.bot.action(/approve:(.+)/, async (ctx) => {
      const proposalId = ctx.match[1];
      
      try {
        const approved = await this.evolution.approve(proposalId);
        
        if (approved) {
          await ctx.editMessageText(
            `✅ *Approved*\n\nID: \`${proposalId}\`\nType: ${approved.type}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          await ctx.answerCbQuery('Proposal not found');
        }
      } catch (err) {
        await ctx.answerCbQuery(`Error: ${err.message}`);
      }
    });

    this.bot.action(/reject:(.+)/, async (ctx) => {
      const proposalId = ctx.match[1];
      
      try {
        await this.evolution.reject(proposalId, 'Rejected via Telegram');
        await ctx.editMessageText(
          `❌ *Rejected*\n\nID: \`${proposalId}\``,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        await ctx.answerCbQuery(`Error: ${err.message}`);
      }
    });

    // Error handling
    this.bot.catch((err, ctx) => {
      console.error('[EvolutionBot] Error:', err);
      ctx.reply('❌ An error occurred').catch(() => {});
    });
  }

  async start() {
    if (!this.bot) {
      console.error('[EvolutionBot] Bot not initialized');
      return;
    }
    
    console.log('[EvolutionBot] Starting...');
    
    // Use webhook or polling
    if (process.env.WEBHOOK_URL) {
      await this.bot.launch({
        webhook: {
          domain: process.env.WEBHOOK_URL,
          port: process.env.WEBHOOK_PORT || 3001
        }
      });
    } else {
      await this.bot.launch();
    }
    
    console.log('[EvolutionBot] Running');
    
    // Graceful stop
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }

  async sendApprovalRequest(proposal) {
    if (!this.bot) return { sent: false, error: 'Bot not initialized' };
    
    try {
      const text = this.formatApprovalMessage(proposal);
      
      const result = await this.bot.telegram.sendMessage(
        this.authorizedUserId,
        text,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve', callback_data: `approve:${proposal.id}` },
                { text: '❌ Reject', callback_data: `reject:${proposal.id}` }
              ]
            ]
          }
        }
      );
      
      return { sent: true, messageId: result.message_id };
    } catch (err) {
      console.error('[EvolutionBot] Failed to send:', err.message);
      return { sent: false, error: err.message };
    }
  }

  formatApprovalMessage(proposal) {
    const urgency = proposal.level === 'L4' ? '🚨' : '📝';
    
    return (
      `${urgency} *Approval Request (L${proposal.level})*\n\n` +
      `ID: \`${proposal.id}\`\n` +
      `Type: ${proposal.type}\n` +
      `Proposed: ${new Date(proposal.proposedAt).toLocaleString()}\n\n` +
      `*Reason:*\n${proposal.change?.reason || 'No reason provided'}`
    );
  }
}

// CLI usage
if (require.main === module) {
  const bot = new EvolutionTelegramBot({
    token: process.env.EVOLUTION_BOT_TOKEN,
    authorizedUserId: process.env.AUTHORIZED_USER_ID || '908231'
  });
  
  bot.init().then(success => {
    if (success) {
      bot.start();
    } else {
      console.error('Failed to start bot');
      process.exit(1);
    }
  });
}

module.exports = { EvolutionTelegramBot };
