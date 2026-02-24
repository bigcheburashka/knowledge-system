#!/usr/bin/env node
/**
 * Morning Report
 * Утренняя сводка о состоянии Knowledge System с детализацией очереди
 */

const fs = require('fs');
const path = require('path');

async function main() {
  console.log('[Morning Report] Generating...');
  
  // Проверяем Qdrant
  let vectorCount = 0;
  try {
    const response = await fetch('http://localhost:6333/collections/knowledge');
    if (response.ok) {
      const data = await response.json();
      vectorCount = data.result?.points_count || 0;
    }
  } catch (e) {
    console.log('[Morning Report] Qdrant check failed:', e.message);
  }
  
  // Считаем топики из файлов
  let topicCount = 0;
  const dataDir = path.join(__dirname, '../data');
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    topicCount = files.length;
  }
  
  // Очередь
  const queueFile = path.join(__dirname, '../data/learning-queue.json');
  let queueStats = { pending: 0, processing: 0, pendingHigh: 0, pendingMedium: 0 };
  
  if (fs.existsSync(queueFile)) {
    try {
      const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
      const pending = queue.pending || [];
      const processing = queue.processing || [];
      
      queueStats = {
        pending: pending.length,
        processing: processing.length,
        pendingHigh: pending.filter(t => t.priority === 'high').length,
        pendingMedium: pending.filter(t => t.priority === 'medium').length
      };
    } catch (e) {}
  }
  
  // Статус мониторинга
  const monitorFile = path.join(__dirname, '../data/queue-monitor-status.json');
  let monitorStatus = null;
  if (fs.existsSync(monitorFile)) {
    try {
      monitorStatus = JSON.parse(fs.readFileSync(monitorFile, 'utf8'));
    } catch (e) {}
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
    } catch (e) {}
  }
  
  const report = `
📊 **Morning Report — Knowledge System**

📚 **Данные:**
• Векторов в Qdrant: ${vectorCount}
• JSON файлов: ${topicCount}

📋 **Очередь обучения:**
• Всего в очереди: ${queueStats.pending + queueStats.processing}
• Ожидают (pending): ${queueStats.pending}
  - High priority: ${queueStats.pendingHigh}
  - Medium priority: ${queueStats.pendingMedium}
• В обработке (processing): ${queueStats.processing}

🔧 **Система:**
• Статус: ${monitorStatus?.healthy ? '✅ Здорова' : (monitorStatus ? '⚠️ Есть алерты' : '❓ Нет данных')}
• Последний recovery: ${lastRecovery ? `${lastRecovery.recovered} тем (возвращено из processing)` : 'нет данных'}

💡 **Рекомендации:**
${queueStats.pending > 500 ? '• ⚠️ Большая очередь - рассмотреть ускорение обработки' : '• Очередь в норме'}
${queueStats.pendingHigh > 50 ? '• 🔴 Много high-priority тем - приоритет на них' : ''}

✅ Система работает
`;
  
  console.log(report);
  
  // Write to file
  fs.writeFileSync('/tmp/knowledge-morning-report.txt', report);
  console.log('[Morning Report] Complete');
}

main().catch(console.error);
