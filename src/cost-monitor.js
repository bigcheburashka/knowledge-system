#!/usr/bin/env node
// Cost Monitor - Track API usage and costs

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const COST_LOG = '/var/log/knowledge/costs.log';
const DAILY_BUDGET = 5.0; // $5 per day

class CostMonitor {
  constructor() {
    this.usage = {
      openai: { tokens: 0, cost: 0 },
      huggingface: { requests: 0, cost: 0 },
      kimi: { tokens: 0, cost: 0 }
    };
    this.pricing = {
      openai: {
        embedding: 0.02 / 1000000, // $0.02 per 1M tokens
        model: 'text-embedding-3-small'
      },
      huggingface: {
        free: true,
        rate: 0
      },
      kimi: {
        chat: 0.015 / 1000, // $0.015 per 1K tokens (estimated)
        embedding: 0.01 / 1000
      }
    };
  }

  async log(event, details = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = JSON.stringify({ timestamp, event, ...details }) + '\n';
    
    await fs.appendFile(COST_LOG, logEntry).catch(() => {});
    
    // Check if approaching budget
    const today = await this.getDailyCost();
    if (today > DAILY_BUDGET * 0.8) {
      console.warn(`⚠️  Daily budget warning: $${today.toFixed(2)} / $${DAILY_BUDGET}`);
    }
  }

  async getDailyCost() {
    try {
      const data = await fs.readFile(COST_LOG, 'utf-8');
      const lines = data.split('\n').filter(l => l.trim());
      
      const today = new Date().toDateString();
      let dailyCost = 0;
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const entryDate = new Date(entry.timestamp).toDateString();
          
          if (entryDate === today && entry.cost) {
            dailyCost += entry.cost;
          }
        } catch (e) {}
      }
      
      return dailyCost;
    } catch (e) {
      return 0;
    }
  }

  recordOpenAIUsage(tokens, type = 'embedding') {
    const cost = tokens * this.pricing.openai.embedding;
    this.usage.openai.tokens += tokens;
    this.usage.openai.cost += cost;
    
    this.log('openai_usage', { tokens, cost, type });
    return cost;
  }

  recordKimiUsage(tokens, type = 'chat') {
    const cost = tokens * (type === 'chat' ? this.pricing.kimi.chat : this.pricing.kimi.embedding);
    this.usage.kimi.tokens += tokens;
    this.usage.kimi.cost += cost;
    
    this.log('kimi_usage', { tokens, cost, type });
    return cost;
  }

  recordHFUsage(requests = 1) {
    this.usage.huggingface.requests += requests;
    // HF is free tier
    this.log('hf_usage', { requests, cost: 0 });
    return 0;
  }

  async generateReport() {
    const today = await this.getDailyCost();
    const weekly = await this.getWeeklyCost();
    const monthly = await this.getMonthlyCost();
    
    return {
      timestamp: new Date().toISOString(),
      daily: {
        cost: today,
        budget: DAILY_BUDGET,
        remaining: DAILY_BUDGET - today,
        percent: (today / DAILY_BUDGET * 100).toFixed(1)
      },
      weekly: {
        cost: weekly
      },
      monthly: {
        cost: monthly,
        projected: monthly * 30
      },
      usage: this.usage
    };
  }

  async getWeeklyCost() {
    return this.getCostForDays(7);
  }

  async getMonthlyCost() {
    return this.getCostForDays(30);
  }

  async getCostForDays(days) {
    try {
      const data = await fs.readFile(COST_LOG, 'utf-8');
      const lines = data.split('\n').filter(l => l.trim());
      
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
      let total = 0;
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (new Date(entry.timestamp).getTime() > cutoff && entry.cost) {
            total += entry.cost;
          }
        } catch (e) {}
      }
      
      return total;
    } catch (e) {
      return 0;
    }
  }

  async sendAlert(message) {
    // Send to Telegram if configured
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (botToken && chatId) {
      try {
        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: chatId,
          text: `💰 Cost Alert: ${message}`
        });
      } catch (e) {
        console.error('Failed to send alert:', e.message);
      }
    }
    
    console.log(`🚨 ${message}`);
  }
}

// CLI
if (require.main === module) {
  const monitor = new CostMonitor();
  const command = process.argv[2];
  
  if (command === 'report') {
    monitor.generateReport().then(report => {
      console.log('💰 Cost Report');
      console.log('='.repeat(50));
      console.log(`Daily: $${report.daily.cost.toFixed(4)} / $${report.daily.budget} (${report.daily.percent}%)`);
      console.log(`Weekly: $${report.weekly.cost.toFixed(4)}`);
      console.log(`Monthly: $${report.monthly.cost.toFixed(4)} (projected: $${report.monthly.projected.toFixed(2)})`);
      console.log('\nUsage:');
      console.log(`  OpenAI: ${report.usage.openai.tokens.toLocaleString()} tokens ($${report.usage.openai.cost.toFixed(4)})`);
      console.log(`  Kimi: ${report.usage.kimi.tokens.toLocaleString()} tokens ($${report.usage.kimi.cost.toFixed(4)})`);
      console.log(`  HF: ${report.usage.huggingface.requests} requests (free)`);
    });
  } else if (command === 'check') {
    monitor.getDailyCost().then(cost => {
      if (cost > DAILY_BUDGET) {
        console.error(`❌ Budget exceeded: $${cost.toFixed(2)} / $${DAILY_BUDGET}`);
        process.exit(1);
      } else {
        console.log(`✅ Within budget: $${cost.toFixed(4)} / $${DAILY_BUDGET}`);
      }
    });
  }
}

module.exports = CostMonitor;