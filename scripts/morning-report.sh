#!/bin/bash
# Morning Report - 10:00 AM MSK
# Daily summary of system status and pending items

TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-908231}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
KNOWLEDGE_DIR="/root/.openclaw/workspace/knowledge-system"
LOG_DIR="/var/log/knowledge"

echo "$(date '+%Y-%m-%d %H:%M:%S') - Generating morning report"

# Gather stats
QDRANT_COUNT=$(curl -sf http://localhost:6333/collections/knowledge 2>/dev/null | grep -o '"points_count":[0-9]*' | cut -d: -f2 || echo "N/A")
TOPIC_COUNT=$(grep -c '"name"' "${KNOWLEDGE_DIR}/custom-topics.json" 2>/dev/null || echo "0")
PENDING_COUNT=$(cat "${LOG_DIR}/pending-proposals.json" 2>/dev/null | jq 'length' || echo "0")

# Check services
SESSION_MONITOR_STATUS=$(systemctl is-active session-monitor.service 2>/dev/null || echo "unknown")
TELEGRAM_BOT_STATUS=$(systemctl is-active telegram-bot.service 2>/dev/null || echo "unknown")

# Last DL run
LAST_DL=$(tail -100 "${LOG_DIR}/deep-learning.log" 2>/dev/null | grep "DEEP LEARNING STARTED" | tail -1 | awk '{print $1}' | sed 's/\[//;s/\]//' || echo "N/A")

# Check for errors in last 24h
ERRORS_DL=$(grep -c "Error:" "${LOG_DIR}/deep-learning.log" 2>/dev/null || echo "0")
ERRORS_EV=$(grep -c "Error:" "${LOG_DIR}/evolution.log" 2>/dev/null || echo "0")
ERRORS_SM=$(grep -c "Error:" "${LOG_DIR}/session-monitor.log" 2>/dev/null || echo "0")

# Critical errors (module not found, connection refused, etc)
CRITICAL_ERRORS=$(grep -E "MODULE_NOT_FOUND|Cannot find module|Connection refused|ECONNREFUSED" "${LOG_DIR}"/*.log 2>/dev/null | wc -l || echo "0")

# Generate report
REPORT="🌅 *Утренний отчёт Knowledge System*

📊 *Статистика:*
• Векторов в Qdrant: ${QDRANT_COUNT}
• Тем в очереди: ${TOPIC_COUNT}
• Pending proposals: ${PENDING_COUNT}

🔧 *Сервисы:*
• Session Monitor: ${SESSION_MONITOR_STATUS}
• Telegram Bot: ${TELEGRAM_BOT_STATUS}

🕐 *Последний Deep Learning:*
• ${LAST_DL}"

# Add error alerts if any
if [ "$CRITICAL_ERRORS" -gt 0 ] || [ "$ERRORS_DL" -gt 0 ] || [ "$ERRORS_EV" -gt 0 ]; then
  REPORT="${REPORT}

⚠️ *ОШИБКИ ЗА НОЧЬ:*"
  
  if [ "$CRITICAL_ERRORS" -gt 0 ]; then
    REPORT="${REPORT}
• ❌ ${CRITICAL_ERRORS} критических ошибок (модули/соединения)"
  fi
  
  if [ "$ERRORS_DL" -gt 0 ]; then
    REPORT="${REPORT}
• 📚 Deep Learning: ${ERRORS_DL} ошибок"
  fi
  
  if [ "$ERRORS_EV" -gt 0 ]; then
    REPORT="${REPORT}
• 🧬 Evolution: ${ERRORS_EV} ошибок"
  fi
  
  if [ "$ERRORS_SM" -gt 0 ]; then
    REPORT="${REPORT}
• 👁️ Session Monitor: ${ERRORS_SM} ошибок"
  fi
  
  REPORT="${REPORT}

🔍 *Детали:* /var/log/knowledge/"
fi

# Add action items
if [ "$PENDING_COUNT" -gt 0 ]; then
  REPORT="${REPORT}
• ✅ ${PENDING_COUNT} proposal(s) ожидают аппрува (/pending)"
fi

if [ "$TOPIC_COUNT" -gt 10 ]; then
  REPORT="${REPORT}
• 📚 ${TOPIC_COUNT} тем в очереди на обучение"
fi

REPORT="${REPORT}

_Отчёт сгенерирован: $(date '+%H:%M') МСК_"

# Send to Telegram
if [ -n "$TELEGRAM_BOT_TOKEN" ]; then
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=${REPORT}" \
    -d "parse_mode=Markdown" \
    > /dev/null 2>&1
  echo "Report sent to Telegram"
else
  echo "TELEGRAM_BOT_TOKEN not set, printing to stdout:"
  echo "$REPORT"
fi

# Also log to file
echo "$REPORT" >> "${LOG_DIR}/morning-report.log"
