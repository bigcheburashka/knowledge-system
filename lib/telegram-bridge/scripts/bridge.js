/**
 * Telegram Bridge
 * Notification system for Self-Evolution
 */

class TelegramBridge {
  constructor(options = {}) {
    this.botToken = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
    this.chatId = options.chatId || process.env.TELEGRAM_CHAT_ID;
    this.enabled = !!(this.botToken && this.chatId);
  }

  /**
   * Send escalation notification
   */
  async sendEscalation(checkpoint, error) {
    const message = `
🚨 **ESCALATION**

Checkpoint: ${checkpoint.id}
Agent: ${checkpoint.agent}
Status: ${checkpoint.status}

Error: ${error.message}

Retries: ${checkpoint.retryCount}
    `.trim();
    
    return this.sendMessage(message);
  }

  /**
   * Send learning completion notification
   */
  async sendLearningComplete(topic, stats) {
    const message = `
📚 **Learning Complete**

Topic: ${topic}
Duration: ${stats.duration}ms
Sources: ${stats.sources}

Quality Score: ${stats.qualityScore}/10
    `.trim();
    
    return this.sendMessage(message);
  }

  /**
   * Send pattern alert
   */
  async sendPatternAlert(pattern) {
    const message = `
🔍 **Pattern Detected**

Type: ${pattern.type}
Occurrences: ${pattern.count}
Severity: ${pattern.severity}

${pattern.error || pattern.topic}
    `.trim();
    
    return this.sendMessage(message);
  }

  /**
   * Send system health report
   */
  async sendHealthReport(health) {
    const message = `
📊 **System Health**

Success Rate: ${(health.overallSuccessRate * 100).toFixed(1)}%
Active Agents: ${health.activeAgents}
Total Tasks: ${health.totalTasks}

Suggestions: ${health.suggestions}
    `.trim();
    
    return this.sendMessage(message);
  }

  /**
   * Send generic message
   */
  async sendMessage(text) {
    if (!this.enabled) {
      console.log('[TelegramBridge] Would send:', text.substring(0, 100) + '...');
      return { ok: true, simulated: true };
    }
    
    // In production, would call Telegram API
    // For now, log and return
    console.log('[TelegramBridge] Sending notification...');
    return { ok: true, sent: true };
  }

  /**
   * Check if bridge is configured
   */
  isConfigured() {
    return this.enabled;
  }
}

module.exports = { TelegramBridge };
