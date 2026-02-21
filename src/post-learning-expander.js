/**
 * Post-Learning Expander
 * Analyzes freshly learned topics and expands knowledge graph
 * Triggers: Immediately after Deep Learning run
 */

const { FileMessageQueue } = require('./evolution/queue/file-queue');
const { LearningLog } = require('./evolution/learning-log');
const { AuditLogger } = require('./evolution/audit-logger');
const fs = require('fs').promises;
const path = require('path');

class PostLearningExpander {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge';
    this.customTopicsPath = options.customTopicsPath || 
      '/root/.openclaw/workspace/knowledge-system/custom-topics.json';
    
    // Expansion rules
    this.expansionRules = [
      // Technology → Implementation
      { pattern: /kubernetes/i, expands: ['helm', 'kubectl', 'k9s', 'istio', 'argo-cd'] },
      { pattern: /docker/i, expands: ['docker-compose', 'dockerfile-best-practices', 'container-security'] },
      { pattern: /react/i, expands: ['react-hooks', 'react-router', 'redux', 'next.js'] },
      { pattern: /node\.?js/i, expands: ['npm', 'yarn', 'pnpm', 'express', 'fastify'] },
      { pattern: /python/i, expands: ['pip', 'poetry', 'pytest', 'fastapi', 'django'] },
      { pattern: /postgresql/i, expands: ['pg-admin', 'sql-optimization', 'database-indexing'] },
      { pattern: /microservices/i, expands: ['service-mesh', 'api-gateway', 'event-driven', 'saga-pattern'] },
      { pattern: /graphql/i, expands: ['apollo-client', 'relay', 'schema-stitching'] },
      { pattern: /testing/i, expands: ['unit-testing', 'integration-testing', 'e2e-testing', 'test-coverage'] },
      { pattern: /ci.?cd/i, expands: ['github-actions', 'gitlab-ci', 'jenkins', 'tekton'] },
      { pattern: /monitoring/i, expands: ['prometheus', 'grafana', 'datadog', 'observability'] },
      { pattern: /security/i, expands: ['oauth', 'jwt', 'encryption', 'vulnerability-scanning'] },
      { pattern: /performance/i, expands: ['caching', 'load-balancing', 'cdn', 'optimization'] }
    ];
    
