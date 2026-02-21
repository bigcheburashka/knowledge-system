# Agent Lifecycle

## States

```
CREATED → SPAWNING → RUNNING → [PROCESSING] → STOPPED/CRASHED
            ↓           ↓            ↓              ↓
         Fork()    Heartbeat    Handle msg     Auto-restart
```

## Lifecycle Methods

### spawnAll()
Initialize orchestrator and start all 4 agents.

### startAgent(type)
Spawn single agent process.

### handleAgentMessage(type, message)
Process message from agent (READY, RESULT, ERROR).

### handleAgentExit(type, code, signal)
Handle agent exit. Auto-restart if crashed.

### stopAll()
Gracefully stop all agents.

## Message Types

- **READY** — Agent initialized and ready
- **RESULT** — Task completed, result available
- **ERROR** — Error occurred during processing

## Pipeline Flow

```
User Task
    ↓
Research Agent → FactCheck Agent → Quality Agent → Composer Agent
    ↓                   ↓                  ↓               ↓
Queue: research    Queue: factcheck   Queue: quality  Queue: composer
```

## Health Check

- Heartbeat every 5 seconds
- Timeout after 15 seconds (3 missed heartbeats)
- Auto-restart on crash

## Error Handling

| Error Type | Action |
|------------|--------|
| Agent crash | Auto-restart after 2s |
| Timeout | Mark dead, restart |
| Message error | Log, continue |
| Queue error | Recover WAL |
