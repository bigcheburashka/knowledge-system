#!/bin/bash
# Error Alert Script - Immediate notifications for critical errors
# Run via systemd or cron every 15 minutes

TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-908231}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
LOG_DIR="/var/log/knowledge"
ALERT_STATE_FILE="/var/lib/knowledge/last-alert-state"

# Create state directory
mkdir -p "$(dirname "$ALERT_STATE_FILE")"

# Check for critical errors in logs
CRITICAL_PATTERNS="MODULE_NOT_FOUND|Cannot find module|Connection refused|ECONNREFUSED|fatal|FATAL"
RECENT_ERRORS=$(find "$LOG_DIR" -name "*.log" -mtime -1 -exec grep -hE "$CRITICAL_PATTERNS" {} \; 2>/dev/null | tail -20)

# Count errors by service
DL_ERRORS=$(grep -cE "$CRITICAL_PATTERNS" "${LOG_DIR}/deep-learning.log" 2>/dev/null || echo "0")
EV_ERRORS=$(grep -cE "$CRITICAL_PATTERNS" "${LOG_DIR}/evolution.log" 2>/dev/null || echo "0")
SM_ERRORS=$(grep -cE "$CRITICAL_PATTERNS" "${LOG_DIR}/session-monitor.log" 2>/dev/null || echo "0")

TOTAL_ERRORS=$((DL_ERRORS + EV_ERRORS + SM_ERRORS))

# Read last alert count
LAST_ALERT_COUNT=$(cat "$ALERT_STATE_FILE" 2>/dev/null || echo "0")

# If new errors appeared since last alert
if [ "$TOTAL_ERRORS" -gt "$LAST_ALERT_COUNT" ] && [ "$TOTAL_ERRORS" -gt 0 ]; then
  NEW_ERRORS=$((TOTAL_ERRORS - LAST_ALERT_COUNT))
  
  ALERT="🚨 *КРИТИЧЕСКИЕ ОШИБКИ В Knowledge System*

❌ *Обнаружено ${NEW_ERRORS} новых ошибок*

📊 *По сервисам:*"
  
  if [ "$DL_ERRORS" -gt 0 ]; then
    ALERT="${ALERT}
• Deep Learning: ${DL_ERRORS} ошибок"
  fi
  
  if [ "$EV_ERRORS" -gt 0 ]; then
    ALERT="${ALERT}
• Evolution: ${EV_ERRORS} ошибок"
  fi
  
  if [ "$SM_ERRORS" -gt 0 ]; then
    ALERT="${ALERT}
• Session Monitor: ${SM_ERRORS} ошибок"
  fi
  
  ALERT="${ALERT}

🔍 *Последние ошибки:*
\`\`\`
$(echo "$RECENT_ERRORS" | tail -5)
\`\`\`

📁 *Логи:* /var/log/knowledge/
🛠 *Действие:* Проверьте статус сервисов"

  # Send alert
  if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      -d "text=${ALERT}" \
      -d "parse_mode=Markdown" \
      > /dev/null 2>&1
    echo "Alert sent: $(date) - ${TOTAL_ERRORS} errors" >> "${LOG_DIR}/error-alerts.log"
  fi
  
  # Update state
  echo "$TOTAL_ERRORS" > "$ALERT_STATE_FILE"
else
  # No new errors, just update state
  echo "$TOTAL_ERRORS" > "$ALERT_STATE_FILE"
fi
