---
name: self-healing
description: Self-healing controller with 4 recovery strategies (timeout, error, knowledge_gap, escalation). Use when building fault-tolerant systems that need automatic recovery.
---

# Self-Healing Controller

Automatic recovery system with circuit breaker protection.

## Recovery Strategies

1. **TIMEOUT** — Retry with increased timeout
2. **ERROR** — Retry with exponential backoff
3. **KNOWLEDGE_GAP** — Trigger Deep Learning
4. **UNKNOWN** — Escalate to user

## Circuit Breaker

- Max 3 retries per checkpoint
- Prevents infinite loops
- Escalates after threshold
