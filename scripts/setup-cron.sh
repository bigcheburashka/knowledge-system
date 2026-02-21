#!/bin/bash
# Setup cron jobs for Knowledge System automation

CRON_FILE="/tmp/knowledge-cron-$$"
LOG_DIR="/var/log/knowledge"

mkdir -p "$LOG_DIR"

cat > "$CRON_FILE" << 'EOF'
# Expert Knowledge System - Automation Schedule
# Generated: $(date)

SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
KNOWLEDGE_DIR=/root/.openclaw/workspace/knowledge-system

# Every hour: Light learning from sessions
0 * * * * cd $KNOWLEDGE_DIR/scripts && node auto-extract-from-sessions.js >> $LOG_DIR/extraction.log 2>&1

# Every 6 hours: Health check with alerts
0 */6 * * * $KNOWLEDGE_DIR/scripts/health-check.sh --alert >> $LOG_DIR/health.log 2>&1

# Daily at 2 AM: Deep learning / topic expansion
0 2 * * * cd $KNOWLEDGE_DIR && ./scripts/nightly-learning.sh >> $LOG_DIR/deep.log 2>&1

# Daily at 8 AM: Progress report
0 8 * * * cd $KNOWLEDGE_DIR && ./scripts/progress-report.sh >> $LOG_DIR/reports.log 2>&1

# Weekly on Sunday 3 AM: Full backup
0 3 * * 0 $KNOWLEDGE_DIR/scripts/backup.sh full >> $LOG_DIR/backup.log 2>&1

# Weekly on Sunday 9 AM: Sprint review report
0 9 * * 0 $KNOWLEDGE_DIR/scripts/sprint-review.sh >> $LOG_DIR/sprint.log 2>&1
EOF

# Install cron jobs
crontab "$CRON_FILE"
rm "$CRON_FILE"

echo "✅ Cron jobs installed"
echo ""
echo "Schedule:"
echo "  Hourly:    Auto-extraction from sessions"
echo "  6 hours:   Health check with alerts"
echo "  2 AM:      Deep learning"
echo "  8 AM:      Progress report"
echo "  Sun 3 AM:  Full backup"
echo "  Sun 9 AM:  Sprint review"
echo ""
crontab -l | grep -E "^#|^\\S+\\s+\\*" | head -20