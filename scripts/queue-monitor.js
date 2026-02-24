#!/usr/bin/env node
/**
 * Queue Monitor v2 with Quality Metrics
 * Мониторинг очередей с алертами и метриками качества
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const QUEUE_FILE = path.join(DATA_DIR, 'learning-queue.json');
const CUSTOM_TOPICS_FILE = path.join(__dirname, '../custom-topics.json');

// Alert thresholds
const THRESHOLDS = {
  pendingTotal: 1000,
  pendingHigh: 200,
  processingStuck: 50,
  noSyncHours: 3,
  rejectedRatio: 0.7 // Alert if >70% proposals rejected
};

function loadJSON(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function main() {
  console.log('=== QUEUE MONITOR v2 ===\n');
  
  const queue = loadJSON(QUEUE_FILE) || { pending: [], processing: [] };
  const topics = loadJSON(CUSTOM_TOPICS_FILE) || { topics: [] };
  
  const pending = queue.pending || [];
  const processing = queue.processing || [];
  
  // Stats by priority
  const pendingByPriority = {};
  for (const t of pending) {
    const p = t.priority || 'unknown';
    pendingByPriority[p] = (pendingByPriority[p] || 0) + 1;
  }
  
  // Proposals quality stats
  const queueLogFile = '/var/lib/knowledge/logs/approval-queue.jsonl';
  let proposalStats = { pending: 0, approved: 0, rejected: 0, total: 0 };
  
  if (fs.existsSync(queueLogFile)) {
    try {
      const lines = fs.readFileSync(queueLogFile, 'utf8').trim().split('\n').filter(l => l);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          proposalStats.total++;
          if (item.status === 'pending') proposalStats.pending++;
          else if (item.status === 'approved') proposalStats.approved++;
          else if (item.status === 'rejected') proposalStats.rejected++;
        } catch {}
      }
    } catch {}
  }
  
  // Processing stats
  const processingOld = processing.filter(t => {
    if (!t.startedAt) return true;
    const hours = (Date.now() - new Date(t.startedAt).getTime()) / 3600000;
    return hours > 2;
  });
  
  // Check for sync activity
  const syncLogFile = path.join(DATA_DIR, 'sync-log.jsonl');
  let lastSync = null;
  if (fs.existsSync(syncLogFile)) {
    try {
      const lines = fs.readFileSync(syncLogFile, 'utf8').trim().split('\n').filter(l => l);
      if (lines.length > 0) {
        lastSync = new Date(JSON.parse(lines[lines.length - 1]).timestamp);
      }
    } catch {}
  }
  
  const hoursSinceSync = lastSync ? (Date.now() - lastSync.getTime()) / 3600000 : null;
  const rejectedRatio = proposalStats.total > 0 ? proposalStats.rejected / proposalStats.total : 0;
  
  // Build report
  let hasAlerts = false;
  const alerts = [];
  
  console.log(`📊 Queue Status:`);
  console.log(`  Pending: ${pending.length}`);
  console.log(`  Processing: ${processing.length} (${processingOld.length} stuck >2h)`);
  console.log(`  Custom topics: ${topics.topics?.length || 0}`);
  console.log();
  
  console.log(`📋 Pending by priority:`);
  for (const [p, c] of Object.entries(pendingByPriority).sort((a, b) => b[1] - a[1])) {
    const alert = p === 'high' && c > THRESHOLDS.pendingHigh;
    console.log(`  ${alert ? '🔴' : '  '} ${p}: ${c}${alert ? ' (ALERT!)' : ''}`);
    if (alert) {
      hasAlerts = true;
      alerts.push(`High priority queue high: ${c}`);
    }
  }
  console.log();
  
  console.log(`🎯 Proposals Quality:`);
  console.log(`  Total: ${proposalStats.total}`);
  console.log(`  Approved: ${proposalStats.approved} ✅`);
  console.log(`  Rejected: ${proposalStats.rejected} ❌`);
  console.log(`  Pending: ${proposalStats.pending} ⏳`);
  console.log(`  Rejected ratio: ${(rejectedRatio * 100).toFixed(1)}%`);
  
  if (rejectedRatio > THRESHOLDS.rejectedRatio) {
    hasAlerts = true;
    alerts.push(`High rejection ratio: ${(rejectedRatio * 100).toFixed(1)}% - check skill generator`);
    console.log(`  🔴 ALERT: Too many rejected proposals!`);
  }
  console.log();
  
  // Check thresholds
  if (pending.length > THRESHOLDS.pendingTotal) {
    hasAlerts = true;
    alerts.push(`Total pending too high: ${pending.length}`);
    console.log(`🔴 ALERT: Total pending ${pending.length} > ${THRESHOLDS.pendingTotal}`);
  }
  
  if (processingOld.length > THRESHOLDS.processingStuck) {
    hasAlerts = true;
    alerts.push(`Many stuck in processing: ${processingOld.length}`);
    console.log(`🔴 ALERT: ${processingOld.length} topics stuck in processing >2h`);
  }
  
  if (hoursSinceSync !== null && hoursSinceSync > THRESHOLDS.noSyncHours) {
    hasAlerts = true;
    alerts.push(`No sync for ${Math.round(hoursSinceSync)}h`);
    console.log(`🔴 ALERT: No sync for ${Math.round(hoursSinceSync)}h`);
  }
  
  // Save status
  const statusFile = path.join(DATA_DIR, 'queue-monitor-status.json');
  const status = {
    timestamp: new Date().toISOString(),
    pending: pending.length,
    processing: processing.length,
    processingOld: processingOld.length,
    pendingByPriority,
    proposals: proposalStats,
    rejectedRatio,
    alerts: hasAlerts ? alerts : [],
    healthy: !hasAlerts
  };
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  
  if (hasAlerts) {
    console.log(`\n⚠️  ${alerts.length} ALERTS FOUND`);
    const alertFile = path.join(DATA_DIR, 'queue-alerts.json');
    fs.writeFileSync(alertFile, JSON.stringify({ alerts, timestamp: new Date().toISOString() }, null, 2));
    process.exit(1);
  } else {
    console.log(`\n✅ All systems healthy`);
    process.exit(0);
  }
}

main();
