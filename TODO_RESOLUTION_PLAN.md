# TODO Resolution Plan - Critic Review

**Date:** 2026-02-21
**Status:** Pending Review

---

## TODO Items Found

### 1. `src/post-session-trigger.js` Line ~278
```javascript
// TODO: Send Telegram notification
```

**Context:** After post-session analysis, system should notify user about suggested topics

**Current Behavior:** Logs to console only

**Proposed Solution:**
```javascript
// Option A: Direct Telegram integration
- Import telegram-bot module
- Send notification with suggested topics
- Include quick-action buttons (Approve/Reject)

// Option B: Queue for async notification
- Add to notification queue
- Telegram bot processes queue periodically
- More robust, less coupling
```

**Complexity:** Low
**Time Estimate:** 30-60 minutes
**Priority:** Medium

---

### 2. `src/post-session-trigger.js` Line ~25
```javascript
console.log('[PostSessionTrigger] TODO: Integrate with OpenClaw session storage');
```

**Context:** Currently uses mock/test session loading

**Current Behavior:** Placeholder console.log

**Proposed Solution:**
```javascript
// Integrate with actual OpenClaw session system
- Read from /root/.openclaw/agents/main/sessions/*.jsonl
- Filter by timestamp (last 24 hours)
- Parse OpenClaw session format
- Extract user messages for analysis
```

**Complexity:** Medium
**Time Estimate:** 1-2 hours
**Priority:** High (needed for production)

**Implementation Details:**
- Need to understand OpenClaw session format
- Handle JSONL parsing
- Filter relevant messages (user + assistant)
- Extract learning intents

---

### 3. `src/evolution/change-applier.js` Line ~10
```javascript
// TODO: Add usage example
```

**Context:** Documentation improvement

**Proposed Solution:**
```javascript
/**
 * Usage Example:
 * 
 * const applier = new ChangeApplier();
 * await applier.init();
 * 
 * // Apply a new skill
 * await applier.apply({
 *   type: 'new_skill',
 *   skill: {
 *     name: 'prevent-git-error',
 *     description: 'Prevents git add -A'
 *   }
 * });
 */
```

**Complexity:** Low
**Time Estimate:** 10 minutes
**Priority:** Low

---

### 4. `src/evolution/change-applier.js` Line ~150
```javascript
// TODO: Implement skill logic
```

**Context:** Skill template generation needs actual implementation

**Current Behavior:** Creates skeleton files only

**Proposed Solution:**
```javascript
// Generate actual skill logic based on pattern type

// For error prevention:
- Detect pattern in session messages
- Intercept before error occurs
- Suggest correct action

// For automation:
- Trigger on specific conditions
- Execute predefined actions
- Log results

// For guidance:
- Match context to skill
- Provide relevant suggestions
- Track usefulness
```

**Complexity:** High
**Time Estimate:** 3-4 hours
**Priority:** Medium (can use skeleton for now)

---

## Critic Assessment

### Questions for Critic:

1. **Priority Order:** Should we tackle OpenClaw integration first (TODO #2) or is notification (TODO #1) more important?

2. **Architecture:** For TODO #1, should we:
   - Directly call Telegram bot (tight coupling)
   - Use event queue (loose coupling)
   - Add to Evolution proposals (existing flow)

3. **TODO #4 Scope:** Should we:
   - Implement full skill logic now
   - Keep skeleton and iterate based on usage
   - Create separate "Skill Runtime" component

4. **Missing TODOs:** Are there other critical gaps we should track?

### Risk Assessment:

| TODO | Risk if Not Fixed | Impact |
|------|-------------------|--------|
| #1 (Notification) | User misses suggestions | Medium |
| #2 (OpenClaw) | System can't learn from sessions | **High** |
| #3 (Docs) | Harder to use | Low |
| #4 (Skill Logic) | Skills don't actually work | **High** |

---

## Proposed Implementation Order:

1. **TODO #2** - OpenClaw integration (highest impact)
2. **TODO #4** - Skill logic implementation (makes system useful)
3. **TODO #1** - Telegram notifications (user experience)
4. **TODO #3** - Documentation (nice to have)

---

## Estimates Summary:

| TODO | Time | Complexity |
|------|------|------------|
| #1 Notification | 30-60 min | Low |
| #2 OpenClaw | 1-2 hours | Medium |
| #3 Documentation | 10 min | Low |
| #4 Skill Logic | 3-4 hours | High |
| **Total** | **5-8 hours** | - |

---

**Awaiting Critic Review**
