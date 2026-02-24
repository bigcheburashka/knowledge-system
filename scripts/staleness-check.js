#!/usr/bin/env node
/**
 * Staleness Check
 * Проверяет устаревшие данные и помечает их для обновления
 */

const fs = require('fs');
const path = require('path');

async function main() {
  console.log('[Staleness Check] Starting...');
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  // Проверяем JSON файлы в data/
  const dataDir = path.join(__dirname, '../data');
  let staleCount = 0;
  let totalCount = 0;
  
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json') && !f.includes('queue') && !f.includes('frequency'));
    
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      const stats = fs.statSync(filePath);
      totalCount++;
      
      if (stats.mtime < thirtyDaysAgo) {
        staleCount++;
        console.log(`[Staleness Check] Stale file: ${file} (last modified: ${stats.mtime.toISOString()})`);
      }
    }
  }
  
  console.log(`[Staleness Check] Found ${staleCount} stale files out of ${totalCount} total`);
  console.log('[Staleness Check] Complete');
  
  // Write status
  const statusFile = path.join(__dirname, '../data/staleness-check-status.json');
  fs.writeFileSync(statusFile, JSON.stringify({
    lastRun: new Date().toISOString(),
    staleCount,
    totalCount
  }, null, 2));
}

main().catch(console.error);
