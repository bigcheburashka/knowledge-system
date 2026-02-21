#!/usr/bin/env node
// Custom Topics Manager - Add your own topics for Deep Learning

const fs = require('fs').promises;
const path = require('path');

const TOPICS_FILE = '/root/.openclaw/workspace/knowledge-system/custom-topics.json';

class TopicsManager {
  async loadTopics() {
    try {
      const data = await fs.readFile(TOPICS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return { topics: [] };
    }
  }

  async saveTopics(data) {
    await fs.writeFile(TOPICS_FILE, JSON.stringify(data, null, 2));
  }

  async addTopic(name, type = 'technology', priority = 'medium', description = '') {
    const data = await this.loadTopics();
    
    // Check for duplicates
    const exists = data.topics.find(t => t.name.toLowerCase() === name.toLowerCase());
    if (exists) {
      console.log(`⚠️  Topic "${name}" already exists`);
      return false;
    }

    data.topics.push({
      name,
      type,
      priority,
      description,
      addedAt: new Date().toISOString()
    });

    await this.saveTopics(data);
    console.log(`✅ Added: ${name} (${type})`);
    return true;
  }

  async listTopics() {
    const data = await this.loadTopics();
    
    if (data.topics.length === 0) {
      console.log('📭 No custom topics yet');
      return;
    }

    console.log('\n📚 CUSTOM TOPICS FOR DEEP LEARNING\n');
    
    const byType = {};
    data.topics.forEach(t => {
      if (!byType[t.type]) byType[t.type] = [];
      byType[t.type].push(t);
    });

    for (const [type, topics] of Object.entries(byType)) {
      console.log(`\n${type.toUpperCase()} (${topics.length}):`);
      topics.forEach(t => {
        const priority = t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '🟢';
        console.log(`  ${priority} ${t.name}`);
        if (t.description) console.log(`     ${t.description}`);
      });
    }
    console.log(`\nTotal: ${data.topics.length} topics\n`);
  }

  async removeTopic(name) {
    const data = await this.loadTopics();
    const initial = data.topics.length;
    data.topics = data.topics.filter(t => t.name.toLowerCase() !== name.toLowerCase());
    
    if (data.topics.length === initial) {
      console.log(`❌ Topic "${name}" not found`);
      return false;
    }

    await this.saveTopics(data);
    console.log(`✅ Removed: ${name}`);
    return true;
  }

  async getTopicsForDeepLearning() {
    const data = await this.loadTopics();
    return data.topics;
  }

  async suggestTopics() {
    const suggestions = [
      { name: 'TypeScript Advanced Types', type: 'technology', priority: 'medium' },
      { name: 'Database Indexing Strategies', type: 'technology', priority: 'high' },
      { name: 'Race Conditions in Async Code', type: 'problem', priority: 'high' },
      { name: 'Circuit Breaker Pattern', type: 'pattern', priority: 'medium' },
      { name: 'Redis Caching Patterns', type: 'solution', priority: 'medium' },
      { name: 'OAuth 2.0 Implementation', type: 'technology', priority: 'high' },
      { name: 'Memory Profiling', type: 'technology', priority: 'medium' },
      { name: 'API Rate Limiting', type: 'solution', priority: 'high' },
      { name: 'Message Queue Patterns', type: 'pattern', priority: 'medium' },
      { name: 'SQL Query Optimization', type: 'solution', priority: 'high' }
    ];

    console.log('\n💡 SUGGESTED TOPICS TO ADD:\n');
    suggestions.forEach((s, i) => {
      const priority = s.priority === 'high' ? '🔴' : '🟡';
      console.log(`${i + 1}. ${priority} ${s.name} (${s.type})`);
    });
    console.log('\nAdd with: node custom-topics.js add "Topic Name" [type] [priority] [description]\n');
  }
}

// CLI
const manager = new TopicsManager();
const command = process.argv[2];

(async () => {
  switch (command) {
    case 'add':
      const name = process.argv[3];
      const type = process.argv[4] || 'technology';
      const priority = process.argv[5] || 'medium';
      const desc = process.argv[6] || '';
      if (!name) {
        console.log('Usage: node custom-topics.js add "Topic Name" [type] [priority] [description]');
        console.log('Types: technology, problem, solution, pattern');
        console.log('Priority: high, medium, low');
      } else {
        await manager.addTopic(name, type, priority, desc);
      }
      break;

    case 'list':
    case 'ls':
      await manager.listTopics();
      break;

    case 'remove':
    case 'rm':
      const rmName = process.argv[3];
      if (!rmName) {
        console.log('Usage: node custom-topics.js remove "Topic Name"');
      } else {
        await manager.removeTopic(rmName);
      }
      break;

    case 'suggest':
      await manager.suggestTopics();
      break;

    case 'help':
    default:
      console.log(`
📚 Custom Topics Manager

Commands:
  add "Name" [type] [priority] [desc]  Add new topic
  list                                 Show all topics
  remove "Name"                        Remove topic
  suggest                              Show suggestions

Examples:
  node custom-topics.js add "Docker Swarm" technology high "Container orchestration"
  node custom-topics.js add "Memory Leaks" problem high
  node custom-topics.js list
  node custom-topics.js suggest
      `);
  }
})();

module.exports = TopicsManager;
