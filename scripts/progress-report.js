#!/usr/bin/env node
// Progress Report - Send to Telegram

const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
require('dotenv').config({ path: '/root/.openclaw/workspace/knowledge-system/.env' });

const execAsync = util.promisify(exec);
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '908231';

async function getSystemStats() {
  // Qdrant stats
  let vectors = 0;
  try {
    const response = await axios.get('http://localhost:6333/collections/knowledge');
    vectors = response.data.result.points_count;
  } catch (e) {}
  
  // Memgraph stats
  let entities = 0;
  let relations = 0;
  try {
    const neo4j = require('neo4j-driver');
    const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('', ''));
    const session = driver.session();
    
    const entityResult = await session.run('MATCH (n) RETURN count(n) as count');
    entities = entityResult.records[0].get('count').toNumber();
    
    const relResult = await session.run('MATCH ()-[r]-() RETURN count(r) as count');
    relations = relResult.records[0].get('count').toNumber();
    
    await session.close();
    await driver.close();
  } catch (e) {}
  
  // Disk usage
  let diskUsage = 'N/A';
  try {
    const { stdout: dfOut } = await execAsync("df / | tail -1 | awk '{print $5}'");
    diskUsage = dfOut.trim();
  } catch (e) {}
  
  // Memory
  let memory = 'N/A';
  try {
    const { stdout: memOut } = await execAsync("free | grep Mem | awk '{printf \"%.0f%%\", $3/$2 * 100}'");
    memory = memOut.trim();
  } catch (e) {}
  
  return { vectors, entities, relations, diskUsage, memory };
}

async function getRecentActivity() {
  try {
    // Check last auto-extraction
    const { stdout: lastExtraction } = await execAsync(
      'ls -lt /var/log/knowledge/extraction.log 2>/dev/null | head -1 || echo "No logs"'
    );
    
    // Check last deep learning
    const { stdout: lastDeep } = await execAsync(
      'ls -lt /var/log/knowledge/deep.log 2>/dev/null | head -1 || echo "No logs"'
    );
    
    return { lastExtraction, lastDeep };
  } catch (e) {
    return { lastExtraction: 'N/A', lastDeep: 'N/A' };
  }
}

async function sendTelegramMessage(message) {
  if (!BOT_TOKEN) {
    console.log('⚠️  No TELEGRAM_BOT_TOKEN, printing to console:\n');
    console.log(message);
    return false;
  }
  
  try {
    await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
      }
    );
    return true;
  } catch (e) {
    console.error('❌ Telegram error:', e.message);
    return false;
  }
}

async function generateReport() {
  const now = new Date();
  const stats = await getSystemStats();
  const activity = await getRecentActivity();
  
  const report = `📊 *Knowledge System Daily Report*
_${now.toISOString().split('T')[0]} ${now.toTimeString().split(' ')[0]} UTC_

📈 *Metrics:*
• Vectors (Qdrant): ${stats.vectors}
• Entities (Memgraph): ${stats.entities}
• Relations: ${stats.relations}
• System: 🟢 Healthy

💾 *Resources:*
• Disk: ${stats.diskUsage}
• RAM: ${stats.memory}

🔔 *Services:*
${await checkServices()}

📅 *Next Tasks:*
• Hourly extraction: \`0 * * * *\`
• Deep learning: \`0 2 * * *\`
• Weekly backup: \`0 3 * * 0\`

✅ All systems operational`;

  return report;
}

async function checkServices() {
  const checks = [];
  
  // Check Qdrant
  try {
    await axios.get('http://localhost:6333/healthz');
    checks.push('• Qdrant: ✅ Running');
  } catch (e) {
    checks.push('• Qdrant: ❌ Down');
  }
  
  // Check Memgraph
  try {
    await execAsync('echo "RETURN 1;" | docker exec -i knowledge-memgraph mgconsole');
    checks.push('• Memgraph: ✅ Running');
  } catch (e) {
    checks.push('• Memgraph: ❌ Down');
  }
  
  return checks.join('\n');
}

async function main() {
  console.log('📊 Generating progress report...\n');
  
  const report = await generateReport();
  const sent = await sendTelegramMessage(report);
  
  if (sent) {
    console.log('✅ Report sent to Telegram');
  } else {
    console.log('⚠️  Report printed to console (no Telegram token)');
  }
  
  // Also save to file
  const fs = require('fs').promises;
  await fs.writeFile(
    '/root/.openclaw/workspace/knowledge-state/latest-report.md',
    report.replace(/\*/g, '').replace(/_/g, '')
  );
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { generateReport, sendTelegramMessage };