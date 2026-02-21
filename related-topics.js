#!/usr/bin/env node
// Related Topics Extractor - Auto-add related topics from Deep Learning

const fs = require('fs').promises;
const path = require('path');

const CUSTOM_TOPICS_FILE = '/root/.openclaw/workspace/knowledge-system/custom-topics.json';
const SUGGESTIONS_FILE = '/root/.openclaw/workspace/knowledge-system/suggested-topics.json';

class RelatedTopicsExtractor {
  async loadCustomTopics() {
    try {
      const data = await fs.readFile(CUSTOM_TOPICS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return { topics: [] };
    }
  }

  async loadSuggestions() {
    try {
      const data = await fs.readFile(SUGGESTIONS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return { suggestions: [], autoAdded: [], pendingReview: [] };
    }
  }

  async saveSuggestions(data) {
    await fs.writeFile(SUGGESTIONS_FILE, JSON.stringify(data, null, 2));
  }

  // Extract related topics from Deep Learning results
  async extractFromDeepLearningResults(expandedTopics) {
    const suggestions = [];
    
    for (const topic of expandedTopics) {
      if (topic.related && Array.isArray(topic.related)) {
        for (const relatedName of topic.related) {
          // Skip if already in custom topics
          const custom = await this.loadCustomTopics();
          const exists = custom.topics.find(t => 
            t.name.toLowerCase() === relatedName.toLowerCase()
          );
          
          if (!exists) {
            suggestions.push({
              name: relatedName,
              type: this.inferType(relatedName, topic.type),
              priority: 'low', // Lower priority for auto-extracted
              source: `related to: ${topic.name}`,
              suggestedAt: new Date().toISOString(),
              autoAdd: this.shouldAutoAdd(relatedName)
            });
          }
        }
      }
      
      // Also extract from bestPractices and commonMistakes
      if (topic.bestPractices) {
        topic.bestPractices.forEach(bp => {
          const techMentions = this.extractTechMentions(bp);
          techMentions.forEach(tech => {
            if (!this.isCommonWord(tech)) {
              suggestions.push({
                name: tech,
                type: 'technology',
                priority: 'low',
                source: `mentioned in: ${topic.name} best practices`,
                suggestedAt: new Date().toISOString(),
                autoAdd: false
              });
            }
          });
        });
      }
    }
    
    return this.deduplicate(suggestions);
  }

  inferType(relatedName, parentType) {
    // Simple heuristic based on name patterns
    const name = relatedName.toLowerCase();
    
    if (name.includes('pattern') || name.includes('architecture')) return 'pattern';
    if (name.includes('test') || name.includes('cache') || name.includes('auth')) return 'solution';
    if (name.includes('error') || name.includes('bug') || name.includes('leak')) return 'problem';
    
    // Default based on parent
    return parentType || 'technology';
  }

  extractTechMentions(text) {
    // Extract potential technology names from text
    const techPatterns = [
      /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)\b/g, // Capitalized words
      /\b([a-z]+\.js)\b/g, // .js libraries
      /\b([a-z]+\.py)\b/g, // .py libraries
    ];
    
    const mentions = [];
    techPatterns.forEach(pattern => {
      const matches = text.match(pattern) || [];
      mentions.push(...matches);
    });
    
    return [...new Set(mentions)];
  }

  isCommonWord(word) {
    const common = ['the', 'and', 'use', 'for', 'with', 'from', 'this', 'that', 'when', 'where'];
    return common.includes(word.toLowerCase());
  }

  shouldAutoAdd(name) {
    // Auto-add only well-known technologies
    const wellKnown = [
      'docker', 'kubernetes', 'react', 'node.js', 'typescript', 'postgresql',
      'redis', 'mongodb', 'aws', 'gcp', 'azure', 'graphql', 'rest', 'grpc',
      'kafka', 'rabbitmq', 'nginx', 'apache', 'nginx', 'elasticsearch'
    ];
    return wellKnown.includes(name.toLowerCase());
  }

  deduplicate(suggestions) {
    const seen = new Set();
    return suggestions.filter(s => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Process suggestions: auto-add some, queue others for review
  async processSuggestions(suggestions) {
    const data = await this.loadSuggestions();
    const custom = await this.loadCustomTopics();
    
    let autoAdded = 0;
    let pendingReview = 0;
    
    for (const suggestion of suggestions) {
      // Check if already exists
      const exists = custom.topics.find(t => 
        t.name.toLowerCase() === suggestion.name.toLowerCase()
      );
      const alreadySuggested = data.suggestions.find(s => 
        s.name.toLowerCase() === suggestion.name.toLowerCase()
      );
      
      if (exists || alreadySuggested) continue;
      
      if (suggestion.autoAdd) {
        // Auto-add well-known technologies
        const TopicsManager = require('./custom-topics.js');
        const manager = new TopicsManager();
        await manager.addTopic(
          suggestion.name,
          suggestion.type,
          'low',
          `Auto-added: ${suggestion.source}`
        );
        data.autoAdded.push(suggestion);
        autoAdded++;
      } else {
        // Queue for review
        data.pendingReview.push(suggestion);
        pendingReview++;
      }
    }
    
    data.suggestions = [...data.suggestions, ...suggestions];
    await this.saveSuggestions(data);
    
    return { autoAdded, pendingReview, total: suggestions.length };
  }

  // Get pending suggestions for user review
  async getPendingSuggestions() {
    const data = await this.loadSuggestions();
    return data.pendingReview || [];
  }

  // Approve a pending suggestion
  async approveSuggestion(name) {
    const data = await this.loadSuggestions();
    const suggestion = data.pendingReview.find(s => 
      s.name.toLowerCase() === name.toLowerCase()
    );
    
    if (!suggestion) return false;
    
    // Add to custom topics
    const TopicsManager = require('./custom-topics.js');
    const manager = new TopicsManager();
    await manager.addTopic(
      suggestion.name,
      suggestion.type,
      'medium', // Upgrade priority on approval
      suggestion.source
    );
    
    // Remove from pending
    data.pendingReview = data.pendingReview.filter(s => 
      s.name.toLowerCase() !== name.toLowerCase()
    );
    await this.saveSuggestions(data);
    
    return true;
  }

  // Show stats
  async showStats() {
    const data = await this.loadSuggestions();
    console.log('\n📊 RELATED TOPICS STATS\n');
    console.log(`Total suggestions made: ${data.suggestions?.length || 0}`);
    console.log(`Auto-added: ${data.autoAdded?.length || 0}`);
    console.log(`Pending review: ${data.pendingReview?.length || 0}`);
    
    if (data.pendingReview?.length > 0) {
      console.log('\n📝 Pending for your approval:\n');
      data.pendingReview.forEach((s, i) => {
        console.log(`${i + 1}. ${s.name} (${s.type}) - ${s.source}`);
      });
      console.log('\nApprove with: node related-topics.js approve "Topic Name"\n');
    }
  }
}

// CLI
const extractor = new RelatedTopicsExtractor();
const command = process.argv[2];

(async () => {
  switch (command) {
    case 'extract':
      // This would be called from deep-learning.js after processing
      console.log('Use from deep-learning.js');
      break;
      
    case 'pending':
      const pending = await extractor.getPendingSuggestions();
      if (pending.length === 0) {
        console.log('✅ No pending suggestions');
      } else {
        console.log('\n📝 Pending suggestions:\n');
        pending.forEach((s, i) => {
          console.log(`${i + 1}. ${s.name} (${s.type})`);
          console.log(`   Source: ${s.source}`);
        });
      }
      break;
      
    case 'approve':
      const name = process.argv[3];
      if (!name) {
        console.log('Usage: node related-topics.js approve "Topic Name"');
      } else {
        const success = await extractor.approveSuggestion(name);
        console.log(success ? `✅ Approved: ${name}` : `❌ Not found: ${name}`);
      }
      break;
      
    case 'stats':
      await extractor.showStats();
      break;
      
    default:
      console.log(`
🔗 Related Topics Extractor

Commands:
  pending     Show suggestions waiting for approval
  approve "Name"  Approve a pending suggestion
  stats       Show statistics

This tool automatically extracts related topics from Deep Learning
results and suggests them for addition to the learning plan.
      `);
  }
})();

module.exports = RelatedTopicsExtractor;
