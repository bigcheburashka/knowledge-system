/**
 * Staleness Check Job
 * Detects outdated knowledge and triggers refresh proposals
 */

const { LearningLog } = require('./learning-log');
const { SelfEvolution } = require('./index');
const { AuditLogger } = require('./audit-logger');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

class StalenessChecker {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge';
    this.log = new LearningLog({ basePath: `${this.basePath}/logs` });
    this.audit = new AuditLogger({ basePath: this.basePath });
    this.evolution = null;
    
    // Thresholds
    this.warningThreshold = options.warningThreshold || 60; // days
    this.criticalThreshold = options.criticalThreshold || 90; // days
    this.maxAge = options.maxAge || 365; // days - max before auto-refresh
  }

  async init() {
    await this.log.init();
    await this.audit.init();
    
    try {
      this.evolution = new SelfEvolution({ basePath: this.basePath });
      await this.evolution.init();
    } catch (err) {
      console.warn('[StalenessChecker] Evolution not available:', err.message);
    }
  }

  /**
   * Run staleness check
   */
  async run() {
    console.log('[StalenessChecker] Starting check...');
    
    const results = {
      timestamp: new Date().toISOString(),
      checked: 0,
      warning: [],
      critical: [],
      proposed: 0
    };
    
    // Check Qdrant vectors
    const qdrantResults = await this.checkQdrantStaleness();
    results.checked += qdrantResults.checked;
    results.warning.push(...qdrantResults.warning);
    results.critical.push(...qdrantResults.critical);
    
    // Check Learning Log entries
    const logResults = await this.checkLogStaleness();
    results.checked += logResults.checked;
    results.warning.push(...logResults.warning);
    results.critical.push(...logResults.critical);
    
    // Propose refreshes for critical items
    for (const item of results.critical) {
      await this.proposeRefresh(item);
      results.proposed++;
    }
    
    // Log results
    await this.log.record({
      type: 'staleness_check',
      ...results
    });
    
    await this.audit.log({
      type: 'STALENESS_CHECK',
      checked: results.checked,
      warning: results.warning.length,
      critical: results.critical.length,
      proposed: results.proposed
    });
    
    console.log(`[StalenessChecker] Complete: ${results.checked} checked, ${results.warning.length} warning, ${results.critical.length} critical`);
    
    return results;
  }

  /**
   * Check Qdrant vectors for staleness (with pagination)
   */
  async checkQdrantStaleness() {
    const results = { checked: 0, warning: [], critical: [] };
    
    try {
      const batchSize = 1000;
      let offset = 0;
      let hasMore = true;
      const now = Date.now();
      
      console.log(`[StalenessChecker] Checking Qdrant vectors (paginated)...`);
      
      while (hasMore) {
        // Get batch of vectors with their updatedAt
        const response = await axios.post(
          `${process.env.QDRANT_URL || 'http://localhost:6333'}/collections/knowledge/points/scroll`,
          { 
            limit: batchSize, 
            offset: offset,
            with_payload: true 
          }
        );
        
        const points = response.data.result.points || [];
        
        if (points.length === 0) {
          hasMore = false;
          break;
        }
        
        for (const point of points) {
          results.checked++;
          
          const updatedAt = point.payload?.updatedAt || point.payload?.createdAt;
          if (!updatedAt) continue;
          
          const age = (now - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24); // days
          
          if (age > this.criticalThreshold) {
            results.critical.push({
              id: point.id,
              name: point.payload?.name,
              age: Math.round(age),
              source: 'qdrant'
            });
          } else if (age > this.warningThreshold) {
            results.warning.push({
              id: point.id,
              name: point.payload?.name,
              age: Math.round(age),
              source: 'qdrant'
            });
          }
        }
        
        console.log(`[StalenessChecker] Processed batch: ${points.length} points (total: ${results.checked})`);
        
        // Check if we've reached the end
        if (points.length < batchSize) {
          hasMore = false;
        } else {
          offset += batchSize;
        }
        
        // Safety limit - don't process more than 100k points at once
        if (offset > 100000) {
          console.warn('[StalenessChecker] Reached safety limit (100k points), stopping');
          hasMore = false;
        }
      }
      
      console.log(`[StalenessChecker] Qdrant check complete: ${results.checked} total points`);
      
    } catch (err) {
      console.error('[StalenessChecker] Qdrant check failed:', err.message);
    }
    
    return results;
  }

  /**
   * Check Learning Log for staleness
   */
  async checkLogStaleness() {
    const results = { checked: 0, warning: [], critical: [] };
    
    try {
      // Get recent entries
      const entries = await this.log.getRecent(365); // Last year
      const now = Date.now();
      
      // Group by skill/topic
      const topics = new Map();
      
      for (const entry of entries) {
        if (entry.type === 'improvement_proposed' && entry.skill) {
          const existing = topics.get(entry.skill);
          if (!existing || new Date(entry.timestamp) > new Date(existing.timestamp)) {
            topics.set(entry.skill, entry);
          }
        }
      }
      
      for (const [skill, entry] of topics) {
        results.checked++;
        
        const age = (now - new Date(entry.timestamp).getTime()) / (1000 * 60 * 60 * 24);
        
        if (age > this.criticalThreshold) {
          results.critical.push({
            name: skill,
            age: Math.round(age),
            source: 'learning-log',
            lastUpdated: entry.timestamp
          });
        } else if (age > this.warningThreshold) {
          results.warning.push({
            name: skill,
            age: Math.round(age),
            source: 'learning-log',
            lastUpdated: entry.timestamp
          });
        }
      }
    } catch (err) {
      console.error('[StalenessChecker] Log check failed:', err.message);
    }
    
    return results;
  }

  /**
   * Propose refresh for stale knowledge
   */
  async proposeRefresh(item) {
    if (!this.evolution) return;
    
    try {
      await this.evolution.propose({
        type: 'update',
        target: item.name,
        reason: `Knowledge is ${item.age} days old and may be outdated. Consider refreshing with current best practices.`,
        updates: {
          action: 'refresh',
          originalSource: item.source
        }
      });
      
      await this.audit.log({
        type: 'REFRESH_PROPOSED',
        item: item.name,
        age: item.age,
        source: item.source
      });
      
      console.log(`[StalenessChecker] Proposed refresh for: ${item.name}`);
    } catch (err) {
      console.error(`[StalenessChecker] Failed to propose refresh for ${item.name}:`, err.message);
    }
  }

  /**
   * Generate staleness report
   */
  async generateReport() {
    const results = await this.run();
    
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalChecked: results.checked,
        warningCount: results.warning.length,
        criticalCount: results.critical.length,
        refreshProposed: results.proposed
      },
      warning: results.warning,
      critical: results.critical,
      recommendations: [
        'Review critical items for accuracy',
        'Schedule refresh for outdated knowledge',
        'Update best practices in stale skills'
      ]
    };
  }
}

// CLI usage
if (require.main === module) {
  const checker = new StalenessChecker();
  
  checker.init().then(() => {
    return checker.run();
  }).then(results => {
    console.log('\n=== Staleness Check Complete ===');
    console.log(`Checked: ${results.checked}`);
    console.log(`Warning: ${results.warning.length}`);
    console.log(`Critical: ${results.critical.length}`);
    console.log(`Proposed: ${results.proposed}`);
    process.exit(0);
  }).catch(err => {
    console.error('❌ Staleness check failed:', err);
    process.exit(1);
  });
}

module.exports = { StalenessChecker };
