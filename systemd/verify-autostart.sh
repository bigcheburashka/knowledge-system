#!/bin/bash
# Verify Autostart Configuration for Self-Evolution System

echo "=== Verifying Self-Evolution System Autostart ==="
echo ""

ERRORS=0
WARNINGS=0

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "⚠️  Not running as root. Some checks may fail."
  WARNINGS=$((WARNINGS + 1))
fi

# Check required directories
echo "Checking directories..."
for dir in /var/lib/knowledge /var/lib/knowledge/logs /var/lib/knowledge/queue; do
  if [ -d "$dir" ]; then
    echo "  ✅ $dir exists"
  else
    echo "  ❌ $dir missing"
    ERRORS=$((ERRORS + 1))
  fi
done

# Check Node.js
echo ""
echo "Checking Node.js..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  echo "  ✅ Node.js $NODE_VERSION"
else
  echo "  ❌ Node.js not found"
  ERRORS=$((ERRORS + 1))
fi

# Check required services
echo ""
echo "Checking required services..."
for service in qdrant memgraph; do
  if systemctl is-active --quiet $service 2>/dev/null; then
    echo "  ✅ $service is running"
  else
    echo "  ⚠️  $service not running (optional)"
    WARNINGS=$((WARNINGS + 1))
  fi
done

# Check environment file for Telegram bot
echo ""
echo "Checking Telegram bot configuration..."
if [ -f "/etc/systemd/system/evolution-bot.env" ]; then
  if [ "$(stat -c %a /etc/systemd/system/evolution-bot.env)" = "600" ]; then
    echo "  ✅ Token file exists with correct permissions (600)"
  else
    echo "  ⚠️  Token file permissions incorrect"
    WARNINGS=$((WARNINGS + 1))
  fi
else
  echo "  ⚠️  Token file not found at /etc/systemd/system/evolution-bot.env"
  WARNINGS=$((WARNINGS + 1))
fi

# Check if services are enabled
echo ""
echo "Checking systemd services..."
for timer in evolution.timer staleness-check.timer; do
  if systemctl is-enabled --quiet $timer 2>/dev/null; then
    echo "  ✅ $timer is enabled"
  else
    echo "  ⚠️  $timer not enabled (run: systemctl enable $timer)"
    WARNINGS=$((WARNINGS + 1))
  fi
done

for service in session-monitor telegram-bot; do
  if systemctl is-enabled --quiet $service 2>/dev/null; then
    echo "  ✅ $service is enabled"
  else
    echo "  ⚠️  $service not enabled (run: systemctl enable $service)"
    WARNINGS=$((WARNINGS + 1))
  fi
done

# Summary
echo ""
echo "=== Verification Summary ==="
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo "✅ All checks passed! System is ready for autostart."
  exit 0
elif [ $ERRORS -eq 0 ]; then
  echo "⚠️  $WARNINGS warning(s). System should work but review recommended."
  exit 0
else
  echo "❌ $ERRORS error(s), $WARNINGS warning(s). Please fix errors before proceeding."
  exit 1
fi
