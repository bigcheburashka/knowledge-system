#!/bin/bash
# System Monitor with Auto-Alerts
# Checks all components and sends Telegram alerts on failures

TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-908231}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
LOG_DIR="/var/log/knowledge"
ALERT_STATE_FILE="/var/lib/knowledge/monitor/alert-state.json"
MAX_SILENT_MINUTES=30  # Alert if no activity for 30 min

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting system monitor"

# Ensure state directory exists
mkdir -p /var/lib/knowledge/monitor

# Function to send Telegram alert
send_alert() {
  local severity="$1"
  local component="$2"
  local message="$3"
  
  if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
    echo "⚠️  TELEGRAM_BOT_TOKEN not set, alert not sent"
    return
  fi
  
  local emoji="🟡"
  [ "$severity" = "CRITICAL" ] && emoji="🔴"
  [ "$severity" = "WARNING" ] && emoji="🟡"
  [ "$severity" = "INFO" ] && emoji="🟢"
  
  local full_message="${emoji} *System Monitor Alert*

Severity: ${severity}
Component: ${component}
Time: $(date '+%H:%M:%S MSK')

${message}

#SystemHealth #Evolution"
  
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=${full_message}" \
    -d "parse_mode=Markdown" \
    > /dev/null 2>&1
  
  echo "📤 Alert sent: ${severity} - ${component}"
}

# Check systemd services
check_services() {
  local failed_services=""
  
  for service in session-monitor telegram-bot evolution staleness-check; do
    if ! systemctl is-active --quiet "${service}.service" 2>/dev/null; then
      if [ "$service" != "evolution" ] && [ "$service" != "staleness-check" ]; then
        # evolution and staleness-check are timers, not always-running services
        failed_services="${failed_services}${service} "
      fi
    fi
  done
  
  if [ -n "$failed_services" ]; then
    send_alert "CRITICAL" "Services" "Failed services: ${failed_services}"
    return 1
  fi
  
  return 0
}

# Check recent activity in logs
check_log_activity() {
  local component="$1"
  local log_file="$2"
  local max_age_minutes="$3"
  
  if [ ! -f "$log_file" ]; then
    send_alert "WARNING" "$component" "Log file missing: ${log_file}"
    return 1
  fi
  
  local last_modified=$(stat -c %Y "$log_file" 2>/dev/null)
  local now=$(date +%s)
  local age_minutes=$(( (now - last_modified) / 60 ))
  
  if [ "$age_minutes" -gt "$max_age_minutes" ]; then
    send_alert "WARNING" "$component" "No activity for ${age_minutes} minutes (expected every ${max_age_minutes}m)"
    return 1
  fi
  
  return 0
}

# Check Deep Learning queue
check_dl_queue() {
  local custom_topics="/root/.openclaw/workspace/knowledge-system/custom-topics.json"
  
  if [ -f "$custom_topics" ]; then
    local topic_count=$(grep -c '"name"' "$custom_topics" 2>/dev/null || echo "0")
    
    if [ "$topic_count" -gt 20 ]; then
      send_alert "INFO" "Deep Learning" "Queue has ${topic_count} topics. Consider additional runs."
    fi
  fi
}

# Check for errors in recent logs
check_recent_errors() {
  local log_file="$1"
  local component="$2"
  local lookback_minutes="$3"
  
  if [ ! -f "$log_file" ]; then
    return 0
  fi
  
  local since_time=$(date -d "${lookback_minutes} minutes ago" '+%Y-%m-%d %H:%M' 2>/dev/null)
  
  local error_count=$(grep -E "ERROR|CRITICAL|FAILED|Exception" "$log_file" 2>/dev/null | \
    tail -100 | \
    awk -v since="$since_time" '$0 > since' | \
    wc -l)
  
  if [ "$error_count" -gt 5 ]; then
    send_alert "CRITICAL" "$component" "${error_count} errors in last ${lookback_minutes} minutes"
    return 1
  elif [ "$error_count" -gt 0 ]; then
    send_alert "WARNING" "$component" "${error_count} errors detected"
    return 1
  fi
  
  return 0
}

# Check database connectivity
check_databases() {
  local alerts=""
  
  # Check Qdrant
  if ! curl -sf http://localhost:6333/healthz > /dev/null 2>&1; then
    alerts="${alerts}Qdrant down; "
  fi
  
  # Check Memgraph
  if ! echo "RETURN 1;" | nc -q 1 localhost 7687 > /dev/null 2>&1; then
    alerts="${alerts}Memgraph down; "
  fi
  
  if [ -n "$alerts" ]; then
    send_alert "CRITICAL" "Databases" "$alerts"
    return 1
  fi
  
  return 0
}

# Check MemgraphSync queue
check_sync_queue() {
  local queue_file="/var/lib/knowledge/queue/memgraph-sync.jsonl"
  
  if [ -f "$queue_file" ]; then
    local queue_size=$(wc -l < "$queue_file" 2>/dev/null | tr -d ' ')
    
    if [ "$queue_size" -gt 100 ]; then
      send_alert "WARNING" "MemgraphSync" "Queue backlog: ${queue_size} items"
      return 1
    elif [ "$queue_size" -gt 500 ]; then
      send_alert "CRITICAL" "MemgraphSync" "Critical queue backlog: ${queue_size} items"
      return 1
    fi
  fi
  
  return 0
}

# Main monitoring loop
main() {
  echo "Starting system monitoring checks..."
  
  local has_errors=0
  
  # Check services
  check_services || has_errors=1
  
  # Check log activity (expected every 60 min for auto-extract)
  check_log_activity "Auto-Extract" "$LOG_DIR/extraction.log" 90 || has_errors=1
  
  # Check for recent errors
  check_recent_errors "$LOG_DIR/deep-learning.log" "Deep Learning" 60 || has_errors=1
  check_recent_errors "$LOG_DIR/extraction.log" "Auto-Extract" 60 || has_errors=1
  
  # Check databases
  check_databases || has_errors=1
  
  # Check sync queue
  check_sync_queue || has_errors=1
  
  # Check DL queue size
  check_dl_queue
  
  if [ $has_errors -eq 0 ]; then
    echo "✅ All checks passed"
  else
    echo "⚠️  Some checks failed, alerts sent"
  fi
  
  return $has_errors
}

# Run main
main
