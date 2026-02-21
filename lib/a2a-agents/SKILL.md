---
name: a2a-agents
description: Four async agent functions (Research, FactCheck, Quality, Composer) for A2A pipeline. Use when executing sequential agent workflow with direct return values.
---

# A2A Async Agents

Four async functions that execute sequentially in a pipeline.

## Pipeline Flow

```
Input → Research → FactCheck → Quality → Composer → Output
```

## Quick Start

```javascript
const { Agents } = require('./scripts/agents');

const agents = new Agents();

// Execute full pipeline
const result = await agents.researchAgent({ topic: 'AI' });
await agents.factCheckAgent();
await agents.qualityAgent();
const final = await agents.composerAgent();
```

## API

See [references/agent-api.md](references/agent-api.md)
