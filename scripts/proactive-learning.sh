#!/bin/bash
# Proactive Learning - Post-Session Analysis
# Runs every 6 hours to analyze recent sessions

KNOWLEDGE_DIR="/root/.openclaw/workspace/knowledge-system"
LOG_DIR="/var/log/knowledge"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting proactive learning analysis"

cd "$KNOWLEDGE_DIR" && node -e "
const { PostSessionLearningTrigger } = require('./src/post-session-trigger');

async function run() {
  const trigger = new PostSessionLearningTrigger();
  
  console.log('🧠 Running Post-Session Learning Analysis...\n');
  
  const results = await trigger.run({ hours: 6 });
  
  console.log('\\n=== Results ===');
  console.log(\`Sessions analyzed: \${results.analyzed}\`);
  console.log(\`Topics suggested: \${results.suggested}\`);
  
  if (results.suggested > 0) {
    console.log('\\n📚 New learning topics added to queue');
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
" 2>> "$LOG_DIR/proactive-learning.log"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Analysis completed"
