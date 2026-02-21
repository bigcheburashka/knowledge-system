#!/bin/bash
set -e

echo "=== Installing Self-Evolution Systemd Services ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root (use sudo)"
  exit 1
fi

# Create log directory
mkdir -p /var/log/knowledge
chmod 755 /var/log/knowledge

# Copy service files
echo "Copying service files..."
cp evolution.service /etc/systemd/system/
cp evolution.timer /etc/systemd/system/
cp session-monitor.service /etc/systemd/system/
cp telegram-bot.service /etc/systemd/system/
cp staleness-check.service /etc/systemd/system/
cp staleness-check.timer /etc/systemd/system/

# Reload systemd
echo "Reloading systemd..."
systemctl daemon-reload

# Enable services
echo "Enabling services..."
systemctl enable evolution.timer
systemctl enable session-monitor.service
systemctl enable telegram-bot.service
systemctl enable staleness-check.timer

# Start timer (will trigger service at next 2 AM)
echo "Starting evolution timer..."
systemctl start evolution.timer

# Start session monitor immediately
echo "Starting session monitor..."
systemctl start session-monitor.service

# Start telegram bot
echo "Starting telegram bot..."
systemctl start telegram-bot.service

# Show status
echo ""
echo "=== Installation Complete ==="
echo ""
echo "Active timers:"
systemctl list-timers --no-pager
echo ""
echo "Service status:"
systemctl status session-monitor.service --no-pager || true
systemctl status telegram-bot.service --no-pager || true
echo ""
echo "Logs:"
echo "  /var/log/knowledge/evolution.log"
echo "  /var/log/knowledge/session-monitor.log"
echo "  /var/log/knowledge/telegram-bot.log"
echo "  /var/log/knowledge/staleness-check.log"
echo ""
echo "Commands:"
echo "  systemctl status session-monitor.service"
echo "  systemctl status telegram-bot.service"
echo "  systemctl list-timers"
echo "  journalctl -u telegram-bot.service -f"
