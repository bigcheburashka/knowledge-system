#!/bin/bash
# Knowledge Graph Walker - Daily run at 4 AM MSK
# Discovers unexplored connections in knowledge graph

KNOWLEDGE_DIR="/root/.openclaw/workspace/knowledge-system"
LOG_DIR="/var/log/knowledge"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting Knowledge Graph Walker"

cd "$KNOWLEDGE_DIR" && node -e "
const { KnowledgeGraphWalker } = require('./src/knowledge-graph-walker');

async function run() {
  console.log('🕸️  Walking Knowledge Graph...\n');
  
  const walker = new KnowledgeGraphWalker();
  
  const results = await walker.walk({
    maxHops: 2,
    maxSuggestions: 10
  });
  
  if (results.error) {
    console.error('❌ Error:', results.error);
    process.exit(1);
  }
  
  console.log('\\n=== Graph Walker Results ===');
  console.log(\`Entities checked: \${results.entitiesChecked}\`);
  console.log(\`Neighbors found: \${results.neighborsFound}\`);
  console.log(\`New suggestions: \${results.newSuggestions}\`);
  
  if (results.newSuggestions > 0) {
    console.log('\\n📚 New topics discovered from graph:');
    results.suggestions.forEach(s => {
      console.log(\`  - \${s.name} (\${s.distance} hop(s) from \${s.from})\`);
    });
  }
  
  console.log('\\n✅ Graph walk complete');
}

run().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
" 2>> "$LOG_DIR/graph-walker.log"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Graph walker completed"
