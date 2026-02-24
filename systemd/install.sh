#!/bin/bash
set -e

echo "=== Installing Self-Evolution Systemd Services (Moscow Time) ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root (use sudo)"
  exit 1
fi

# Create log directory
mkdir -p /var/log/knowledge
chmod 755 /var/log/knowledge
mkdir -p /var/lib/knowledge/monitor

# Copy service files
echo "Copying service files..."
cp evolution.service /etc/systemd/system/
cp evolution.timer /etc/systemd/system/
cp session-monitor.service /etc/systemd/system/
cp telegram-bot.service /etc/systemd/system/
cp sync-pending-index.service /etc/systemd/system/
cp staleness-check.service /etc/systemd/system/
cp staleness-check.timer /etc/systemd/system/
cp system-monitor.service /etc/systemd/system/
cp system-monitor.timer /etc/systemd/system/
cp conditional-deep-learning.service /etc/systemd/system/
cp conditional-deep-learning-4am.timer /etc/systemd/system/
cp conditional-deep-learning-5am.timer /etc/systemd/system/
cp morning-report.service /etc/systemd/system/
cp morning-report.timer /etc/systemd/system/
cp weekly-strategic.service /etc/systemd/system/
cp weekly-strategic.timer /etc/systemd/system/

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

# Enable services
echo "Enabling services..."
systemctl enable evolution.timer
systemctl enable session-monitor.service
systemctl enable telegram-bot.service
systemctl enable staleness-check.timer
systemctl enable system-monitor.timer
systemctl enable conditional-deep-learning-4am.timer
systemctl enable conditional-deep-learning-5am.timer
systemctl enable morning-report.timer
systemctl enable weekly-strategic.timer

# Start timers (Moscow Time)
echo "Starting timers (Moscow Time - MSK, UTC+3)..."
systemctl start evolution.timer
systemctl start staleness-check.timer
systemctl start system-monitor.timer
systemctl start conditional-deep-learning-4am.timer
systemctl start conditional-deep-learning-5am.timer
systemctl start morning-report.timer
systemctl start weekly-strategic.timer

# Start services immediately
echo "Starting services..."

# Sync pending index first (in case it needs restoration)
echo "Syncing pending proposals index..."
systemctl start sync-pending-index.service || true

systemctl start session-monitor.service
systemctl start telegram-bot.service

# Show status
echo ""
echo "=== Installation Complete ==="
echo ""
echo "⏰ All times are in MOSCOW TIME (MSK, UTC+3)"
echo ""
echo "Active timers:"
systemctl list-timers --no-pager | grep -E "(evolution|staleness|system-monitor|conditional|morning|weekly)"
echo ""
echo "Service status:"
systemctl is-active session-monitor.service telegram-bot.service system-monitor.service || true
echo ""
echo "📁 Logs:"
echo "  /var/log/knowledge/evolution.log"
echo "  /var/log/knowledge/session-monitor.log"
echo "  /var/log/knowledge/telegram-bot.log"
echo "  /var/log/knowledge/staleness-check.log"
echo "  /var/log/knowledge/system-monitor.log"
echo "  /var/log/knowledge/conditional-dl.log"
echo "  /var/log/knowledge/morning-report.log"
echo "  /var/log/knowledge/weekly-strategic.log"
echo ""
echo "🔧 Commands:"
echo "  systemctl status session-monitor.service"
echo "  systemctl status telegram-bot.service"
echo "  systemctl list-timers"
echo "  journalctl -u telegram-bot.service -f"
echo ""
echo "📱 Telegram Bot:"
echo "  /pending - List pending proposals"
echo "  /approve <id> - Approve proposal"
echo "  /reject <id> [reason] - Reject proposal"
