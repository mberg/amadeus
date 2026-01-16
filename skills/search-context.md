---
name: search-context
description: Search .context for relevant knowledge from previous agents
---

# Search Context

Use this skill to find relevant knowledge from previous agent sessions. The `.context` directory contains accumulated learnings about the codebase.

## Directory Structure

```
.context/
├── knowledge/     # Codebase insights and discoveries
├── issues/        # Completed issue summaries
└── debug/         # Debugging artifacts and root cause analyses
```

## When to Search

Search the context when:
1. Starting work on a new issue - check what's already known
2. Debugging - look for similar issues and their root causes
3. Working on a specific system - find relevant architecture notes
4. Confused about why code is structured a certain way
5. Implementing something similar to past work

## How to Search

### Quick Search (grep)
```bash
# Search all context for a keyword
grep -r "auth" .context/

# Search knowledge articles only
grep -r "race condition" .context/knowledge/

# Search by tag
grep -l "tags:.*redis" .context/knowledge/
```

### By File
```bash
# List all knowledge articles
ls -la .context/knowledge/

# List all issue summaries
ls -la .context/issues/

# List all debug artifacts
ls -la .context/debug/
```

### Read Specific Files
```bash
# Read a knowledge article
cat .context/knowledge/auth-token-refresh.md

# Check if a specific issue was documented
cat .context/issues/ONA-1234.md
```

## What You'll Find

### Knowledge Articles
Insights about how systems work, gotchas, architectural patterns.
- **Title** - Descriptive name
- **Tags** - For searching
- **Source** - Which issue discovered this
- **Content** - The actual insight

### Issue Summaries
What was done and learned when completing past issues.
- **Outcome** - What was accomplished
- **Key Learnings** - Important discoveries
- **Files Modified** - What changed
- **Related Issues** - Connected work

### Debug Artifacts
Root cause analyses from debugging sessions.
- **Symptom** - What was observed
- **Root Cause** - What was actually wrong
- **Solution** - How it was fixed

## Best Practices

1. **Search before diving in** - Someone may have already figured out what you need
2. **Search broadly then narrow** - Start with general terms, refine if needed
3. **Check related issues** - Look at issue summaries for connected work
4. **Update if outdated** - If you find wrong information, correct it
5. **Add what's missing** - If you didn't find what you needed, capture it when you learn it
