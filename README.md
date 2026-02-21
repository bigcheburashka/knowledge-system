# Self-Evolution System

Autonomous learning and improvement system for OpenClaw. Analyzes sessions, detects patterns, and proposes system improvements.

## Overview

The Self-Evolution System continuously monitors user sessions, identifies recurring patterns (both problems and successes), and proposes improvements to the system through a structured approval process.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Self-Evolution System                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Session Monitor ──► Pattern Detector ──► Evolution.propose()│
│         │                                               │    │
│         ▼                                               ▼    │
│  Learning Log ◄───────────────────────────── Approval (L1-L4)│
│         │                                               │    │
│         ▼                                               ▼    │
│  Deep Learning ◄─────────────────────────── ChangeApplier   │
│         │                                               │    │
│         ▼                                               ▼    │
│  Qdrant ◄────► MemgraphSync Worker ◄─────► Skills (NEW)   │
│         │                                               │    │
│         └───────────────────────────────────▶ Audit Log    │
│                                                              │
│  Services: session-monitor, telegram-bot, staleness-check   │
│  Timers:   evolution (2 AM), staleness-check (3 AM)          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Core Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `index.js` | Main orchestrator | `src/evolution/` |
| `queue/file-queue.js` | File-based message queue | `src/evolution/queue/` |
| `learning-log.js` | Structured logging | `src/evolution/` |
| `approval-manager.js` | L1-L4 approval system | `src/evolution/` |
| `pending-index.js` | O(1) proposal lookup | `src/evolution/` |
| `change-applier.js` | Git commit, tests, npm | `src/evolution/` |
| `validation.js` | Input validation | `src/evolution/` |
| `metrics.js` | Metrics and alerts | `src/evolution/` |

### New Components

| Component | Purpose | Location |
|-----------|---------|----------|
| `memgraph-sync.js` | Async Memgraph sync | `src/evolution/` |
| `audit-logger.js` | Unified audit trail | `src/evolution/` |
| `staleness-checker.js` | Knowledge freshness | `src/evolution/` |

### Integration

| Component | Purpose | Location |
|-----------|---------|----------|
| `session-monitor.js` | Real-time monitoring | `src/` |
| `deep-learning.js` | LLM topic expansion | `scripts/` |
| `telegram-bot.js` | Approval notifications | `src/evolution/` |

## Installation

```bash
cd /root/.openclaw/workspace/knowledge-system/systemd
sudo ./install.sh
```

This installs:
- `evolution.timer` - Daily analysis at 2 AM
- `staleness-check.timer` - Daily freshness check at 3 AM
- `session-monitor.service` - Continuous monitoring
- `telegram-bot.service` - Telegram approval bot

### Verification

```bash
sudo ./verify-autostart.sh
```

## Configuration

### Telegram Bot Token

Create `/etc/systemd/system/evolution-bot.env`:
```bash
TELEGRAM_BOT_TOKEN=your_token_here
```

Set permissions:
```bash
sudo chmod 600 /etc/systemd/system/evolution-bot.env
```

### Environment Variables

```bash
QDRANT_URL=http://localhost:6333
MEMGRAPH_URL=bolt://localhost:7687
NODE_ENV=production
```

## Usage

### Telegram Bot Commands (Authorized Users Only)

| Command | Description |
|---------|-------------|
| `/start` | List available commands |
| `/pending` | Show pending proposals |
| `/approve <id>` | Approve a proposal |
| `/reject <id> [reason]` | Reject a proposal |
| `/status` | System status |
| `/metrics` | Show metrics |

### Manual Operations

```bash
# Run staleness check manually
node src/evolution/staleness-checker.js

# Start MemgraphSync worker
node src/evolution/memgraph-sync.js

# Query audit log
node -e "const {AuditLogger} = require('./src/evolution/audit-logger'); const a = new AuditLogger(); a.init().then(() => a.query({type: 'PROPOSAL_CREATED'}).then(console.log))"
```

## Approval Levels

### L1: Auto-Apply
- **Trigger:** Low impact changes (impact < 0.1)
- **Examples:** Config updates, timeout adjustments
- **Action:** Applied immediately, logged

### L2: Queue for Review
- **Trigger:** New skills, medium impact
- **Examples:** Create new skill file
- **Action:** Added to queue, batch reviewed

