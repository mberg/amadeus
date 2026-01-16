---
name: capture-learning
description: Save a codebase insight or discovery to .context for future agents
---

# Capture Learning

Use this skill when you've discovered something valuable about the codebase that future agents should know. This could be:

- How a system or component actually works (vs. how it might appear)
- Gotchas, edge cases, or non-obvious behavior
- Architectural patterns and why they're used
- Integration points between systems
- Performance considerations
- Security notes

## When to Capture

Capture learnings when you:
1. Spend significant time understanding how something works
2. Discover something surprising or non-obvious
3. Find documentation that's missing or outdated
4. Debug an issue and find the root cause
5. Learn why code is structured a certain way

## How to Use

Create a markdown file in `.context/knowledge/` with:

```markdown
# [Descriptive Title]

tags: [comma-separated relevant tags]
source: [issue identifier, e.g., ONA-1234]
created: [ISO date]

---

[Your explanation here. Be specific and include:
- What you discovered
- Where the relevant code lives (file paths, line numbers)
- Why it matters
- Examples if helpful]
```

## Example

```markdown
# Auth Token Refresh Race Condition

tags: auth, jwt, race-condition, middleware
source: ONA-1234
created: 2024-01-15T10:30:00Z

---

The JWT refresh logic in `src/auth/middleware.ts:45` has a subtle race condition.

**The Issue:** When a token is within 5 minutes of expiry, the middleware attempts
a refresh. However, concurrent requests can all trigger refreshes simultaneously.

**The Solution:** The refresh endpoint uses Redis SETNX for locking. Always check
for an existing refresh before triggering a new one.

**Key Files:**
- `src/auth/middleware.ts` - Token validation and refresh trigger
- `src/auth/refresh.ts` - Actual refresh logic with Redis lock
- `src/config/auth.ts` - Timing constants (REFRESH_THRESHOLD_MS)
```

## Best Practices

1. **Be specific** - Include file paths, function names, line numbers
2. **Explain why** - Don't just describe what, explain why it matters
3. **Use good tags** - Future agents will search by these
4. **Link to issues** - Reference the source issue for more context
5. **Keep it focused** - One insight per file, not everything you learned
