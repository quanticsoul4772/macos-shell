# Cache System

The macOS Shell MCP server includes a 4-phase caching system that adapts to usage patterns while preventing stale data.

## Overview

The cache system determines which commands can be cached and for how long, learning from usage patterns to optimize performance without sacrificing data freshness.

### Features

- **Classification**: Commands are classified into caching strategies based on their nature
- **Learning**: Detects duplicate outputs and adjusts caching behavior
- **Persistence**: Learned rules persist across server restarts
- **Output Analysis**: Analyzes command output for dynamic content patterns
- **Manual Control**: 5 MCP tools provide control over cache behavior

## Cache Management Tools

### 1. cache_stats
View cache statistics including hit rates, memory usage, and performance metrics.

```json
{
  "tool": "cache_stats"
}
```

Returns:
- Total cache entries
- Memory usage
- Hit/miss statistics
- Average time saved
- Top cached commands

### 2. cache_explain
Shows why a command has its current cache strategy.

```json
{
  "tool": "cache_explain",
  "parameters": {
    "command": "git status"
  }
}
```

Returns:
- Current cache strategy (NEVER, SHORT, MEDIUM, LONG, PERMANENT)
- Reason for the strategy
- Rule source (hardcoded, learned, or user-defined)

### 3. cache_clear_command
Remove commands from the cache.

```json
{
  "tool": "cache_clear_command",
  "parameters": {
    "command": "ls -la",
    "cwd": "/optional/directory"
  }
}
```

### 4. cache_clear_pattern
Clear cache entries using regex patterns.

```json
{
  "tool": "cache_clear_pattern",
  "parameters": {
    "pattern": "docker.*"
  }
}
```

### 5. cache_mark_never
Mark a command to never be cached.

```json
{
  "tool": "cache_mark_never",
  "parameters": {
    "command": "ps aux",
    "reason": "Process list changes constantly",
    "pattern": false
  }
}
```

## How It Works

### Cache Strategies

Commands are classified into five strategies:

| Strategy | TTL | Use Case | Examples |
|----------|-----|----------|----------|
| NEVER | 0s | Status/monitoring commands | `git status`, `ls`, `docker ps` |
| SHORT | 30s | Directory context | `pwd` |
| MEDIUM | 5m | Config files | `cat package.json` |
| LONG | 30m | Documentation | `cat README.md` |
| PERMANENT | 1h | Static content | `node --version` |

### Learning System

The cache system learns through four phases:

#### Phase 1: Manual Control
Runtime control through the 5 MCP tools listed above.

#### Phase 2: Duplicate Detection
- Monitors command outputs using SHA256 hashing
- Detects when identical commands produce identical results within 5 seconds
- Creates never-cache rules for commands with changing outputs

#### Phase 3: Persistent Learning
- Saves learned rules to `~/.mcp-cache-rules.json`
- Maintains up to 1000 rules with LRU eviction
- Tracks usage statistics and timestamps
- Survives server restarts

#### Phase 4: Output Analysis
Detects dynamic content patterns in command output:
- **Timestamps**: Date/time patterns
- **Process IDs**: Numeric identifiers that change
- **Counters**: Incrementing values
- **File Sizes**: Byte measurements
- **IP Addresses**: Network addresses
- **High Change Patterns**: Frequently changing values

## Architecture

```
User Command → Cache Check → Execute if needed → Output Analysis
                    ↓                                    ↓
            Duplicate Detection ← ─ ─ ─ ─ ─ → Pattern Detection
                    ↓                                    ↓
            Rule Creation ← ─ ─ ─ ─ ─ ─ ─ → Dynamic Prevention
                    ↓
            Persistent Storage
```

## Configuration

### Environment Variables

- `MCP_DISABLE_CACHE=true` - Disable caching
- `MCP_CACHE_DEBUG=true` - Enable cache logging

### File Locations

- Cache rules: `~/.mcp-cache-rules.json`
- Log files: Check server logs for cache decisions

## Common Patterns

### Commands That Are Never Cached

Status and monitoring commands execute fresh:
- Git: `status`, `diff`, `log`, `branch`
- Docker: `ps`, `stats`, `logs`
- System: `ps`, `top`, `htop`, `df`, `du`
- File: `ls`, `find`, `tail -f`
- Network: `curl`, `wget`, `ping`
- Time: `date`, `uptime`

### Commands That Are Cached

Static or slowly-changing content:
- Version checks: `--version` commands (1 hour)
- Documentation: `README.md`, help files (30 minutes)
- Configuration: `package.json`, config files (5 minutes)
- Working directory: `pwd` (30 seconds)

## Usage

1. **Learning**: The system adapts to usage patterns
2. **Manual Override**: Use `cache_mark_never` for commands that should never be cached
3. **Clear When Needed**: Use `cache_clear_command` after changes
4. **Monitor Performance**: Check `cache_stats` to see cache effectiveness

## Troubleshooting

### Cache returning stale data?
1. Check the cache strategy: `cache_explain`
2. Clear the command: `cache_clear_command`
3. Mark as never-cache if needed: `cache_mark_never`

### Want to disable caching?
```bash
export MCP_DISABLE_CACHE=true
```

### Need to reset learned rules?
```bash
rm ~/.mcp-cache-rules.json
```

## Performance Impact

The cache system provides:
- **Time saved**: 10-50ms per cached command
- **Hit rates**: 30-60% for mixed workloads
- **Memory usage**: Under 10MB
- **Learning overhead**: <1ms per command execution

The system optimizes cache hit rates while preventing stale data through pattern detection and learning.
