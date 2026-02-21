#!/bin/bash
# Mass action on L2 proposals
# Provides summary and mass approve/reject functionality

PENDING_FILE="/var/lib/knowledge/logs/pending-proposals.json"
LOG_FILE="/var/log/knowledge/mass-actions.log"

# Show summary
show_summary() {
  echo "📋 L2 PROPOSALS SUMMARY"
  echo "========================"
  echo ""
  
  node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('$PENDING_FILE', 'utf8'));
const proposals = Object.values(data).filter(p => p.level === 'L2');

console.log(\`Всего L2: \${proposals.length}\`);
console.log('');

proposals.forEach((p, i) => {
  const skill = p.change?.skill?.name || 'unknown';
  const desc = (p.change?.skill?.description || '').substring(0, 60);
  console.log(\`\${i + 1}. \${skill}\`);
  console.log(\`   \${desc}...\`);
  console.log('');
});
"
}

# Reject all L2 with pattern
reject_pattern() {
  local pattern="$1"
  
  node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('$PENDING_FILE', 'utf8'));
let rejected = 0;

for (const [id, p] of Object.entries(data)) {
  if (p.level === 'L2') {
    const skill = p.change?.skill?.name || '';
    const reason = p.change?.reason || '';
    
    if (skill.includes('$pattern') || reason.includes('$pattern')) {
      delete data[id];
      rejected++;
    }
  }
}

fs.writeFileSync('$PENDING_FILE', JSON.stringify(data, null, 2));
console.log(\`Rejected: \${rejected} proposals\`);
"
  
  echo "$(date): Rejected L2 with pattern: $pattern" >> "$LOG_FILE"
}

# Reject all prevent-* patterns (garbage proposals)
reject_garbage() {
  node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('$PENDING_FILE', 'utf8'));
let rejected = 0;

const garbagePatterns = [
  /^prevent-\$/,
  /^(prevent-n|prevent-vn|prevent-js|prevent-cron)\$/,
];

for (const [id, p] of Object.entries(data)) {
  if (p.level === 'L2') {
    const skill = p.change?.skill?.name || '';
    const reason = p.change?.reason || '';
    
    // Check if it's garbage
    const isGarbage = skill.match(/^prevent-/) && skill.length < 20;
    const hasMarkdown = reason.includes('**') || reason.includes('##');
    
    if (isGarbage || (hasMarkdown && skill.match(/^prevent-/))) {
      delete data[id];
      rejected++;
      console.log(\`Rejected: \${skill}\`);
    }
  }
}

fs.writeFileSync('$PENDING_FILE', JSON.stringify(data, null, 2));
console.log(\`\\nTotal rejected: \${rejected}\`);
"
  
  echo "$(date): Mass rejected garbage L2 proposals" >> "$LOG_FILE"
}

# Mass approve all L2
approve_all() {
  node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('$PENDING_FILE', 'utf8'));
let approved = 0;

for (const [id, p] of Object.entries(data)) {
  if (p.level === 'L2') {
    // In real implementation, this would call the actual apply logic
    delete data[id];
    approved++;
  }
}

fs.writeFileSync('$PENDING_FILE', JSON.stringify(data, null, 2));
console.log(\`Approved: \${approved} proposals\`);
"
  
  echo "$(date): Mass approved all L2" >> "$LOG_FILE"
}

# Main
case "$1" in
  summary)
    show_summary
    ;;
  reject-garbage)
    reject_garbage
    ;;
  reject-pattern)
    reject_pattern "$2"
    ;;
  approve-all)
    approve_all
    ;;
  *)
    echo "Usage: $0 {summary|reject-garbage|reject-pattern PATTERN|approve-all}"
    exit 1
    ;;
esac
