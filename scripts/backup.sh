#!/bin/bash
# Backup Knowledge System

BACKUP_DIR="/root/.openclaw/backups/knowledge"
DATE=$(date '+%Y%m%d_%H%M%S')
TYPE=${1:-incremental}
RETENTION_DAYS=7

mkdir -p "$BACKUP_DIR"

echo "🗄️  KNOWLEDGE SYSTEM BACKUP"
echo "============================"
echo "Type: $TYPE"
echo "Date: $DATE"
echo ""

# Backup Qdrant
echo "📦 Backing up Qdrant..."
if docker exec knowledge-qdrant test -d /qdrant/storage; then
  docker exec knowledge-qdrant tar czf - /qdrant/storage \
    > "$BACKUP_DIR/qdrant_${DATE}.tar.gz" 2>/dev/null
  if [ $? -eq 0 ]; then
    echo "   ✅ Qdrant backed up ($(du -h "$BACKUP_DIR/qdrant_${DATE}.tar.gz" | cut -f1))"
  else
    echo "   ⚠️  Qdrant backup warning"
  fi
else
  echo "   ⚠️  Qdrant storage not found"
fi

# Backup Memgraph
echo "🕸️  Backing up Memgraph..."
if echo "DUMP DATABASE;" | docker exec -i knowledge-memgraph mgconsole > "$BACKUP_DIR/memgraph_${DATE}.cypher" 2>/dev/null; then
  if [ -s "$BACKUP_DIR/memgraph_${DATE}.cypher" ]; then
    echo "   ✅ Memgraph backed up ($(du -h "$BACKUP_DIR/memgraph_${DATE}.cypher" | cut -f1))"
  else
    echo "   ⚠️  Memgraph dump empty"
  fi
else
  echo "   ⚠️  Memgraph backup failed"
fi

# Backup state files
echo "📁 Backing up state files..."
if [ -d "/root/.openclaw/workspace/knowledge-state" ]; then
  tar czf "$BACKUP_DIR/state_${DATE}.tar.gz" \
    -C /root/.openclaw/workspace knowledge-state \
    2>/dev/null
  if [ $? -eq 0 ]; then
    echo "   ✅ State backed up"
  fi
fi

# Backup configuration
echo "⚙️  Backing up configuration..."
tar czf "$BACKUP_DIR/config_${DATE}.tar.gz" \
  -C /root/.openclaw/workspace/knowledge-system \
  .env src scripts \
  2>/dev/null
if [ $? -eq 0 ]; then
  echo "   ✅ Config backed up"
fi

# Cleanup old backups
echo ""
echo "🧹 Cleaning up old backups (${RETENTION_DAYS} days)..."
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete 2>/dev/null
find "$BACKUP_DIR" -name "*.cypher" -mtime +$RETENTION_DAYS -delete 2>/dev/null

echo ""
echo "============================"
echo "✅ Backup complete"
echo "Location: $BACKUP_DIR"
echo "Recent backups:"
ls -lt "$BACKUP_DIR" | head -6 | tail -5