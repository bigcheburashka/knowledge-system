#!/usr/bin/env node
/**
 * Queue Monitor with Alerts
 * Мониторинг очередей с алертами при проблемах
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'learning-queue.json');
const CUSTOM_TOPICS_FILE = path.join(__dirname, '..', 'custom-topics.json');

// Alert thresholds
const THRESHOLDS = {
  pendingTotal: 1000,     // Alert if > 1000 pending
  pendingHigh: 200,       // Alert if > 200 high priority pending
  processingStuck: 50,    // Alert if > 50 in processing (potential stuck)
  noSyncHours: 3          // Alert if no sync for 3 hours
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
  console.log('=== QUEUE MONITOR ===\n');
  
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
  
  // Stats by source
  const pendingBySource = {};
  for (const t of pending) {
    const s = t.source || 'unknown';
    pendingBySource[s] = (pendingBySource[s] || 0) + 1;
  }
  
  // Processing stats
  const processingOld = processing.filter(t => {
    if (!t.startedAt) return true;
    const hours = (Date.now() - new Date(t.startedAt).getTime()) / 3600000;
    return hours > 2; // Processing for more than 2 hours
  });
  
  // Check for sync activity
  const syncLogFile = path.join(DATA_DIR, 'sync-log.jsonl');
  let lastSync = null;
  if (fs.existsSync(syncLogFile)) {
    const lines = fs.readFileSync(syncLogFile, 'utf8').trim().split('\n');
    if (lines.length > 0) {
      try {
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        lastSync = new Date(lastEntry.timestamp);
      } catch (e) {}
    }
  }
  
  const hoursSinceSync = lastSync ? (Date.now() - lastSync.getTime()) / 3600000 : null;
  
  // Build report
  let hasAlerts = false;
  const alerts = [];
  
  console.log(`📊 Queue Status:`);
  console.log(`  Pending: ${pending.length}`);
  console.log(`  Processing: ${processing.length} (${processingOld.length} old >2h)`);
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
  
  console.log(`📋 Pending by source (top 5):`);
  const sortedSources = Object.entries(pendingBySource).sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [s, c] of sortedSources) {
    console.log(`  - ${s}: ${c}`);
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
    alerts: hasAlerts ? alerts : [],
    healthy: !hasAlerts
  };
  fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
  
  if (hasAlerts) {
    console.log(`\n⚠️  ${alerts.length} ALERTS FOUND`);
    // Write to alert file for Telegram notification
    const alertFile = path.join(DATA_DIR, 'queue-alerts.json');
    fs.writeFileSync(alertFile, JSON.stringify({ alerts, timestamp: new Date().toISOString() }, null, 2));
    process.exit(1);
  } else {
    console.log(`\n✅ All systems healthy`);
    process.exit(0);
  }
}

main();
