---
name: adaptive-rag
description: Adaptive RAG with dynamic retrieval strategies based on query complexity
---

# Adaptive RAG

Chooses retrieval strategy based on query:
- Simple: BM25 only (fast)
- Moderate: Vector + BM25 (balanced)
- Complex: Vector + BM25 + Graph + Two-hop (full)
