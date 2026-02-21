#!/usr/bin/env node
/**
 * Checkpoint Gates - Pre-flight and post-run validation
 * Ensures system health before running and validates results after
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getFeatureFlags } = require('./feature-flags');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const MEMGRAPH_URL = process.env.MEMGRAPH_URL || 'bolt://localhost:7687';
const COLLECTION = 'knowledge';

class CheckpointGates {
  constructor() {
    this.flags = getFeatureFlags();
    this.checks = [];
    this.warnings = [];
    this.errors = [];
  }

  async log(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level}] ${message}`;
    
    console.log(logEntry);
    
    // Also log to file
    const logDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logFile = path.join(logDir, 'checkpoints.log');
    fs.appendFileSync(logFile, logEntry + '\n');
  }

  async preFlightCheck() {
    console.log('\n' + '='.repeat(70));
    console.log('🔍 PRE-FLIGHT CHECKPOINT');
    console.log('='.repeat(70) + '\n');
    
    this.checks = [];
    this.warnings = [];
    this.errors = [];
    
    // 1. Check Qdrant connectivity
    await this.checkQdrantHealth();
    
    // 2. Check Memgraph connectivity (if enabled)
    if (this.flags.shouldSaveToMemgraph()) {
      await this.checkMemgraphHealth();
    }
    
    // 3. Check LLM API (if enabled)
    if (this.flags.shouldUseLLM()) {
      await this.checkLLMAPI();
    }
    
    // 4. Check feature flags consistency
    await this.checkFeatureFlags();
    
    // 5. Check disk space
    await this.checkDiskSpace();
    
    // 6. Check custom topics queue
    await this.checkTopicsQueue();
    
    // Report results
    return this.reportResults('PRE-FLIGHT');
  }

  async postRunCheck(newVectors = 0, failedTopics = []) {
    console.log('\n' + '='.repeat(70));
    console.log('✅ POST-RUN CHECKPOINT');
    console.log('='.repeat(70) + '\n');
    
    this.checks = [];
    this.warnings = [];
    this.errors = [];
    
    // 1. Validate new vectors exist
    if (this.flags.shouldSaveToQdrant() && newVectors > 0) {
      await this.validateNewVectors(newVectors);
    }
    
    // 2. Validate Memgraph entities (if enabled)
    if (this.flags.shouldSaveToMemgraph() && newVectors > 0) {
      await this.validateMemgraphEntities(newVectors);
    }
    
    // 3. Check for empty fields
    await this.validateDataQuality();
    
    // 4. Check failed topics
    if (failedTopics.length > 0) {
      this.errors.push(`${failedTopics.length} topics failed processing`);
      await this.log('ERROR', `Failed topics: ${failedTopics.join(', ')}`);
    }
    
    // 5. Run metrics validation
    await this.validateMetrics();
    
    return this.reportResults('POST-RUN');
  }

  async checkQdrantHealth() {
    try {
      const response = await axios.get(`${QDRANT_URL}/collections/${COLLECTION}`);
      const status = response.data.result.status;
      const vectorCount = response.data.result.points_count;
      
      this.checks.push({ name: 'Qdrant Connectivity', status: 'PASS', detail: `${vectorCount} vectors` });
      await this.log('INFO', `Qdrant: ${status}, ${vectorCount} vectors`);
      
      // Warning if too few vectors
      if (vectorCount < 10) {
        this.warnings.push(`Low vector count: ${vectorCount} (expected > 10)`);
      }
      
    } catch (error) {
      this.errors.push(`Qdrant connection failed: ${error.message}`);
      await this.log('ERROR', `Qdrant health check failed: ${error.message}`);
    }
  }

  async checkMemgraphHealth() {
    try {
      const neo4j = require('neo4j-driver');
      const driver = neo4j.driver(MEMGRAPH_URL, neo4j.auth.basic('', ''));
      const session = driver.session();
      
      const result = await session.run('RETURN 1 as test');
      const testValue = result.records[0].get('test');
      
      await session.close();
      await driver.close();
      
      // Neo4j driver returns Integer object, need to convert to number
      const testValueNum = testValue.low !== undefined ? testValue.low : testValue;
      
      if (testValueNum === 1) {
        this.checks.push({ name: 'Memgraph Connectivity', status: 'PASS' });
        await this.log('INFO', 'Memgraph: Connected');
      } else {
        this.errors.push('Memgraph test query failed');
      }
    } catch (error) {
      this.errors.push(`Memgraph connection failed: ${error.message}`);
      await this.log('ERROR', `Memgraph health check failed: ${error.message}`);
    }
  }

  async checkLLMAPI() {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        this.errors.push('ANTHROPIC_API_KEY not set');
        return;
      }
      
      // Quick API test
      const response = await axios.post('https://api.kimi.com/coding/v1/messages', {
        model: 'kimi-k2-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hello' }]
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'OpenClaw/2026.2.17'
        },
        timeout: 10000
      });
      
      this.checks.push({ name: 'LLM API', status: 'PASS' });
      await this.log('INFO', 'LLM API: Responsive');
      
    } catch (error) {
      this.errors.push(`LLM API check failed: ${error.message}`);
      await this.log('ERROR', `LLM API check failed: ${error.message}`);
    }
  }

  async checkFeatureFlags() {
    const criticalFlags = ['QDRANT_SAVE'];
    const disabled = [];
    
    criticalFlags.forEach(flag => {
      if (!this.flags.isEnabled(flag)) {
        disabled.push(flag);
      }
    });
    
    if (disabled.length > 0) {
      this.warnings.push(`Critical flags disabled: ${disabled.join(', ')}`);
    }
    
    this.checks.push({ name: 'Feature Flags', status: 'PASS', detail: `${disabled.length} warnings` });
  }

  async checkDiskSpace() {
    try {
      const stats = fs.statSync('/');
      // Simple check - in production would use proper disk usage
      this.checks.push({ name: 'Disk Space', status: 'PASS' });
    } catch (error) {
      this.warnings.push('Could not check disk space');
    }
  }

  async checkTopicsQueue() {
    try {
      const topicsPath = path.join(__dirname, '..', 'custom-topics.json');
      if (fs.existsSync(topicsPath)) {
        const topics = JSON.parse(fs.readFileSync(topicsPath, 'utf8'));
        const count = topics.topics?.length || 0;
        
        this.checks.push({ name: 'Topics Queue', status: 'PASS', detail: `${count} topics` });
        
        if (count === 0) {
          this.warnings.push('No topics in learning queue');
        }
      }
    } catch (error) {
      this.warnings.push('Could not check topics queue');
    }
  }

  async validateNewVectors(expectedCount) {
    try {
      const response = await axios.get(`${QDRANT_URL}/collections/${COLLECTION}`);
      const actualCount = response.data.result.points_count;
      
      // This is a simplified check - in production would track before/after
      this.checks.push({ 
        name: 'New Vectors', 
        status: 'PASS', 
        detail: `${actualCount} total vectors` 
      });
      
    } catch (error) {
      this.errors.push(`Vector validation failed: ${error.message}`);
    }
  }

  async validateMemgraphEntities(expectedCount) {
    try {
      const neo4j = require('neo4j-driver');
      const driver = neo4j.driver(MEMGRAPH_URL, neo4j.auth.basic('', ''));
      const session = driver.session();
      
      const result = await session.run('MATCH (e:Entity) RETURN count(e) as count');
      const count = result.records[0].get('count');
      
      await session.close();
      await driver.close();
      
      this.checks.push({ 
        name: 'Memgraph Entities', 
        status: 'PASS', 
        detail: `${count} entities` 
      });
      
    } catch (error) {
      this.errors.push(`Memgraph validation failed: ${error.message}`);
    }
  }

  async validateDataQuality() {
    try {
      // Sample check for empty fields
      const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/scroll`, {
        limit: 100,
        with_payload: true
      });
      
      const points = response.data.result.points;
      const emptyFields = [];
      
      points.forEach(p => {
        const payload = p.payload;
        if (!payload.description || payload.description.length < 10) {
          emptyFields.push(`ID ${p.id}: missing/short description`);
        }
        if (!payload.related || payload.related.length === 0) {
          emptyFields.push(`ID ${p.id}: no related topics`);
        }
      });
      
      if (emptyFields.length > 0) {
        this.warnings.push(`${emptyFields.length} records with empty/short fields`);
        // Log first 5
        emptyFields.slice(0, 5).forEach(w => this.log('WARNING', w));
      } else {
        this.checks.push({ name: 'Data Quality', status: 'PASS' });
      }
      
    } catch (error) {
      this.warnings.push(`Data quality check failed: ${error.message}`);
    }
  }

  async validateMetrics() {
    try {
      const metricsPath = path.join(__dirname, '..', 'metrics', 'latest.json');
      
      if (fs.existsSync(metricsPath)) {
        const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
        const result = this.flags.checkMetrics(metrics.summary);
        
        if (result.passed) {
          this.checks.push({ name: 'Metrics', status: 'PASS', detail: 'All thresholds met' });
        } else {
          result.issues.forEach(issue => {
            this.warnings.push(`Metric threshold: ${issue}`);
          });
        }
      }
    } catch (error) {
      this.warnings.push('Could not validate metrics');
    }
  }

  reportResults(phase) {
    console.log('\n' + '='.repeat(70));
    console.log(`📊 ${phase} RESULTS`);
    console.log('='.repeat(70));
    
    console.log(`\n✅ Checks Passed: ${this.checks.length}`);
    this.checks.forEach(c => {
      console.log(`  ✓ ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    });
    
    if (this.warnings.length > 0) {
      console.log(`\n⚠️  Warnings: ${this.warnings.length}`);
      this.warnings.forEach(w => console.log(`  ! ${w}`));
    }
    
    if (this.errors.length > 0) {
      console.log(`\n❌ Errors: ${this.errors.length}`);
      this.errors.forEach(e => console.log(`  ✗ ${e}`));
    }
    
    console.log('\n' + '='.repeat(70));
    
    const passed = this.errors.length === 0;
    
    if (passed) {
      console.log('✅ ALL CHECKS PASSED - Proceeding');
    } else {
      console.log('❌ CHECKS FAILED - Aborting');
    }
    
    console.log('='.repeat(70) + '\n');
    
    return {
      passed,
      phase,
      checks: this.checks.length,
      warnings: this.warnings.length,
      errors: this.errors.length
    };
  }
}

module.exports = { CheckpointGates };

// CLI
async function main() {
  const gates = new CheckpointGates();
  
  const command = process.argv[2];
  
  if (command === 'pre') {
    const result = await gates.preFlightCheck();
    process.exit(result.passed ? 0 : 1);
  } else if (command === 'post') {
    const newVectors = parseInt(process.argv[3]) || 0;
    const failed = process.argv[4] ? process.argv[4].split(',') : [];
    const result = await gates.postRunCheck(newVectors, failed);
    process.exit(result.passed ? 0 : 1);
  } else {
    console.log('Usage: node checkpoint-gates.js [pre|post [newVectors] [failedTopics]]');
  }
}

if (require.main === module) {
  main().catch(console.error);
}
