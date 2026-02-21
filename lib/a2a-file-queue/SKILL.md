---
name: a2a-file-queue
description: Persistent file-based message queue with write-ahead log for A2A agent communication. Use when building agent systems that need reliable message passing with crash recovery.
---

# A2A File Queue

Persistent message queue using filesystem with WAL (Write-Ahead Log) for durability.

## Quick Start

```javascript
const { FileQueue } = require('./scripts/file-queue');

// Create queue
const queue = new FileQueue('research');

// Push message
await queue.push({ id: '1', type: 'RESEARCH', topic: 'AI' });

// Pop message
const msg = await queue.pop();

// Recover after crash
await queue.recover();
```

## API

### push(message)
Append message to queue with WAL durability.

### pop()
Remove and return first message.

### recover()
Replay WAL to restore state after crash.

## Architecture

```
queue.jsonl  — messages (append-only)
queue.wal    — write-ahead log (atomic)
```

## Implementation Details

See [references/api.md](references/api.md) for full documentation.
