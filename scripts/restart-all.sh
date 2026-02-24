#!/bin/bash
# Restart all Knowledge System components with proper order

set -e

echo "=== KNOWLEDGE SYSTEM RESTART ==="
echo "Timestamp: $(date)"
echo ""

# Function to check if service exists
service_exists() {
    systemctl list-unit-files | grep -q "^$1"
}

# 1. Stop all services
echo "1. Stopping services..."
systemctl stop telegram-bot.service 2>/dev/null || true
systemctl stop evolution.service 2>/dev/null || true
systemctl stop session-monitor.service 2>/dev/null || true
sleep 2

# 2. Sync pending index (in case of data inconsistency)
echo "2. Syncing pending proposals index..."
cd /root/.openclaw/workspace/knowledge-system
node scripts/sync-pending-index.js || echo "Warning: sync failed, continuing..."

# 3. Run recovery for stuck topics
echo "3. Recovering stuck topics..."
node scripts/recovery-processing.js || echo "Warning: recovery failed, continuing..."

# 4. Sync topics to queue
echo "4. Syncing topics to queue..."
node scripts/sync-topics-to-queue.js || echo "Warning: topic sync failed, continuing..."

# 5. Start core services
echo "5. Starting services..."

if service_exists "session-monitor.service"; then
    systemctl start session-monitor.service
    echo "   ✅ session-monitor started"
fi

if service_exists "evolution.service"; then
    systemctl start evolution.service
    echo "   ✅ evolution started"
fi

# Wait for core services
sleep 3

# 6. Start telegram bot (last, as it depends on synced data)
echo "6. Starting telegram bot..."
if service_exists "telegram-bot.service"; then
    systemctl start telegram-bot.service
    echo "   ✅ telegram-bot started"
fi

# 7. Verify status
echo ""
echo "7. Verification:"
sleep 2

# Check pending proposals count
PENDING_COUNT=$(cat /var/lib/knowledge/logs/pending-proposals.json 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "   Pending proposals: $PENDING_COUNT"

# Check queue status
QUEUE_PENDING=$(cat /root/.openclaw/workspace/knowledge-system/data/learning-queue.json 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('pending', [])))" 2>/dev/null || echo "0")
echo "   Queue pending: $QUEUE_PENDING"

# Check service status
echo ""
echo "8. Service Status:"
systemctl is-active session-monitor.service 2>/dev/null || echo "   session-monitor: inactive"
systemctl is-active telegram-bot.service 2>/dev/null || echo "   telegram-bot: inactive"
systemctl is-active evolution.service 2>/dev/null || echo "   evolution: inactive"

echo ""
echo "=== RESTART COMPLETE ==="
