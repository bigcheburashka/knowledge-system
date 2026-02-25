#!/usr/bin/env node
/**
 * Learning Budget Manager
 * Daily self-directed learning with time budgeting
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

const CONFIG = {
  dailyBudgetMinutes: 30,
  dataDir: path.join(__dirname, '..', 'data', 'learning-budget'),
  topicsFile: path.join(__dirname, '..', 'custom-topics.json'),
  deepLearningScript: path.join(__dirname, 'deep-learning.js')
};

class LearningBudget {
  constructor() {
    this.budget = {
      date: new Date().toISOString().split('T')[0],
      totalMinutes: CONFIG.dailyBudgetMinutes,
      usedMinutes: 0,
      topicsProcessed: 0,
      sessions: []
    };
  }

  async init() {
    await fs.mkdir(CONFIG.dataDir, { recursive: true });
    await this.loadTodayBudget();
  }

  async loadTodayBudget() {
    const todayFile = path.join(CONFIG.dataDir, `${this.budget.date}.json`);
    try {
      const content = await fs.readFile(todayFile, 'utf8');
      this.budget = JSON.parse(content);
    } catch {
      // New day, start fresh
    }
  }

  async saveBudget() {
    const todayFile = path.join(CONFIG.dataDir, `${this.budget.date}.json`);
    await fs.writeFile(todayFile, JSON.stringify(this.budget, null, 2));
  }

  async getPrioritizedTopics() {
    const content = await fs.readFile(CONFIG.topicsFile, 'utf8');
    const data = JSON.parse(content);
    
    // Score topics by priority
    const scored = data.topics
      .filter(t => !t.learned && t.priority !== 'low')
      .map(t => ({
        ...t,
        score: this.calculatePriorityScore(t)
      }))
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 3); // Top 3 for today
  }

  calculatePriorityScore(topic) {
    let score = 0;
    
    // Priority weight
    if (topic.priority === 'high') score += 100;
    if (topic.priority === 'medium') score += 50;
    
    // Frequency mentions (if available)
    if (topic.mentionCount) score += topic.mentionCount * 10;
    
    // Age in queue (older = more urgent)
    if (topic.addedAt) {
      const daysInQueue = (Date.now() - new Date(topic.addedAt)) / (1000 * 60 * 60 * 24);
      score += Math.min(daysInQueue * 5, 50); // Cap at 50
    }
    
    // Source quality
    if (topic.source === 'system-design-space') score += 30;
    if (topic.source === 'user-request') score += 20;
    
    return score;
  }

  async runLearningSession(topics) {
    const sessionStart = Date.now();
    const results = [];

    for (const topic of topics) {
      if (this.budget.usedMinutes >= this.budget.totalMinutes) {
        console.log('⏰ Daily budget exhausted');
        break;
      }

      console.log(`\n📚 Learning: ${topic.name} (score: ${topic.score.toFixed(1)})`);
      
      try {
        // Run deep learning for this topic
        const result = await this.learnTopic(topic);
        results.push(result);
        
        this.budget.topicsProcessed++;
        this.budget.usedMinutes += result.durationMinutes;
        
        // Log session
        this.budget.sessions.push({
          topic: topic.name,
          duration: result.durationMinutes,
          timestamp: new Date().toISOString(),
          success: result.success
        });

        console.log(`✅ Completed in ${result.durationMinutes}min`);
        
      } catch (error) {
        console.error(`❌ Failed: ${error.message}`);
        this.budget.sessions.push({
          topic: topic.name,
          error: error.message,
          timestamp: new Date().toISOString(),
          success: false
        });
      }
    }

    return results;
  }

  async learnTopic(topic) {
    const startTime = Date.now();
    
    // Use Deep Learning with --topic argument
    const cmd = `cd ${path.dirname(CONFIG.deepLearningScript)} && node deep-learning.js --topic="${topic.name}"`;
    
    try {
      const output = execSync(cmd, { 
        timeout: 20 * 60 * 1000, // 20 min max per topic
        encoding: 'utf8',
        stdio: 'pipe'
      });
      
      // Parse result from output
      const resultMatch = output.match(/📋 Result: ({.+})/s);
      const result = resultMatch ? JSON.parse(resultMatch[1]) : { success: true };
      
      const durationMinutes = Math.round((Date.now() - startTime) / 60000);
      
      return {
        success: result.success,
        durationMinutes: Math.min(durationMinutes, 20),
        topic: topic.name,
        skipped: result.skipped,
        reason: result.reason
      };
      
    } catch (error) {
      // Even if command failed, check if it was a "skip" (exit code 0 means success)
      if (error.status === 0) {
        return {
          success: true,
          durationMinutes: 0,
          topic: topic.name,
          skipped: true,
          reason: 'already_exists_or_disabled'
        };
      }
      throw new Error(`Deep learning failed: ${error.message}`);
    }
  }

  generateReport() {
    const remaining = this.budget.totalMinutes - this.budget.usedMinutes;
    const utilization = (this.budget.usedMinutes / this.budget.totalMinutes * 100).toFixed(1);
    
    const successful = this.budget.sessions.filter(s => s.success && !s.skipped).length;
    const skipped = this.budget.sessions.filter(s => s.skipped).length;
    const failed = this.budget.sessions.filter(s => !s.success).length;
    
    return `
🎯 Daily Learning Budget Report — ${this.budget.date}

📊 Budget Utilization: ${utilization}%
   Used: ${this.budget.usedMinutes} / ${this.budget.totalMinutes} minutes
   Remaining: ${remaining} minutes

📚 Topics Processed: ${this.budget.topicsProcessed}
   ✅ Learned: ${successful}
   ⏩ Skipped: ${skipped}
   ❌ Failed: ${failed}

📋 Sessions:
${this.budget.sessions.map(s => {
  const icon = s.success ? (s.skipped ? '⏩' : '✅') : '❌';
  const status = s.skipped ? `(skipped: ${s.reason})` : `(${s.duration}min)`;
  return `   ${icon} ${s.topic} ${status}`;
}).join('\n') || '   None today'}

${remaining > 5 ? `💡 ${Math.floor(remaining / 10)} more topics can be processed` : '⏰ Budget exhausted'}
`;
  }

  async notifyUser(report) {
    // Send to Telegram group
    const { execSync } = require('child_process');
    const message = report.replace(/"/g, '\\"');
    
    try {
      execSync(`openclaw message send --channel=telegram --target="-1003755908506" --message="${message}"`, {
        stdio: 'ignore'
      });
    } catch (e) {
      console.log('Notification skipped:', e.message);
    }
  }
}

// Main execution
async function main() {
  const budget = new LearningBudget();
  await budget.init();

  console.log('🎯 Learning Budget Manager\n');
  console.log(`Date: ${budget.budget.date}`);
  console.log(`Budget: ${budget.budget.totalMinutes} minutes\n`);

  // Get prioritized topics
  const topics = await budget.getPrioritizedTopics();
  
  if (topics.length === 0) {
    console.log('✅ No topics to learn today');
    return;
  }

  console.log(`📋 Top ${topics.length} topics for today:`);
  topics.forEach((t, i) => {
    console.log(`   ${i + 1}. ${t.name} (priority: ${t.priority}, score: ${t.score.toFixed(1)})`);
  });

  // Run learning
  console.log('\n🚀 Starting learning sessions...\n');
  await budget.runLearningSession(topics);

  // Save and report
  await budget.saveBudget();
  const report = budget.generateReport();
  console.log(report);

  // Notify user
  await budget.notifyUser(report);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { LearningBudget };
