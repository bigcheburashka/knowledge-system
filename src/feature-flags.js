#!/usr/bin/env node
/**
 * Feature Flags Manager
 * Hot-reloadable feature configuration
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const FLAGS_PATH = path.join(__dirname, '..', 'config', 'feature-flags.json');

class FeatureFlags extends EventEmitter {
  constructor() {
    super();
    this.flags = {};
    this.thresholds = {};
    this.lastModified = 0;
    
    this.load();
    this.startWatcher();
  }

  load() {
    try {
      if (!fs.existsSync(FLAGS_PATH)) {
        console.warn(`⚠️  Feature flags file not found: ${FLAGS_PATH}`);
        this.flags = this.getDefaults();
        return;
      }

      const content = fs.readFileSync(FLAGS_PATH, 'utf8');
      const config = JSON.parse(content);
      
      this.flags = config.flags || this.getDefaults();
      this.thresholds = config.thresholds || this.getDefaultThresholds();
      this.lastModified = fs.statSync(FLAGS_PATH).mtimeMs;
      
      console.log('✅ Feature flags loaded');
      this.logEnabledFlags();
    } catch (error) {
      console.error('❌ Failed to load feature flags:', error.message);
      this.flags = this.getDefaults();
    }
  }

  startWatcher() {
    // Check for changes every 5 seconds
    setInterval(() => {
      try {
        const stats = fs.statSync(FLAGS_PATH);
        if (stats.mtimeMs > this.lastModified) {
          console.log('🔄 Feature flags changed, reloading...');
          this.load();
          this.emit('changed', this.flags);
        }
      } catch (error) {
        // File might be temporarily unavailable
      }
    }, 5000);
  }

  getDefaults() {
    return {
      DEEP_LEARNING: { enabled: true },
      LLM_API: { enabled: true },
      MEMGRAPH_SAVE: { enabled: true },
      QDRANT_SAVE: { enabled: true },
      COMMON_MISTAKES: { enabled: true },
      BEST_PRACTICES: { enabled: true },
      RELATED_TOPICS: { enabled: true },
      AUTO_EXTRACT: { enabled: true },
      EPISODIC_MEMORY: { enabled: true },
      METRICS_COLLECTION: { enabled: false },
      SIMULATION_MODE: { enabled: false }
    };
  }

  getDefaultThresholds() {
    return {
      MIN_RECALL_AT_5: 60,
      MAX_RESPONSE_TIME_MS: 2000,
      MIN_PRECISION: 40
    };
  }

  isEnabled(flagName) {
    return this.flags[flagName]?.enabled ?? false;
  }

  getThreshold(name) {
    return this.thresholds[name];
  }

  getAll() {
    return {
      flags: this.flags,
      thresholds: this.thresholds
    };
  }

  logEnabledFlags() {
    const enabled = Object.entries(this.flags)
      .filter(([_, config]) => config.enabled)
      .map(([name, config]) => name);
    
    const disabled = Object.entries(this.flags)
      .filter(([_, config]) => !config.enabled)
      .map(([name, _]) => name);

    console.log(`\n📋 Feature Flags Status:`);
    console.log(`  ✅ Enabled (${enabled.length}): ${enabled.join(', ')}`);
    if (disabled.length > 0) {
      console.log(`  ❌ Disabled (${disabled.length}): ${disabled.join(', ')}`);
    }
    console.log('');
  }

  // Helper methods for common checks
  shouldUseLLM() {
    return this.isEnabled('LLM_API') && !this.isEnabled('SIMULATION_MODE');
  }

  shouldSaveToQdrant() {
    return this.isEnabled('QDRANT_SAVE') && !this.isEnabled('SIMULATION_MODE');
  }

  shouldSaveToMemgraph() {
    return this.isEnabled('MEMGRAPH_SAVE') && !this.isEnabled('SIMULATION_MODE');
  }

  shouldGenerateField(field) {
    const flagMap = {
      'commonMistakes': 'COMMON_MISTAKES',
      'bestPractices': 'BEST_PRACTICES',
      'related': 'RELATED_TOPICS'
    };
    
    return this.isEnabled(flagMap[field]) ?? true;
  }

  // Check if metrics pass thresholds
  checkMetrics(metrics) {
    const issues = [];
    
    if (metrics.recallAt5 < this.thresholds.MIN_RECALL_AT_5) {
      issues.push(`Recall@5 ${metrics.recallAt5}% < threshold ${this.thresholds.MIN_RECALL_AT_5}%`);
    }
    
    if (metrics.avgResponseTime > this.thresholds.MAX_RESPONSE_TIME_MS) {
      issues.push(`Response time ${metrics.avgResponseTime}ms > threshold ${this.thresholds.MAX_RESPONSE_TIME_MS}ms`);
    }
    
    if (metrics.precision < this.thresholds.MIN_PRECISION) {
      issues.push(`Precision ${metrics.precision}% < threshold ${this.thresholds.MIN_PRECISION}%`);
    }
    
    return {
      passed: issues.length === 0,
      issues
    };
  }
}

// Singleton instance
let instance = null;

function getFeatureFlags() {
  if (!instance) {
    instance = new FeatureFlags();
  }
  return instance;
}

module.exports = { FeatureFlags, getFeatureFlags };

// CLI
if (require.main === module) {
  const flags = getFeatureFlags();
  
  const command = process.argv[2];
  
  if (command === 'list') {
    console.log('\n📋 All Feature Flags:');
    console.log('='.repeat(60));
    
    Object.entries(flags.flags).forEach(([name, config]) => {
      const status = config.enabled ? '✅' : '❌';
      console.log(`${status} ${name.padEnd(25)} ${config.description || ''}`);
    });
    
    console.log('\n📊 Thresholds:');
    console.log('='.repeat(60));
    Object.entries(flags.thresholds).forEach(([name, value]) => {
      console.log(`  ${name}: ${value}`);
    });
    console.log('');
  } else if (command === 'check') {
    const flagName = process.argv[3];
    if (flagName) {
      console.log(`${flagName}: ${flags.isEnabled(flagName) ? '✅ enabled' : '❌ disabled'}`);
    } else {
      flags.logEnabledFlags();
    }
  } else {
    console.log('Usage: node feature-flags.js [list|check [flag-name]]');
  }
}
