#!/bin/bash
# Health Check with Alerts - Extended for Self-Evolution System

ALERT_MODE=false
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-908231}"

[ "$1" == "--alert" ] && ALERT_MODE=true

ALERTS=()
LOG_FILE="/var/log/knowledge/health.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S'): $1" | tee -a "$LOG_FILE"
}

# ========== SYSTEM CHECKS ==========

# Check disk
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 85 ]; then
  ALERTS+=("🚨 Disk usage: ${DISK_USAGE}%")
  log "ALERT: High disk usage: ${DISK_USAGE}%"
fi

# Check RAM
RAM_USAGE=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
if [ "$RAM_USAGE" -gt 90 ]; then
  ALERTS+=("🚨 RAM usage: ${RAM_USAGE}%")
  log "ALERT: High RAM usage: ${RAM_USAGE}%"
fi

# ========== DATABASE CHECKS ==========

# Check Qdrant
if ! curl -sf http://localhost:6333/healthz > /dev/null 2>&1; then
  ALERTS+=("🚨 Qdrant is DOWN")
  log "ALERT: Qdrant down"
  docker restart knowledge-qdrant 2>/dev/null || true
  log "Attempted Qdrant restart"
fi

# Check Memgraph
if ! echo "RETURN 1;" | nc -q 1 localhost 7687 > /dev/null 2>&1; then
  ALERTS+=("🚨 Memgraph is DOWN")
  log "ALERT: Memgraph down"
  docker restart knowledge-memgraph 2>/dev/null || true
  log "Attempted Memgraph restart"
fi

# ========== SELF-EVOLUTION CHECKS ==========

# Check Session Monitor
if ! systemctl is-active --quiet session-monitor.service 2>/dev/null; then
  ALERTS+=("⚠️ Session Monitor not running")
  log "ALERT: Session Monitor down"
fi

# Check Telegram Bot
if ! systemctl is-active --quiet telegram-bot.service 2>/dev/null; then
  ALERTS+=("⚠️ Telegram Bot not running")
  log "ALERT: Telegram Bot down"
fi

# ========== MEMGRAPHSYNC CHECKS ==========

# Check queue length
SYNC_QUEUE_FILE="/var/lib/knowledge/queue/memgraph-sync.jsonl"
if [ -f "$SYNC_QUEUE_FILE" ]; then
  SYNC_QUEUE_LENGTH=$(wc -l < "$SYNC_QUEUE_FILE" 2>/dev/null || echo 0)
  if [ "$SYNC_QUEUE_LENGTH" -gt 100 ]; then
    ALERTS+=("⚠️ MemgraphSync queue: ${SYNC_QUEUE_LENGTH} items")
    log "ALERT: MemgraphSync queue backlog: ${SYNC_QUEUE_LENGTH}"
  fi
else
  SYNC_QUEUE_LENGTH=0
fi

# Check last sync (audit log)
AUDIT_LOG="/var/lib/knowledge/logs/audit.log"
if [ -f "$AUDIT_LOG" ]; then
  LAST_SYNC=$(grep "MEMGRAPH" "$AUDIT_LOG" 2>/dev/null | tail -1 | grep -o '"timestamp":"[^"]*"' | cut -d'"' -f4)
  if [ -n "$LAST_SYNC" ]; then
    LAST_SYNC_TS=$(date -d "$LAST_SYNC" +%s 2>/dev/null || echo 0)
    NOW_TS=$(date +%s)
    SYNC_AGE_HOURS=$(( (NOW_TS - LAST_SYNC_TS) / 3600 ))
    
    if [ "$SYNC_AGE_HOURS" -gt 24 ]; then
      ALERTS+=("⚠️ Last Memgraph sync: ${SYNC_AGE_HOURS}h ago")
      log "ALERT: Memgraph sync stale: ${SYNC_AGE_HOURS}h"
    fi
  else
    SYNC_AGE_HOURS="N/A"
  fi
else
  SYNC_AGE_HOURS="N/A"
fi

