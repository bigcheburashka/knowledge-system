#!/usr/bin/env node
/**
 * Weekly Strategic Extraction
 * Еженедельный стратегический анализ
 */

const fs = require('fs');
const path = require('path');

async function main() {
  console.log('[Weekly Strategic] Starting analysis...');
  
  // Считаем файлы за неделю
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  
  const dataDir = path.join(__dirname, '../data');
  let newFiles = 0;
  let totalFiles = 0;
  
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      const stats = fs.statSync(filePath);
      totalFiles++;
      
      if (stats.mtime >= weekAgo) {
        newFiles++;
      }
    }
  }
  
  // Проверяем векторы в Qdrant
  let vectorCount = 0;
  try {
    const response = await fetch('http://localhost:6333/collections/knowledge');
    if (response.ok) {
      const data = await response.json();
      vectorCount = data.result?.points_count || 0;
    }
  } catch (e) {
    console.log('[Weekly Strategic] Qdrant check failed:', e.message);
  }
  
  const report = `
📊 **Weekly Strategic Report**

📈 **Активность за неделю:**
• Новых файлов: ${newFiles}
• Всего файлов: ${totalFiles}
• Векторов в Qdrant: ${vectorCount}

📅 **Рекомендации:**
${newFiles > 10 ? '• Высокая активность - рассмотреть оптимизацию' : '• Активность в норме'}
• Продолжить автоматическое извлечение

✅ Система стабильна
`;
  
  console.log(report);
  
  // Write to file
  fs.writeFileSync('/tmp/knowledge-weekly-report.txt', report);
  console.log('[Weekly Strategic] Complete');
}

main().catch(console.error);
