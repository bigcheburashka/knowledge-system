const fs = require('fs').promises;
const path = require('path');

/**
 * Health Monitor - filesystem-based heartbeat monitoring
 */
class HealthMonitor {
  constructor(options = {}) {
    this.heartbeatPath = options.heartbeatPath || '/knowledge-system/heartbeats';
    this.heartbeatInterval = options.heartbeatInterval || 5000; // 5 seconds
    this.timeout = options.timeout || 15000; // 15 seconds = 3 missed heartbeats
    this.intervals = new Map();
  }

  /**
   * Initialize heartbeat directory
   */
  async init() {
    await fs.mkdir(this.heartbeatPath, { recursive: true });
  }

  /**
   * Start heartbeat for an agent
   */
  async start(agentType) {
    await this.init();
    
    // Clear any existing interval
    if (this.intervals.has(agentType)) {
      clearInterval(this.intervals.get(agentType));
    }
    
    // Write initial heartbeat
    await this.writeHeartbeat(agentType);
    
    // Set up periodic heartbeat
    const interval = setInterval(async () => {
      try {
        await this.writeHeartbeat(agentType);
      } catch (err) {
        console.error(`[HealthMonitor] Failed to write heartbeat for ${agentType}:`, err.message);
      }
    }, this.heartbeatInterval);
    
    this.intervals.set(agentType, interval);
    
    console.log(`[HealthMonitor] Started monitoring for ${agentType}`);
  }

  /**
   * Write heartbeat file
   */
  async writeHeartbeat(agentType) {
    const heartbeat = {
      agent: agentType,
      timestamp: Date.now(),
      pid: process.pid
    };
    
    const filePath = path.join(this.heartbeatPath, `${agentType}.hb`);
    await fs.writeFile(filePath, JSON.stringify(heartbeat));
  }

  /**
   * Check health of specific agent
   */
  async check(agentType) {
    try {
      const filePath = path.join(this.heartbeatPath, `${agentType}.hb`);
      const data = await fs.readFile(filePath, 'utf8');
      const heartbeat = JSON.parse(data);
      
      const age = Date.now() - heartbeat.timestamp;
      
      if (age < this.timeout) {
        return {
          status: 'alive',
          agent: agentType,
          age: age,
          pid: heartbeat.pid
        };
      } else {
        return {
          status: 'dead',
          agent: agentType,
          age: age,
          reason: 'timeout',
          lastHeartbeat: heartbeat.timestamp
        };
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        return {
          status: 'dead',
          agent: agentType,
          reason: 'no_heartbeat_file'
        };
      }
      
      return {
        status: 'error',
        agent: agentType,
        reason: err.message
      };
    }
  }

  /**
   * Check all agents
   */
  async checkAll(agentTypes = ['research', 'factcheck', 'quality', 'composer']) {
    const results = {};
    
    for (const type of agentTypes) {
      results[type] = await this.check(type);
    }
    
    return results;
  }

  /**
   * Stop monitoring an agent
   */
  stop(agentType) {
    if (this.intervals.has(agentType)) {
      clearInterval(this.intervals.get(agentType));
      this.intervals.delete(agentType);
      console.log(`[HealthMonitor] Stopped monitoring for ${agentType}`);
    }
  }

  /**
   * Stop all monitoring
   */
  stopAll() {
    for (const [agentType, interval] of this.intervals) {
      clearInterval(interval);
      console.log(`[HealthMonitor] Stopped monitoring for ${agentType}`);
    }
    this.intervals.clear();
  }

  /**
   * Get last heartbeat time
   */
  async getLastHeartbeat(agentType) {
    try {
      const filePath = path.join(this.heartbeatPath, `${agentType}.hb`);
      const data = await fs.readFile(filePath, 'utf8');
      const heartbeat = JSON.parse(data);
      return heartbeat.timestamp;
    } catch {
      return null;
    }
  }

  /**
   * List all monitored agents
   */
  listMonitored() {
    return Array.from(this.intervals.keys());
  }
}

module.exports = { HealthMonitor };

// CLI test
if (require.main === module) {
  async function test() {
    const monitor = new HealthMonitor();
    
    // Start monitoring test agent
    await monitor.start('test-agent');
    
    // Check health
    const health1 = await monitor.check('test-agent');
    console.log('Health (should be alive):', health1);
    
    // Wait and check again
    await new Promise(r => setTimeout(r, 1000));
    const health2 = await monitor.check('test-agent');
    console.log('Health after 1s:', health2);
    
    // Stop
    monitor.stop('test-agent');
    console.log('Test complete');
  }
  
  test().catch(console.error);
}
