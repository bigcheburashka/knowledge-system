---
name: a2a-orchestrator
description: A2A orchestrator for managing 4 async agents (Research, FactCheck, Quality, Composer). Use when executing sequential agent workflow with direct return values (no fork/processes).
---

# A2A Orchestrator v11

Manages 4 async agents in a sequential pipeline.

## Architecture

```
Orchestrator
├── Agents (async functions)
│   ├── researchAgent()
│   ├── factCheckAgent()
│   ├── qualityAgent()
│   └── composerAgent()
└── TaskMonitor (timeout/hang detection)
```

**No fork(), no processes - pure async/await**

## Quick Start

```javascript
const { A2AOrchestrator } = require('./scripts/orchestrator');

const orchestrator = new A2AOrchestrator();
await orchestrator.init();

// Execute full pipeline
const result = await orchestrator.executePipeline({
  topic: 'AI',
  query: 'machine learning'
});

console.log(result.success, result.duration);
```

## Difference from v10

| Aspect | v10 (Subagents) | v11 (Async) |
|--------|----------------|-------------|
| Processes | fork() 4 processes | Single thread |
| Communication | IPC + polling | Direct return |
| Error handling | Process exit codes | try/catch |
| Health check | Process monitoring | Task monitoring |
| OpenClaw | 6/10 (problems) | 9/10 (works) |

## API

See [references/agent-lifecycle.md](references/agent-lifecycle.md)