# ========== AUDIT LOG CHECKS ==========

AUDIT_LOG="/var/lib/knowledge/logs/audit.log"
if [ -f "$AUDIT_LOG" ]; then
  AUDIT_SIZE=$(stat -c%s "$AUDIT_LOG" 2>/dev/null || echo 0)
  AUDIT_SIZE_MB=$(( AUDIT_SIZE / 1024 / 1024 ))
  
  if [ "$AUDIT_SIZE_MB" -gt 90 ]; then
    ALERTS+=("⚠️ Audit log size: ${AUDIT_SIZE_MB}MB (near rotation)")
    log "ALERT: Audit log large: ${AUDIT_SIZE_MB}MB"
  fi
else
  AUDIT_SIZE_MB=0
fi

# ========== STALENESS CHECK ==========

STALENESS_LOG="/var/log/knowledge/staleness-check.log"
if [ -f "$STALENESS_LOG" ]; then
  LAST_CHECK_TS=$(stat -c%Y "$STALENESS_LOG" 2>/dev/null || echo 0)
  NOW_TS=$(date +%s)
  STALENESS_AGE_HOURS=$(( (NOW_TS - LAST_CHECK_TS) / 3600 ))
  
  if [ "$STALENESS_AGE_HOURS" -gt 26 ]; then
    ALERTS+=("⚠️ Staleness check: ${STALENESS_AGE_HOURS}h ago")
    log "ALERT: Staleness check overdue: ${STALENESS_AGE_HOURS}h"
  fi
else
  STALENESS_AGE_HOURS="N/A"
fi

# ========== PENDING PROPOSALS ==========

PENDING_FILE="/var/lib/knowledge/logs/pending-proposals.json"
if [ -f "$PENDING_FILE" ]; then
  PENDING_COUNT=$(grep -c '"status":"pending"' "$PENDING_FILE" 2>/dev/null || echo 0)
  if [ "$PENDING_COUNT" -gt 10 ]; then
    ALERTS+=("📋 Pending proposals: ${PENDING_COUNT}")
    log "INFO: High pending proposals: ${PENDING_COUNT}"
  fi
else
  PENDING_COUNT=0
fi

# ========== SEND ALERTS ==========

if [ ${#ALERTS[@]} -gt 0 ] && [ "$ALERT_MODE" = true ]; then
  MESSAGE="🚨 Knowledge System Alerts

$(printf '%s\n' "${ALERTS[@]}")

Time: $(date)"
  
  log "Sending alerts: ${#ALERTS[@]} issues"
  
  if command -v curl > /dev/null; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN:-}/sendMessage" \
      -d "chat_id=$TELEGRAM_CHAT_ID" \
      -d "text=$MESSAGE" > /dev/null 2>&1 || true
  fi
fi

# ========== PRINT STATUS ==========

echo "Knowledge System Health Check"
echo "=============================="
echo ""
echo "System:"
echo "  Disk: ${DISK_USAGE}%"
echo "  RAM: ${RAM_USAGE}%"
echo ""
echo "Services:"
systemctl is-active --quiet session-monitor.service 2>/dev/null && echo "  ✅ Session Monitor" || echo "  ⚠️  Session Monitor"
systemctl is-active --quiet telegram-bot.service 2>/dev/null && echo "  ✅ Telegram Bot" || echo "  ⚠️  Telegram Bot"
echo ""
echo "Self-Evolution:"
echo "  MemgraphSync Queue: ${SYNC_QUEUE_LENGTH} items"
echo "  Last Sync: ${SYNC_AGE_HOURS}h ago"
echo "  Audit Log: ${AUDIT_SIZE_MB}MB"
echo "  Staleness Check: ${STALENESS_AGE_HOURS}h ago"
echo "  Pending Proposals: ${PENDING_COUNT}"
echo ""
echo "Alerts: ${#ALERTS[@]}"
[ ${#ALERTS[@]} -eq 0 ] && echo "✅ All systems healthy"
echo "=============================="

exit ${#ALERTS[@]}