    // What to expand based on topic type
    this.typeBasedExpansion = {
      'technology': ['best-practices', 'common-mistakes', 'tools', 'deployment'],
      'pattern': ['implementation', 'examples', 'anti-patterns'],
      'problem': ['solutions', 'prevention', 'detection'],
      'solution': ['trade-offs', 'alternatives', 'when-to-use']
    };
  }

  /**
   * Run expansion on recently learned topics
   */
  async expand(recentTopics) {
    console.log('[PostLearningExpander] Starting expansion...');
    
    const results = {
      processed: 0,
      expansionsFound: 0,
      added: 0,
      details: []
    };
    
    for (const topic of recentTopics) {
      results.processed++;
      
      // Find expansions
      const expansions = await this.findExpansions(topic);
      
      if (expansions.length > 0) {
        results.expansionsFound += expansions.length;
        
        // Add to learning queue
        for (const expansion of expansions) {
          const added = await this.addToQueue(expansion, topic);
          if (added) {
            results.added++;
          }
          results.details.push({
            from: topic.name,
            to: expansion.name,
            reason: expansion.reason,
            added
          });
        }
      }
    }
    
    console.log(`[PostLearningExpander] Complete: ${results.added} new topics added`);
    return results;
  }

  /**
   * Find what to expand from a topic
   */
  async findExpansions(topic) {
    const expansions = [];
    
    // 1. Rule-based expansion
    for (const rule of this.expansionRules) {
      if (rule.pattern.test(topic.name)) {
        for (const expandTo of rule.expands) {
          // Check if already exists
          const exists = await this.topicExists(expandTo);
          if (!exists) {
            expansions.push({
              name: expandTo,
              type: 'technology',
              priority: 'high',
              reason: `Expansion from ${topic.name}: related technology`,
              source: 'rule-based',
              parent: topic.name
            });
          }
        }
      }
    }
    
    // 2. Type-based expansion
    const typeExpansions = this.typeBasedExpansion[topic.type];
    if (typeExpansions) {
      for (const expansion of typeExpansions) {
        const expandedName = `${topic.name} - ${expansion}`;
        const exists = await this.topicExists(expandedName);
        if (!exists) {
          expansions.push({
            name: expandedName,
            type: topic.type,
            priority: 'medium',
            reason: `Expansion: ${expansion} for ${topic.name}`,
            source: 'type-based',
            parent: topic.name
          });
        }
      }
    }
    
    // 3. Check quality gaps
    if (topic.quality && topic.quality < 0.8) {
      const qualityGap = await this.identifyQualityGap(topic);
      if (qualityGap) {
        const exists = await this.topicExists(qualityGap.name);
        if (!exists) {
          expansions.push({
            ...qualityGap,
            source: 'quality-gap',
            parent: topic.name
          });
        }
      }
    }
    
    return expansions;
  }

  /**
   * Identify what's missing based on quality
   */
  async identifyQualityGap(topic) {
    // If low quality, likely missing something
    const gaps = [];
    
    if (topic.bestPractices && topic.bestPractices.length < 3) {
      return {
        name: `${topic.name} - advanced best practices`,
        type: 'pattern',
        priority: 'high',
        reason: `Quality ${Math.round(topic.quality * 100)}%: need more best practices`
      };
    }
    
    if (topic.commonMistakes && topic.commonMistakes.length < 3) {
      return {
        name: `${topic.name} - common mistakes deep dive`,
        type: 'problem',
        priority: 'high',
        reason: `Quality ${Math.round(topic.quality * 100)}%: need more common mistakes`
      };
    }
    
    if (topic.related && topic.related.length < 3) {
      return {
        name: `${topic.name} - ecosystem and related tools`,
        type: 'technology',
        priority: 'medium',
        reason: `Quality ${Math.round(topic.quality * 100)}%: need more related topics`
      };
    }
    
    return null;
  }

  /**
   * Check if topic already exists
   */
  async topicExists(name) {
    try {
      const content = await fs.readFile(this.customTopicsPath, 'utf8');
      const data = JSON.parse(content);
      
      return data.topics.some(t => 
        t.name.toLowerCase() === name.toLowerCase()
      );
    } catch {
      return false;
    }
  }

  /**
   * Add expansion to learning queue
   */
  async addToQueue(expansion, parentTopic) {
    try {
      const content = await fs.readFile(this.customTopicsPath, 'utf8');
      const data = JSON.parse(content);
      
      const topic = {
        name: expansion.name,
        type: expansion.type,
        priority: expansion.priority,
        addedAt: new Date().toISOString(),
        addedBy: 'post-learning-expander',
        source: expansion.source,
        parentTopic: parentTopic.name,
        reason: expansion.reason
      };
      
      data.topics.push(topic);
      
      await fs.writeFile(
        this.customTopicsPath,
        JSON.stringify(data, null, 2)
      );
      
      console.log(`[PostLearningExpander] Added: ${topic.name}`);
      return true;
      
    } catch (err) {
      console.error('[PostLearningExpander] Error adding topic:', err.message);
      return false;
    }
  }

  /**
   * Run after Deep Learning completion
   */
  async runAfterDeepLearning(newTopics) {
    console.log('[PostLearningExpander] Running after Deep Learning...');
    
    if (!newTopics || newTopics.length === 0) {
      console.log('[PostLearningExpander] No new topics to expand');
      return { processed: 0, added: 0 };
    }
    
    return this.expand(newTopics);
  }
}

module.exports = { PostLearningExpander };

// CLI test
if (require.main === module) {
  const expander = new PostLearningExpander();
  
  const testTopics = [
    { name: 'Kubernetes', type: 'technology', quality: 0.7 },
    { name: 'Docker', type: 'technology', quality: 0.9 }
  ];
  
  expander.expand(testTopics)
    .then(results => {
      console.log('\n=== Expansion Results ===');
      console.log(results);
    })
    .catch(console.error);
}
