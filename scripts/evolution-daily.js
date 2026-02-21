#!/usr/bin/env node
/**
 * Evolution Daily - Daily analysis and maintenance
 * Runs via systemd timer at 2 AM
 */

const { LearningLog } = require('../src/evolution/learning-log');
const { ApprovalManager } = require('../src/evolution/approval-manager');

let isShuttingDown = false;

// Graceful shutdown handlers
process.on('SIGTERM', () => {
  console.log('[Evolution] SIGTERM received, shutting down gracefully...');
  isShuttingDown = true;
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Evolution] SIGINT received, shutting down gracefully...');
  isShuttingDown = true;
  process.exit(0);
});

// Retry wrapper for async operations
async function withRetry(fn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const delay = options.delay || 1000;
  const operation = options.operation || 'operation';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (isShuttingDown) {
        throw new Error('Shutdown in progress');
      }
      
      return await fn();
    } catch (err) {
      console.error(`[Evolution] ${operation} failed (attempt ${attempt}/${maxRetries}):`, err.message);
      
      if (attempt === maxRetries) {
        throw err;
      }
      
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
}

async function dailyEvolution() {
  console.log('[Evolution] Daily analysis started:', new Date().toISOString());
  
  const log = new LearningLog();
  await log.init();
  
  const approval = new ApprovalManager();
  await withRetry(() => approval.init(), { operation: 'approval.init' });
  
  let report = {
    timestamp: new Date().toISOString(),
    entriesProcessed: 0,
    pendingProposals: 0,
    logsCleaned: 0,
    errors: []
  };
  
  try {
    // 1. Cleanup old logs (keep 30 days)
    console.log('[Evolution] Cleaning up old logs...');
    const cleanupResult = await withRetry(
      () => log.cleanup(30),
      { operation: 'log.cleanup', maxRetries: 2 }
    );
    report.logsCleaned = cleanupResult.cleaned;
    console.log(`[Evolution] Cleaned ${cleanupResult.cleaned} old log files`);
    
    // 2. Get recent activity
    console.log('[Evolution] Analyzing recent activity...');
    const recent = await withRetry(
      () => log.getRecent(1),
      { operation: 'log.getRecent' }
    );
    report.entriesProcessed = recent.length;
    console.log(`[Evolution] Found ${recent.length} entries in last 24h`);
    
    // 3. Retry failed Telegram notifications
    console.log('[Evolution] Retrying failed Telegram notifications...');
    await withRetry(
      () => approval.retryFailedTelegrams(),
      { operation: 'retryFailedTelegrams', maxRetries: 2 }
    );
    
    // 4. List pending approvals
    const pending = await withRetry(
      () => approval.pending.list({ status: 'pending' }),
      { operation: 'pending.list' }
    );
    report.pendingProposals = pending.length;
    console.log(`[Evolution] ${pending.length} proposals pending approval`);
    
    // 5. Generate daily report
    await log.record({
      type: 'daily_analysis',
      ...report
    });
    
    console.log('[Evolution] Daily analysis complete:', report);
    
    // Exit successfully for systemd
    process.exit(0);
    
  } catch (err) {
    console.error('[Evolution] Daily analysis failed:', err.message);
    report.errors.push({ message: err.message, stack: err.stack });
    
    await log.record({
      type: 'daily_analysis_failed',
      ...report
    });
    
    process.exit(1);
  }
}

// Run with global error handling
dailyEvolution().catch(err => {
  console.error('[Evolution] Uncaught error:', err);
  process.exit(1);
});