### L3: Telegram Notification
- **Trigger:** Updates to existing components
- **Examples:** Modify existing skill
- **Action:** Telegram notification, manual approval

### L4: Block Until Approved
- **Trigger:** Self-modification, high impact
- **Examples:** Change approval thresholds
- **Action:** System blocked until approved

## Data Flow

1. **Session Analysis**
   - SessionMonitor analyzes each session
   - PatternDetector identifies recurring issues
   - Evolution.propose() creates improvement proposal

2. **Approval Process**
   - Proposal assigned L1-L4 level
   - L1: Auto-applied
   - L2-L4: Queue for approval

3. **Change Application**
   - ChangeApplier creates skill files
   - Git commit with descriptive message
   - NPM install if needed
   - Tests generation and validation

4. **Knowledge Integration**
   - Deep Learning checks "skill exists?" before learning
   - No duplication between knowledge and skills
   - Bidirectional sync maintained

## File Formats

### Session Level
```
/agents/main/sessions/{id}.jsonl
```
Format: OpenClaw native JSON Lines

### Queue Level
```
/var/lib/knowledge/queue/{name}.jsonl
```
Format: JSON with `_seq`, `_id`, `_timestamp`

### Log Level
```
/var/lib/knowledge/logs/learning-log-YYYY-MM-DD.jsonl
```
Format: ISO timestamped JSON Lines

### Audit Level
```
/var/lib/knowledge/logs/audit.log
```
Format: JSON Lines with rotation (10MB)

### Index Level
```
/var/lib/knowledge/logs/pending-proposals.json
```
Format: JSON key-value for O(1) lookup

## Cleanup Policies

| Data Type | Retention | Policy |
|-----------|-----------|--------|
| Logs | 30 days | Rotation + cleanup |
| Audit | 90 days | Rotation + cleanup |
| Skills | Permanent | Never deleted |
| Vectors | No cleanup | Knowledge preserved |
| Proposals | Permanent | Status tracking |

## Monitoring

### Logs
```bash
# Evolution logs
journalctl -u evolution.service -f

# Session monitor logs
journalctl -u session-monitor.service -f

# Telegram bot logs
journalctl -u telegram-bot.service -f

# Staleness check logs
/var/log/knowledge/staleness-check.log
```

### Metrics
```bash
# System status
node -e "const {SelfEvolution} = require('./src/evolution'); const e = new SelfEvolution(); e.init().then(() => e.getStatus().then(console.log))"

# Consistency check
node -e "const {MemgraphSyncWorker} = require('./src/evolution/memgraph-sync'); const m = new MemgraphSyncWorker(); m.init().then(() => m.checkConsistency().then(console.log))"
```

## Testing

```bash
# Run all tests
cd /root/.openclaw/workspace/knowledge-system
npm test

# Run specific test suite
node tests/file-queue.test.js
node tests/learning-approval.test.js
node tests/evolution-e2e.test.js
```

## Troubleshooting

### Services not starting
```bash
sudo ./systemd/verify-autostart.sh
systemctl status session-monitor.service
journalctl -u session-monitor.service --no-pager
```

### Memgraph connection issues
```bash
# Check Memgraph is running
curl http://localhost:6333/health

# Test connection
node test-memgraph.js
```

### Queue issues
```bash
# Check queue length
node -e "const {FileMessageQueue} = require('./src/evolution/queue/file-queue'); const q = new FileMessageQueue({name: 'evolution'}); q.init().then(() => q.length().then(console.log))"

# Recover from WAL
node -e "const {FileMessageQueue} = require('./src/evolution/queue/file-queue'); const q = new FileMessageQueue({name: 'evolution'}); q.init().then(() => q.recover().then(console.log))"
```

## Architecture Decisions

1. **File-based queue** - Simplicity, durability, no external dependencies
2. **L1-L4 approval** - Balance automation with safety
3. **Async MemgraphSync** - Non-blocking Deep Learning operations
4. **Unified audit log** - Complete traceability
5. **Bidirectional sync** - Prevent knowledge/skill duplication

## Security

- Telegram bot: Authorized user ID only (908231)
- Token storage: 600 permissions, systemd EnvironmentFile
- Input validation: All user inputs sanitized
- No hardcoded secrets: All tokens via environment

## License

Part of OpenClaw knowledge system.
