# Command Caching Fix Summary

## Problem Identified
The AI caching system was caching ALL commands with a 30-minute TTL, including status commands like `git status`, `ls`, `docker ps`, etc. This meant that when checking for updates (the purpose of these commands), users would get stale cached results instead of fresh data.

## Solution Implemented (v3.1.1)

### 1. Created Cache Classifier (`ai-cache-classifier.ts`)
- Classifies commands into 5 categories:
  - **NEVER**: Status/monitoring commands (always fresh)
  - **SHORT** (30s): Directory context like `pwd`
  - **MEDIUM** (5m): Config files like `package.json`
  - **LONG** (30m): Documentation like `README.md`
  - **PERMANENT** (1h): Static content like `--version`

### 2. Updated AI Cache (`ai-cache.ts`)
- Integrates classifier to make caching decisions
- Status commands bypass cache
- Variable TTLs based on command type
- Cache entries include strategy information

### 3. Updated Command Enhancer (`ai-command-enhancer.ts`)
- Added `MCP_DISABLE_CACHE=true` environment variable option
- Returns `cacheStrategy` in responses
- Added `explainCache()` method for debugging
- Added runtime cache toggle

## Commands That Are NEVER Cached
- `git status`, `git diff`, `git log`, `git branch`
- `ls`, `ls -la`, `ls -l` (any ls variant)
- `docker ps`, `docker stats`, `docker logs`
- `ps`, `ps aux`, `top`, `htop`
- `df`, `du`, `free`, `vmstat`
- `date`, `uptime`
- `find` (file searches)
- `npm ls`, `yarn list` (package listings)
- `curl`, `wget` (network requests)
- `tail -f` (log following)
- And many more status/monitoring commands

## Testing
Run the verification script:
```bash
node test/verify-cache-fix.js
```

## Configuration
To disable caching:
```bash
export MCP_DISABLE_CACHE=true
```

## Benefits
1. Status commands always return fresh data
2. Performance maintained for cacheable commands
3. TTLs prevent serving stale data
4. Control with environment variable
5. Backward compatible with existing code

## Example Usage
When you run `git status` multiple times:
- **Before**: Second call returns 30-minute old cached result ❌
- **After**: Every call executes fresh, showing current changes ✅

This fix ensures the cache improves performance without interfering with commands that need real-time data.
