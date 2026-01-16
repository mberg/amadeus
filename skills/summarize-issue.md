---
name: summarize-issue
description: Create an issue summary when completing work for future agent reference
---

# Summarize Issue

Use this skill when you've completed work on an issue. Create a summary that captures what was done and learned so future agents can benefit.

## When to Summarize

Create a summary when:
1. Setting an issue to "Done" or "Review"
2. A significant milestone is reached
3. You've learned something that would help future work on related issues

## How to Create a Summary

Create a markdown file at `.context/issues/{IDENTIFIER}.md`:

```markdown
# {IDENTIFIER}: {Issue Title}

completed: {ISO date}

---

## Outcome

[1-2 sentences describing what was accomplished]

## Key Learnings

- [Important discovery or insight]
- [Gotcha or non-obvious behavior found]
- [Pattern that worked well]

## Files Modified

- path/to/file1.ts
- path/to/file2.ts

## Related Issues

- ONA-XXXX (previous work this built on)
- ONA-YYYY (issue that may benefit from this work)
```

## Example

```markdown
# ONA-1234: Fix authentication token refresh

completed: 2024-01-15T14:30:00Z

---

## Outcome

Fixed race condition in JWT token refresh that caused intermittent auth failures
during high-traffic periods.

## Key Learnings

- The refresh endpoint needs Redis locking to prevent concurrent refreshes
- Token expiry threshold of 5 minutes is too aggressive; changed to 10 minutes
- Auth middleware logs are at DEBUG level - increase verbosity for production debugging

## Files Modified

- src/auth/middleware.ts
- src/auth/refresh.ts
- src/config/auth.ts

## Related Issues

- ONA-1200 (reported the symptom)
- ONA-1250 (follow-up to add metrics)
```

## What to Include

### Always Include
- **Outcome** - What was the end result?
- **Files Modified** - What changed?

### Include When Relevant
- **Key Learnings** - Non-obvious discoveries
- **Related Issues** - Connected work
- **Debug insights** - If significant debugging was involved, consider also creating a debug artifact

## Best Practices

1. **Write for future you** - What would help if you came back to this in 6 months?
2. **Be specific about files** - Future agents can quickly orient themselves
3. **Link related issues** - Build the knowledge graph
4. **Capture the "why"** - Not just what changed, but why this approach was chosen
5. **Don't over-document** - Focus on what's useful, not everything that happened
