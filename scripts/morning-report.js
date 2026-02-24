#!/usr/bin/env node
/**
 * Morning Report v2 with Quality Metrics
 * Утренняя сводка с метриками качества proposals
 */

const fs = require('fs');
const path = require('path');

async function main() {
  console.log('[Morning Report] Generating...');
  
  // Qdrant stats
  let vectorCount = 0;
  try {
    const response = await fetch('http://localhost:6333/collections/knowledge');
    if (response.ok) {
      const data = await response.json();
      vectorCount = data.result?.points_count || 0;
    }
  } catch (e) {}
  
  // Queue stats
  const queueFile = path.join(__dirname, '../data/learning-queue.json');
  let queueStats = { pending: 0, processing: 0, pendingHigh: 0, pendingMedium: 0 };
  
  if (fs.existsSync(queueFile)) {
    try {
      const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
      const pending = queue.pending || [];
      queueStats = {
        pending: pending.length,
        processing: (queue.processing || []).length,
        pendingHigh: pending.filter(t => t.priority === 'high').length,
        pendingMedium: pending.filter(t => t.priority === 'medium').length
      };
    } catch (e) {}
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
  
  // Recovery log
  const recoveryLogFile = path.join(__dirname, '../data/recovery-log.jsonl');
  let lastRecovery = null;
  if (fs.existsSync(recoveryLogFile)) {
    try {
      const lines = fs.readFileSync(recoveryLogFile, 'utf8').trim().split('\n').filter(l => l);
      if (lines.length > 0) {
        lastRecovery = JSON.parse(lines[lines.length - 1]);
      }
    } catch {}
  }
  
  // Sync log
  const syncLogFile = path.join(__dirname, '../data/sync-log.jsonl');
  let lastSync = null;
  if (fs.existsSync(syncLogFile)) {
    try {
      const lines = fs.readFileSync(syncLogFile, 'utf8').trim().split('\n').filter(l => l);
      if (lines.length > 0) {
        lastSync = JSON.parse(lines[lines.length - 1]);
      }
    } catch {}
  }
  
  const report = `
📊 **Morning Report — Knowledge System**

📚 **Данные:**
• Векторов в Qdrant: ${vectorCount}

📋 **Очередь обучения:**
• Ожидают: ${queueStats.pending} (High: ${queueStats.pendingHigh}, Medium: ${queueStats.pendingMedium})
• В обработке: ${queueStats.processing}

🎯 **Proposals (Self-Evolution):**
• Всего создано: ${proposalStats.total}
• Ожидают approval: ${proposalStats.pending}
• Одобрено: ${proposalStats.approved}
• Отклонено (качество): ${proposalStats.rejected}

🔧 **Система:**
• Последний sync: ${lastSync ? lastSync.timestamp.split('T')[1].split('.')[0] : 'нет данных'}
• Последний recovery: ${lastRecovery ? `${lastRecovery.recovered} тем` : 'нет данных'}

💡 **Качество:**
${proposalStats.rejected > proposalStats.approved ? '⚠️ Много отклонённых proposals - проверить генератор' : '✅ Качество proposals в норме'}

✅ Система работает
`;
  
  console.log(report);
  fs.writeFileSync('/tmp/knowledge-morning-report.txt', report);
}

main().catch(console.error);
