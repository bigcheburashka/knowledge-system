/**
 * Quality-Based Expansion
 * Expands topics that have low quality scores
 * Triggers: On-demand after Deep Learning
 */

const fs = require('fs').promises;
const path = require('path');

class QualityBasedExpansion {
  constructor(options = {}) {
    this.customTopicsPath = options.customTopicsPath || 
      '/root/.openclaw/workspace/knowledge-system/custom-topics.json';
    this.qualityThreshold = options.qualityThreshold || 0.7;
  }

  /**
   * Analyze topic and suggest expansions for quality improvement
   */
  async analyzeAndExpand(topic, quality) {
    console.log(`[QualityExpansion] Analyzing ${topic.name} (quality: ${quality})`);
    
    if (quality >= this.qualityThreshold) {
      console.log(`[QualityExpansion] Quality OK, skipping`);
      return { expanded: false, reason: 'quality_ok' };
    }
    
    const expansions = [];
    
    // 1. Missing best practices
    if (!topic.bestPractices || topic.bestPractices.length < 5) {
      expansions.push({
        name: `${topic.name} - best practices collection`,
        type: 'pattern',
        priority: 'high',
        reason: `Quality ${Math.round(quality * 100)}%: only ${topic.bestPractices?.length || 0} best practices found`
      });
    }
    
    // 2. Missing common mistakes
    if (!topic.commonMistakes || topic.commonMistakes.length < 5) {
      expansions.push({
        name: `${topic.name} - common mistakes and pitfalls`,
        type: 'problem',
        priority: 'high',
        reason: `Quality ${Math.round(quality * 100)}%: only ${topic.commonMistakes?.length || 0} common mistakes found`
      });
    }
    
    // 3. Missing related topics
    if (!topic.related || topic.related.length < 5) {
      expansions.push({
        name: `${topic.name} - ecosystem and related technologies`,
        type: 'technology',
        priority: 'medium',
        reason: `Quality ${Math.round(quality * 100)}%: only ${topic.related?.length || 0} related topics found`
      });
    }
    
    // 4. Short description
    if (!topic.description || topic.description.length < 200) {
      expansions.push({
        name: `${topic.name} - deep dive and advanced concepts`,
        type: 'technology',
        priority: 'high',
        reason: `Quality ${Math.round(quality * 100)}%: description too short (${topic.description?.length || 0} chars)`
      });
    }
    
    // Add expansions to queue
    const results = [];
    for (const expansion of expansions) {
      const exists = await this.topicExists(expansion.name);
      if (!exists) {
        const added = await this.addToQueue(expansion);
        results.push({ expansion, added });
      }
    }
    
    console.log(`[QualityExpansion] Added ${results.filter(r => r.added).length} expansions`);
    
    return {
      expanded: results.some(r => r.added),
      expansions: results
    };
  }

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

  async addToQueue(expansion) {
    try {
      const content = await fs.readFile(this.customTopicsPath, 'utf8');
      const data = JSON.parse(content);
      
      data.topics.push({
        ...expansion,
        addedAt: new Date().toISOString(),
        addedBy: 'quality-expansion'
      });
      
      await fs.writeFile(
        this.customTopicsPath,
        JSON.stringify(data, null, 2)
      );
      
      return true;
    } catch (err) {
      console.error('[QualityExpansion] Error:', err.message);
      return false;
    }
  }
}

module.exports = { QualityBasedExpansion };
