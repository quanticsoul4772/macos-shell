# AI Features (v3.2.0)

This macOS Shell MCP server includes features for AI assistant usage patterns.

## Features

| Feature | Impact | Example |
|---------|--------|---------|
| **Caching** | Faster responses | `cat README.md`: 120ms → 1ms |
| **Deduplication** | Fewer redundant executions | Identical calls execute once |
| **Error Recovery** | Correction mechanisms | Typos corrected, retries handled |
| **Memory Optimization** | 97% reduction | 1.6MB → 48KB per session |

## 1. Cache System

The server includes a 4-phase caching system for performance.

**Capabilities:**
- Manual cache control via MCP tools
- Duplicate detection
- Persistent learning across sessions
- Output analysis for dynamic content

**Cache strategies:**
- Never cached: Dynamic commands (`ps`, `date`, `ls -la`)
- Short (30s): Session context (`pwd`, `whoami`)
- Medium (5m): Config files (`cat package.json`)
- Long (30m): Documentation (`cat README.md`)
- Permanent (1h): Version info (`node --version`)

**[See cache documentation](docs/features/CACHE_SYSTEM.md)**

## 2. Command Deduplication

- 10-second window prevents duplicate executions
- Normalizes command variations (`ls -la` = `ls -al`)
- Batches identical concurrent requests

## 3. Error Recovery

- Corrects common typos in file paths
- Retries network errors with exponential backoff
- Suggests command alternatives (e.g., `python` → `python3`)
- Adds necessary flags (e.g., `--legacy-peer-deps`)

## 4. Memory Optimization (v3.2.0)

- AI_BUFFER_SIZE: 300 lines (for AI context windows)
- Reduced from 10,000 lines to 300 lines per buffer
- 97% memory reduction while maintaining functionality
- Background process output managed

## Configuration

### Disable Caching
```bash
export MCP_DISABLE_CACHE=true
```

### Monitor Performance
Performance stats are logged every minute:
```
=== AI Optimization Stats ===
Cache Hit Rate: 45.2%
Commands Deduped: 23.1%
Errors Recovered: 8.5%
Memory Usage: 48KB/session
===========================
```

## Design Philosophy

These features are for AI assistants:
- No interactive features or progress bars
- Caching (not "live" updates)
- Error correction without confirmation
- Pattern-based command prediction
- Memory usage for AI context limits

Features are active by default.
