#!/bin/bash
# Weekly Strategic Knowledge Extraction
# Runs on Sundays at 6:00 AM MSK
# Extracts patterns, strategies, and meta-insights from the week's sessions

KNOWLEDGE_DIR="/root/.openclaw/workspace/knowledge-system"
LOG_DIR="/var/log/knowledge"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting weekly strategic extraction"

# Generate comprehensive weekly report
cd "$KNOWLEDGE_DIR" && node -e "
const fs = require('fs');
const path = require('path');

async function generateWeeklyReport() {
  console.log('📊 Generating Weekly Strategic Report...\n');
  
  // Read knowledge stats
  const qdrantStats = await fetch('http://localhost:6333/collections/knowledge')
    .then(r => r.json())
    .catch(() => ({ result: { points_count: 'N/A' } }));
  
  // Count proposals
  const pendingFile = path.join('$LOG_DIR', 'pending-proposals.json');
  let pendingCount = 0;
  try {
    const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
    pendingCount = Object.keys(pending).length;
  } catch {}
  
  // Count new entries this week
  const now = new Date();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  
  console.log('🎯 Weekly Strategic Summary');
  console.log('===========================');
  console.log(\`• Total vectors: \${qdrantStats.result?.points_count || 'N/A'}\`);
  console.log(\`• Pending proposals: \${pendingCount}\`);
  console.log(\`• Week period: \${weekAgo.toISOString().split('T')[0]} to \${now.toISOString().split('T')[0]}\`);
  console.log('');
  console.log('📈 Key Insights to Review:');
  console.log('• Most frequently mentioned technologies');
  console.log('• Recurring problems and solutions');
  console.log('• Skill gaps requiring new learning');
  console.log('• System improvement opportunities');
  console.log('');
  console.log('🔄 Recommended Actions:');
  if (pendingCount > 5) {
    console.log(\`• Review and approve \${pendingCount} pending proposals\`);
  }
  console.log('• Analyze top 10 recurring patterns');
  console.log('• Update priority topics for next week');
  console.log('• Review knowledge freshness (staleness report)');
}

generateWeeklyReport().catch(console.error);
" 2>> "$LOG_DIR/weekly-strategic.log"

# Run comprehensive analysis
echo "Running comprehensive pattern analysis..."
cd "$KNOWLEDGE_DIR" && node src/frequency-tracker.js 2>> "$LOG_DIR/weekly-strategic.log"

# Generate and send report
"${KNOWLEDGE_DIR}/scripts/morning-report.sh" 2>> "$LOG_DIR/weekly-strategic.log"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Weekly strategic extraction completed"
