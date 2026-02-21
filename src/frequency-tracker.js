#!/usr/bin/env node
/**
 * Frequency Tracker - Tracks topic mentions in sessions
 * Auto-adds frequently mentioned topics to Deep Learning queue
 */

const fs = require('fs');
const path = require('path');
const OpenClawAdapter = require('../src/openclaw-adapter');
const { getFeatureFlags } = require('../src/feature-flags');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FREQUENCY_FILE = path.join(DATA_DIR, 'topic-frequency.json');
const THRESHOLD_MENTIONS = 3; // Auto-add after 3 mentions
const THRESHOLD_DAYS = 7; // Within 7 days

class FrequencyTracker {
  constructor() {
    this.flags = getFeatureFlags();
    this.data = this.loadData();
  }

  loadData() {
    try {
      if (fs.existsSync(FREQUENCY_FILE)) {
        return JSON.parse(fs.readFileSync(FREQUENCY_FILE, 'utf8'));
      }
    } catch (error) {
      console.error('Error loading frequency data:', error.message);
    }
    
    return {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      topics: {}, // topic -> { mentions: [], lastMention: date }
      autoAdded: [] // topics auto-added to learning queue
    };
  }

  saveData() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      
      this.data.lastUpdated = new Date().toISOString();
      fs.writeFileSync(FREQUENCY_FILE, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Error saving frequency data:', error.message);
    }
  }

  extractTopicsFromText(text) {
    // Simple keyword extraction - can be enhanced with NLP
    const topics = [];
    
    // Technology keywords
    const techPatterns = [
      /\b(docker|kubernetes|k8s)\b/gi,
      /\b(postgres|postgresql|mysql|mongodb)\b/gi,
      /\b(redis|kafka|rabbitmq)\b/gi,
      /\b(node\.?js|python|go|rust|java)\b/gi,
      /\b(react|vue|angular|svelte)\b/gi,
      /\b(graphql|rest|api)\b/gi,
      /\b(microservices|monolith|serverless)\b/gi,
      /\b(ci\/cd|jenkins|github actions|gitlab)\b/gi,
      /\b(docker compose|terraform|ansible)\b/gi,
      /\b(aws|gcp|azure|cloud)\b/gi,
      /\b(testing|jest|mocha|cypress|playwright)\b/gi,
      /\b(typescript|javascript|python|rust)\b/gi,
      /\b(memgraph|neo4j|qdrant|vector db)\b/gi,
      /\b(llm|openai|anthropic|kimi|gpt)\b/gi,
      /\b(embedding|vector|semantic search)\b/gi
    ];
    
    techPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach(match => {
          // Normalize topic name
          let topic = match.toLowerCase().trim();
          topic = topic.replace(/\.?js$/, '.js');
          topic = topic.replace(/^k8s$/, 'kubernetes');
          topic = topic.replace(/^postgres$/, 'postgresql');
          
          if (!topics.includes(topic)) {
            topics.push(topic);
          }
        });
      }
    });
    
    // Concept patterns (phrases)
    const conceptPatterns = [
      /memory leak/i,
      /event[- ]?driven/i,
      /design pattern/i,
      /best practice/i,
      /performance optimization/i,
      /code review/i,
      /refactoring/i,
      /architecture/i,
      /scalability/i,
      /security/i,
      /authentication/i,
      /authorization/i,
      /caching/i,
      /load balancing/i
    ];
    
    conceptPatterns.forEach(pattern => {
      if (pattern.test(text)) {
        const match = text.match(pattern)[0];
        const topic = match.toLowerCase().trim();
        if (!topics.includes(topic)) {
          topics.push(topic);
        }
      }
    });
    
    return topics;
  }

  recordMention(topic, context = {}) {
    const now = new Date().toISOString();
    
    if (!this.data.topics[topic]) {
      this.data.topics[topic] = {
        mentions: [],
        firstMention: now,
        lastMention: now,
        contexts: []
      };
    }
    
    this.data.topics[topic].mentions.push(now);
    this.data.topics[topic].lastMention = now;
    
    if (context.text) {
      // Store snippet (first 100 chars)
      const snippet = context.text.substring(0, 100).replace(/\n/g, ' ');
      this.data.topics[topic].contexts.push({
        date: now,
        snippet
      });
      
      // Keep only last 5 contexts
      if (this.data.topics[topic].contexts.length > 5) {
        this.data.topics[topic].contexts.shift();
      }
    }
    
    // Clean old mentions (older than 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    this.data.topics[topic].mentions = this.data.topics[topic].mentions.filter(
      date => new Date(date) > thirtyDaysAgo
    );
    
    this.saveData();
  }

  shouldAutoAdd(topic) {
    const topicData = this.data.topics[topic];
    if (!topicData) return false;
    
    // Already auto-added?
    if (this.data.autoAdded.includes(topic)) return false;
    
    // Check mention count within threshold days
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - THRESHOLD_DAYS);
    
    const recentMentions = topicData.mentions.filter(
      date => new Date(date) > thresholdDate
    );
    
    return recentMentions.length >= THRESHOLD_MENTIONS;
  }

  getSuggestedTopics() {
    const suggested = [];
    
    for (const [topic, data] of Object.entries(this.data.topics)) {
      if (this.shouldAutoAdd(topic)) {
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - THRESHOLD_DAYS);
        
        const recentMentions = data.mentions.filter(
          date => new Date(date) > thresholdDate
        );
        
        suggested.push({
          topic,
          mentionCount: recentMentions.length,
          firstMention: data.firstMention,
          lastMention: data.lastMention,
          contexts: data.contexts
        });
      }
    }
    
    // Sort by mention count (descending)
    return suggested.sort((a, b) => b.mentionCount - a.mentionCount);
  }

  async addToLearningQueue(topic) {
    try {
      // Add to custom-topics.json
      const topicsPath = path.join(__dirname, '..', 'custom-topics.json');
      const topicsData = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
      
      // Check if already exists
      const exists = topicsData.topics.some(t => 
        t.name.toLowerCase() === topic.toLowerCase()
      );
      
      if (exists) {
        console.log(`  ℹ️  "${topic}" already in learning queue`);
        return false;
      }
      
      // Add with auto-detected type
      const type = this.detectTopicType(topic);
      
      topicsData.topics.push({
        name: this.capitalizeTopic(topic),
        type,
        priority: 'high',
        description: `Auto-added: mentioned ${this.data.topics[topic].mentions.length} times`,
        source: 'frequency-tracker',
        addedAt: new Date().toISOString()
      });
      
      fs.writeFileSync(topicsPath, JSON.stringify(topicsData, null, 2));
      
      // Mark as auto-added
      this.data.autoAdded.push(topic);
      this.saveData();
      
      console.log(`  ✅ Added "${topic}" to learning queue (${type})`);
      return true;
      
    } catch (error) {
      console.error(`  ❌ Failed to add "${topic}":`, error.message);
      return false;
    }
  }

  detectTopicType(topic) {
    const techPatterns = /\b(docker|kubernetes|postgres|redis|node|python|react|aws|gcp)\b/i;
    const conceptPatterns = /\b(architecture|pattern|practice|optimization|security)\b/i;
    const problemPatterns = /\b(memory leak|bug|error|issue|problem|performance)\b/i;
    
    if (problemPatterns.test(topic)) return 'problem';
    if (conceptPatterns.test(topic)) return 'concept';
    if (techPatterns.test(topic)) return 'technology';
    return 'technology'; // Default
  }

  capitalizeTopic(topic) {
    return topic
      .split(/[\s-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  async processSessions(hours = 24) {
    if (!this.flags.isEnabled('AUTO_EXTRACT')) {
      console.log('⏸️ Auto-extract disabled via feature flags');
      return { processed: 0, mentions: 0 };
    }
    
    console.log('\n📊 FREQUENCY TRACKER');
    console.log('='.repeat(60));
    console.log(`Scanning last ${hours} hours of sessions...\n`);
    
    const adapter = new OpenClawAdapter({ hours });
    const sessions = await adapter.getRecentSessions();
    
    if (sessions.length === 0) {
      console.log('ℹ️  No recent sessions found');
      return { processed: 0, mentions: 0 };
    }
    
    console.log(`Found ${sessions.length} sessions`);
    
    let totalMentions = 0;
    
    for (const session of sessions) {
      const knowledge = await adapter.extractKnowledge(session);
      
      if (knowledge.text) {
        const topics = this.extractTopicsFromText(knowledge.text);
        
        for (const topic of topics) {
          this.recordMention(topic, { text: knowledge.text });
          totalMentions++;
        }
      }
    }
    
    console.log(`\n📈 Recorded ${totalMentions} topic mentions`);
    
    // Check for topics to auto-add
    const suggested = this.getSuggestedTopics();
    
    if (suggested.length > 0) {
      console.log(`\n🎯 ${suggested.length} topics ready for auto-learning:`);
      
      for (const item of suggested) {
        console.log(`\n  📌 ${item.topic}`);
        console.log(`     Mentioned: ${item.mentionCount} times in last ${THRESHOLD_DAYS} days`);
        console.log(`     First: ${new Date(item.firstMention).toLocaleDateString()}`);
        console.log(`     Last: ${new Date(item.lastMention).toLocaleDateString()}`);
        
        // Auto-add to learning queue
        const added = await this.addToLearningQueue(item.topic);
        
        if (added) {
          // Send notification (if Telegram configured)
          await this.sendNotification(item);
        }
      }
    } else {
      console.log('\n✅ No topics ready for auto-learning yet');
      console.log(`   (Need ${THRESHOLD_MENTIONS}+ mentions in ${THRESHOLD_DAYS} days)`);
    }
    
    // Show top mentioned topics
    this.showTopTopics();
    
    return {
      processed: sessions.length,
      mentions: totalMentions,
      suggested: suggested.length
    };
  }

  showTopTopics() {
    const sorted = Object.entries(this.data.topics)
      .sort((a, b) => b[1].mentions.length - a[1].mentions.length)
      .slice(0, 10);
    
    if (sorted.length > 0) {
      console.log('\n📊 Top mentioned topics (all time):');
      sorted.forEach(([topic, data], i) => {
        const status = this.data.autoAdded.includes(topic) ? '✅' : '⏳';
        console.log(`   ${i + 1}. ${status} ${topic}: ${data.mentions.length} mentions`);
      });
    }
  }

  async sendNotification(item) {
    // Placeholder for notification system
    // Can be integrated with Telegram, email, etc.
    const message = `🎯 Frequency Tracker: Auto-added "${item.topic}" to learning queue (mentioned ${item.mentionCount} times)`;
    console.log(`\n🔔 ${message}`);
    
    // Could integrate with Telegram bot here
    // await telegramBot.sendMessage(userId, message);
  }

  getStats() {
    const totalTopics = Object.keys(this.data.topics).length;
    const autoAdded = this.data.autoAdded.length;
    const pending = this.getSuggestedTopics().length;
    
    return {
      totalTopics,
      autoAdded,
      pending,
      lastUpdated: this.data.lastUpdated
    };
  }
}

// CLI
async function main() {
  const tracker = new FrequencyTracker();
  
  const command = process.argv[2];
  
  if (command === 'scan') {
    const hours = parseInt(process.argv[3]) || 24;
    const result = await tracker.processSessions(hours);
    console.log('\n' + '='.repeat(60));
    console.log('Result:', JSON.stringify(result, null, 2));
  } else if (command === 'stats') {
    const stats = tracker.getStats();
    console.log('\n📊 Frequency Tracker Stats:');
    console.log('='.repeat(60));
    console.log(`Total tracked topics: ${stats.totalTopics}`);
    console.log(`Auto-added to learning: ${stats.autoAdded}`);
    console.log(`Pending (ready to add): ${stats.pending}`);
    console.log(`Last updated: ${stats.lastUpdated}`);
    console.log('='.repeat(60));
  } else if (command === 'list') {
    const suggested = tracker.getSuggestedTopics();
    console.log('\n🎯 Topics ready for learning:');
    console.log('='.repeat(60));
    if (suggested.length === 0) {
      console.log('No topics ready yet');
    } else {
      suggested.forEach((item, i) => {
        console.log(`${i + 1}. ${item.topic} (${item.mentionCount} mentions)`);
      });
    }
    console.log('='.repeat(60));
  } else if (command === 'reset') {
    tracker.data = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      topics: {},
      autoAdded: []
    };
    tracker.saveData();
    console.log('✅ Frequency data reset');
  } else {
    console.log('Usage: node frequency-tracker.js [scan [hours]|stats|list|reset]');
    console.log('');
    console.log('Commands:');
    console.log('  scan [hours]  - Scan sessions and auto-add frequent topics');
    console.log('  stats         - Show tracking statistics');
    console.log('  list          - List topics ready for learning');
    console.log('  reset         - Reset all tracking data');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { FrequencyTracker };
