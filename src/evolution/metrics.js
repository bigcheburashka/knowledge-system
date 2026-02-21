/**
 * Metrics collection for Self-Evolution System
 */

const fs = require('fs').promises;
const path = require('path');

class EvolutionMetrics {
  constructor(options = {}) {
    this.basePath = options.basePath || '/var/lib/knowledge/logs';
    this.metricsPath = path.join(this.basePath, 'metrics.json');
    this.counters = new Map();
    this.gauges = new Map();
    this.timers = new Map();
  }

  async init() {
    await fs.mkdir(this.basePath, { recursive: true });
    
    // Load existing metrics
    try {
      const content = await fs.readFile(this.metricsPath, 'utf8');
      const data = JSON.parse(content);
      this.counters = new Map(Object.entries(data.counters || {}));
      this.gauges = new Map(Object.entries(data.gauges || {}));
      this.timers = new Map(Object.entries(data.timers || {}));
    } catch {
      // Start fresh
    }
  }

  // Counter: monotonically increasing values
  increment(counter, value = 1) {
    const current = this.counters.get(counter) || 0;
    this.counters.set(counter, current + value);
    this.scheduleSave();
  }

  // Gauge: values that go up and down
  gauge(name, value) {
    this.gauges.set(name, {
      value,
      timestamp: Date.now()
    });
    this.scheduleSave();
  }

  // Timer: duration measurements
  timer(name, duration) {
    if (!this.timers.has(name)) {
      this.timers.set(name, { count: 0, total: 0, min: Infinity, max: 0 });
    }
    
    const timer = this.timers.get(name);
    timer.count++;
    timer.total += duration;
    timer.min = Math.min(timer.min, duration);
    timer.max = Math.max(timer.max, duration);
    
    this.scheduleSave();
  }

  // Time a function execution
  async time(name, fn) {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.timer(name, Date.now() - start);
    }
  }

  // Get current metrics
  getMetrics() {
    const timers = {};
    for (const [name, data] of this.timers) {
      timers[name] = {
        count: data.count,
        avg: data.count > 0 ? data.total / data.count : 0,
        min: data.min === Infinity ? 0 : data.min,
        max: data.max
      };
    }
    
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(
        Array.from(this.gauges).map(([k, v]) => [k, v.value])
      ),
      timers,
      timestamp: new Date().toISOString()
    };
  }

  // Check for alerts
  checkAlerts() {
    const alerts = [];
    const metrics = this.getMetrics();
    
    // Alert if too many pending proposals
    if (metrics.gauges.pending_proposals > 10) {
      alerts.push({
        level: 'warning',
        message: `High number of pending proposals: ${metrics.gauges.pending_proposals}`,
        metric: 'pending_proposals'
      });
    }
    
    // Alert if approval rate is low
    const approved = metrics.counters.proposals_approved || 0;
    const rejected = metrics.counters.proposals_rejected || 0;
    const total = approved + rejected;
    
    if (total > 10 && approved / total < 0.5) {
      alerts.push({
        level: 'warning',
        message: `Low approval rate: ${(approved/total*100).toFixed(1)}%`,
        metric: 'approval_rate'
      });
    }
    
    // Alert if avg decision time is high
    const decisionTime = metrics.timers.approval_decision;
    if (decisionTime && decisionTime.avg > 86400000) { // > 1 day
      alerts.push({
        level: 'warning',
        message: `Slow approval decisions: ${(decisionTime.avg/3600000).toFixed(1)}h avg`,
        metric: 'decision_time'
      });
    }
    
    return alerts;
  }

  // Save metrics to file
  async save() {
    const data = this.getMetrics();
    const tempPath = this.metricsPath + '.tmp';
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
    await fs.rename(tempPath, this.metricsPath);
  }

  // Debounced save
  scheduleSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => this.save(), 5000);
  }

  // Get metrics report for display
  getReport() {
    const metrics = this.getMetrics();
    
    return {
      summary: {
        proposalsToday: metrics.counters.proposals_today || 0,
        approvedTotal: metrics.counters.proposals_approved || 0,
        rejectedTotal: metrics.counters.proposals_rejected || 0,
        pendingNow: metrics.gauges.pending_proposals || 0
      },
      performance: {
        avgDecisionTime: metrics.timers.approval_decision?.avg || 0,
        avgApplyTime: metrics.timers.change_apply?.avg || 0
      },
      alerts: this.checkAlerts(),
      lastUpdated: metrics.timestamp
    };
  }
}

module.exports = { EvolutionMetrics };
