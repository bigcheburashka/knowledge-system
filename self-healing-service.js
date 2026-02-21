#!/usr/bin/env node
/**
 * Self-Healing Book Processing Service
 * P1 Improvements: Health monitoring, resource limits, auto-restart
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const CONFIG = {
  WORKER_SCRIPT: './process-books-improved.js',
  CHECKPOINT_FILE: '/var/log/knowledge/book-checkpoint.json',
  HEALTH_LOG: '/var/log/knowledge/health-monitor.log',
  MAX_MEMORY_MB: 2048, // 2GB limit
  MAX_CPU_PERCENT: 80,
  HEALTH_CHECK_INTERVAL: 30 * 1000, // 30 seconds
  STALL_TIMEOUT: 5 * 60 * 1000, // 5 minutes without progress = stalled
  MAX_RESTARTS: 5,
  RESTART_COOLDOWN: 60 * 1000 // 1 minute between restarts
};

/**
 * Health Monitor - watches worker process
 */
class HealthMonitor {
  constructor() {
    this.worker = null;
    this.restartCount = 0;
    this.lastProgressTime = Date.now();
    this.lastCheckpointCount = 0;
    this.isRunning = false;
  }

  async log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}\n`;
    console.log(line.trim());
    await fs.appendFile(CONFIG.HEALTH_LOG, line).catch(() => {});
  }

  async getCheckpointStats() {
    try {
      const data = await fs.readFile(CONFIG.CHECKPOINT_FILE, 'utf8');
      const checkpoint = JSON.parse(data);
      return {
        completed: checkpoint.completed?.length || 0,
        failed: checkpoint.failed?.length || 0,
        lastUpdate: checkpoint.lastUpdate
      };
    } catch (e) {
      return { completed: 0, failed: 0, lastUpdate: null };
    }
  }

  async getProcessStats(pid) {
    try {
      // Get memory usage
      const memData = await fs.readFile(`/proc/${pid}/status`, 'utf8');
      const vmRSS = memData.match(/VmRSS:\s+(\d+)/)?.[1];
      const memoryMB = vmRSS ? parseInt(vmRSS) / 1024 : 0;

      // Get CPU usage (simplified)
      const statData = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      const utime = statData.split(' ')[13];
      const stime = statData.split(' ')[14];
      
      return { memoryMB, pid };
    } catch (e) {
      return null;
    }
  }

  checkStall(currentStats) {
    const totalProcessed = currentStats.completed + currentStats.failed;
    
    if (totalProcessed > this.lastCheckpointCount) {
      // Progress made
      this.lastCheckpointCount = totalProcessed;
      this.lastProgressTime = Date.now();
      return false;
    }

    // No progress check
    const timeSinceProgress = Date.now() - this.lastProgressTime;
    if (timeSinceProgress > CONFIG.STALL_TIMEOUT) {
      return true;
    }

    return false;
  }

  checkMemory(stats) {
    if (!stats) return false;
    return stats.memoryMB > CONFIG.MAX_MEMORY_MB;
  }

  async startWorker() {
    if (this.restartCount >= CONFIG.MAX_RESTARTS) {
      await this.log(`❌ Max restarts (${CONFIG.MAX_RESTARTS}) reached. Giving up.`, 'ERROR');
      process.exit(1);
    }

    this.restartCount++;
    await this.log(`🚀 Starting worker (restart #${this.restartCount})...`);

    this.worker = spawn('node', [CONFIG.WORKER_SCRIPT], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.worker.stdout.on('data', (data) => {
      process.stdout.write(data);
    });

    this.worker.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    this.worker.on('exit', async (code, signal) => {
      if (!this.isRunning) return;
      
      await this.log(`⚠️ Worker exited (code: ${code}, signal: ${signal})`);
      
      if (this.isRunning) {
        await this.log(`⏳ Waiting ${CONFIG.RESTART_COOLDOWN / 1000}s before restart...`);
        await new Promise(r => setTimeout(r, CONFIG.RESTART_COOLDOWN));
        await this.startWorker();
      }
    });

    return this.worker.pid;
  }

  async stopWorker() {
    if (!this.worker) return;
    
    await this.log('🛑 Stopping worker...');
    this.isRunning = false;
    
    // Graceful shutdown
    this.worker.kill('SIGTERM');
    
    // Force kill after 10 seconds
    await new Promise(r => setTimeout(r, 10000));
    if (!this.worker.killed) {
      this.worker.kill('SIGKILL');
    }
  }

  async healthCheck() {
    if (!this.worker || !this.isRunning) return;

    const stats = await this.getCheckpointStats();
    const procStats = await this.getProcessStats(this.worker.pid);

    await this.log(
      `💓 Health check: ${stats.completed} completed, ${stats.failed} failed` +
      (procStats ? `, Memory: ${procStats.memoryMB.toFixed(0)}MB` : '')
    );

    // Check for stall
    if (this.checkStall(stats)) {
      await this.log('🚨 STALL DETECTED! No progress for 5 minutes.', 'WARN');
      await this.stopWorker();
      await this.log('♻️ Restarting due to stall...');
      await this.startWorker();
      return;
    }

    // Check memory
    if (this.checkMemory(procStats)) {
      await this.log(`🚨 MEMORY LIMIT EXCEEDED! ${procStats.memoryMB.toFixed(0)}MB > ${CONFIG.MAX_MEMORY_MB}MB`, 'WARN');
      await this.stopWorker();
      await this.log('♻️ Restarting due to memory limit...');
      await this.startWorker();
      return;
    }
  }

  async start() {
    await this.log('='.repeat(70));
    await this.log('🛡️ SELF-HEALING BOOK PROCESSING SERVICE');
    await this.log('   Features: Health monitoring | Resource limits | Auto-restart');
    await this.log('='.repeat(70));

    this.isRunning = true;

    // Start initial worker
    const pid = await this.startWorker();
    await this.log(`✅ Worker started with PID: ${pid}`);

    // Start health monitoring
    setInterval(() => this.healthCheck(), CONFIG.HEALTH_CHECK_INTERVAL);

    // Graceful shutdown handling
    process.on('SIGINT', async () => {
      await this.log('👋 Received SIGINT, shutting down...');
      await this.stopWorker();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.log('👋 Received SIGTERM, shutting down...');
      await this.stopWorker();
      process.exit(0);
    });

    await this.log('💓 Health monitoring started (30s interval)');
    await this.log('⏳ Service is running. Press Ctrl+C to stop.');
  }
}

// Start the service
const monitor = new HealthMonitor();
monitor.start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
