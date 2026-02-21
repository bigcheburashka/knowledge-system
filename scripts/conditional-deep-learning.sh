#!/bin/bash
# Conditional Deep Learning Run
# Runs only if there are more than 10 topics in the queue

KNOWLEDGE_DIR="/root/.openclaw/workspace/knowledge-system"
CUSTOM_TOPICS="${KNOWLEDGE_DIR}/custom-topics.json"
LOG_DIR="/var/log/knowledge"

# Count topics in queue
if [ -f "$CUSTOM_TOPICS" ]; then
  TOPIC_COUNT=$(grep -c '"name"' "$CUSTOM_TOPICS" 2>/dev/null || echo "0")
  
  echo "$(date '+%Y-%m-%d %H:%M:%S') - Conditional DL check: ${TOPIC_COUNT} topics in queue"
  
  if [ "$TOPIC_COUNT" -gt 10 ]; then
    echo "Queue has ${TOPIC_COUNT} topics (>10), starting Deep Learning..."
    cd "$KNOWLEDGE_DIR" && node scripts/deep-learning.js --custom --limit 10 >> "$LOG_DIR/deep-learning.log" 2>&1
    echo "Deep Learning completed"
  else
    echo "Only ${TOPIC_COUNT} topics in queue (≤10), skipping this run"
  fi
else
  echo "Custom topics file not found, skipping"
fi
