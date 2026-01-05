# Semantic Search Features

## Overview

The macOS Shell MCP Server includes AI-powered semantic search capabilities using Voyage AI embeddings and SQLite vector similarity search (VSS). These features enable natural language search over command history, documentation, and error solutions.

**Key Capabilities:**
- 🔍 **Intent-based search** - Find commands by what you want to accomplish, not exact text
- 📚 **Documentation RAG** - Semantic search across 70+ command documentations
- 💡 **Smart recommendations** - Get command suggestions based on intent and context
- 🐛 **Error knowledge base** - Find solutions to errors using similarity matching
- 📊 **Output analysis** - Extract patterns and insights from command output
- 📈 **Command history search** - Search past commands by natural language intent

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Semantic Tools (MCP)                     │
│  semantic_command_search │ search_documentation             │
│  recommend_commands      │ error_solution_lookup            │
│  analyze_output          │ semantic_search_stats            │
└─────────────────────────────────────────────────────────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
    ┌───────────▼────────┐  ┌─▼─────────────┐  ┌──────────────▼─────────┐
    │ Command Indexing   │  │ Documentation │  │ Error Knowledge Base   │
    │     Service        │  │  RAG Service  │  │        Service         │
    └───────────┬────────┘  └────┬──────────┘  └──────────┬─────────────┘
                │                │                         │
    ┌───────────▼────────────────▼─────────────────────────▼─────────────┐
    │             Semantic Search Service                                │
    │  - Embedding generation (Voyage AI)                                │
    │  - Vector storage (SQLite VSS)                                      │
    │  - Similarity search (cosine distance)                              │
    └────────────────────────────────────────────────────────────────────┘
                               │
                ┌──────────────┼──────────────┐
    ┌───────────▼────────┐  ┌─▼──────────────┐
    │ Embedding Service  │  │ Vector Storage │
    │  - Voyage AI API   │  │ - SQLite VSS   │
    │  - LRU cache (1h)  │  │ - vss0 tables  │
    └────────────────────┘  └────────────────┘
```

## Configuration

### Prerequisites

1. **Voyage AI API Key** - Get from https://www.voyageai.com/
2. **SQLite VSS Extension** - Automatically loaded (bundled with server)

### Setup

Add `VOYAGE_API_KEY` to your Claude Desktop config:

**File**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "macos-shell": {
      "command": "node",
      "args": ["/path/to/macos-shell/build/server.js"],
      "env": {
        "VOYAGE_API_KEY": "pa-YOUR-VOYAGE-API-KEY-HERE"
      }
    }
  }
}
```

**Alternative**: Set environment variable globally:

```bash
export VOYAGE_API_KEY="pa-YOUR-VOYAGE-API-KEY-HERE"
```

### Verification

After restart, check initialization logs:

```bash
tail -f ~/.macos-shell/logs/server.log | grep -i "semantic\|embedding\|voyage"
```

Expected output:
```
[INFO] Semantic search initialized
[INFO] Embedding service initialized with voyage-3.5-lite
[INFO] Vector storage initialized: command_history (512 dimensions)
[INFO] Documentation RAG service initialized: 70 commands indexed
```

## Available Tools

### 1. semantic_command_search

Search command history by **intent**, not exact text matching.

**Parameters:**
- `query` (required): Natural language description of what you want to find
- `limit` (optional): Max results to return (default: 10)
- `min_similarity` (optional): Minimum similarity score 0-1 (default: 0.3)
- `session` (optional): Filter to specific session ID or name

**Example Queries:**
```
"deploy to production"
"fix database connection issues"
"install dependencies"
"start the server"
"check git status"
```

**Example Response:**
```json
{
  "query": "deploy to production",
  "results_found": 5,
  "min_similarity": 0.3,
  "results": [
    {
      "rank": 1,
      "command": "npm run deploy",
      "session_id": "abc-123",
      "working_directory": "/Users/me/project",
      "exit_code": 0,
      "duration_ms": 12500,
      "timestamp": "2024-01-15T10:30:00Z",
      "success": true,
      "stdout_preview": "Deployment successful...",
      "stderr_preview": null
    }
  ],
  "explanation": "Found 5 commands semantically similar to: \"deploy to production\""
}
```

**Use Cases:**
- Find commands you ran last week but can't remember exact syntax
- Discover similar commands across different sessions
- Learn from successful past executions
- Build command templates from history

---

### 2. search_documentation

Search command documentation using semantic similarity.

**Parameters:**
- `query` (required): What you want to learn about
- `limit` (optional): Max results (default: 5)
- `command_filter` (optional): Filter to specific command (e.g., "git", "docker")

**Example Queries:**
```
"how to list files"
"git merge conflicts"
"docker volumes"
"change file permissions"
"network debugging"
```

**Example Response:**
```json
{
  "query": "how to list files",
  "results_found": 2,
  "total_commands_indexed": 70,
  "results": [
    {
      "command": "ls",
      "category": "file_management",
      "relevance": 37,
      "description": "List directory contents",
      "usage": "ls [OPTIONS] [FILE]...",
      "common_options": [
        {"-l": "Use long listing format"},
        {"-a": "Show hidden files"},
        {"-h": "Human readable sizes"}
      ],
      "examples": [
        {"command": "ls -la", "description": "List all files with details"},
        {"command": "ls -lh /usr/bin", "description": "List /usr/bin with human-readable sizes"}
      ],
      "related_commands": ["find", "tree", "stat"]
    },
    {
      "command": "find",
      "category": "file_management",
      "relevance": 32,
      "description": "Search for files in directory hierarchy",
      "usage": "find [PATH] [EXPRESSION]",
      "examples": [
        {"command": "find . -name '*.txt'", "description": "Find all .txt files"}
      ]
    }
  ],
  "explanation": "Found 2 relevant command(s) for: \"how to list files\""
}
```

**Indexed Commands:** 70+ common commands including:
- File management: `ls`, `cp`, `mv`, `rm`, `find`, `chmod`, `chown`
- Git operations: `git status`, `git commit`, `git push`, `git merge`
- Docker: `docker ps`, `docker build`, `docker run`, `docker logs`
- Network: `curl`, `wget`, `netstat`, `ping`, `ssh`
- System: `ps`, `top`, `kill`, `systemctl`, `brew`

---

### 3. recommend_commands

Get command suggestions based on intent and historical patterns.

**Parameters:**
- `intent` (required): What you want to accomplish
- `max_recommendations` (optional): Max recommendations (default: 5)
- `min_confidence` (optional): Min confidence threshold 0-1 (default: 0.4)
- `session` (optional): Session ID/name for context

**Example Intents:**
```
"deploy to production"
"fix database connection"
"install dependencies"
"start development server"
"run tests"
```

**Example Response:**
```json
{
  "intent": "deploy to production",
  "recommendations_found": 3,
  "min_confidence": 0.4,
  "recommendations": [
    {
      "rank": 1,
      "command": "npm run deploy",
      "confidence": 0.85,
      "reasoning": "Used 15 times with 93% success rate in similar contexts",
      "success_rate": 93,
      "usage_count": 15,
      "estimated_duration_ms": 12000
    },
    {
      "rank": 2,
      "command": "git push origin main",
      "confidence": 0.72,
      "reasoning": "Frequently precedes deployment commands",
      "success_rate": 98,
      "usage_count": 45,
      "estimated_duration_ms": 2500
    }
  ],
  "explanation": "Found 3 recommended command(s) for: \"deploy to production\""
}
```

**Recommendation Factors:**
- Historical success rate (exit code 0)
- Frequency of use in similar contexts
- Temporal patterns (commands run before/after)
- Working directory context
- Semantic similarity to past successful commands

---

### 4. error_solution_lookup

Find solutions for error messages from the knowledge base.

**Parameters:**
- `error_message` (required): Error message or error text
- `limit` (optional): Max similar errors to return (default: 3)
- `min_similarity` (optional): Min similarity score 0-1 (default: 0.6)

**Example Queries:**
```
"EADDRINUSE: address already in use"
"permission denied"
"command not found: python"
"fatal: not a git repository"
"ENOENT: no such file or directory"
```

**Example Response:**
```json
{
  "query": "EADDRINUSE: address already in use",
  "matches_found": 1,
  "min_similarity": 0.6,
  "results": [
    {
      "rank": 1,
      "error": "EADDRINUSE: address already in use",
      "category": "network",
      "solution": "Port is already in use. Kill the process: lsof -ti:PORT | xargs kill",
      "severity": "medium",
      "examples": [
        "lsof -ti:3000 | xargs kill",
        "lsof -ti:8080 | xargs kill -9"
      ]
    }
  ],
  "explanation": "Found 1 similar error(s) with known solutions"
}
```

**Error Categories:**
- **network**: Port conflicts, connection issues
- **filesystem**: Permission denied, file not found
- **process**: Command not found, dependency issues
- **git**: Repository errors, merge conflicts
- **docker**: Container errors, image issues

---

### 5. analyze_output

Extract patterns, insights, and suggestions from command output.

**Parameters:**
- `command` (required): The command that was executed
- `stdout` (required): Standard output from command
- `stderr` (optional): Standard error from command
- `exit_code` (required): Exit code from command
- `duration_ms` (optional): Duration in milliseconds
- `cwd` (optional): Working directory

**Example Usage:**
```json
{
  "command": "docker ps",
  "stdout": "CONTAINER ID   IMAGE     PORTS                    NAMES\n12abc34def56   nginx     0.0.0.0:8080->80/tcp    web-server\n",
  "exit_code": 0
}
```

**Example Response:**
```json
{
  "command": "docker ps",
  "output_type": "structured",
  "summary": "Shows 1 running container (nginx) exposing port 8080",
  "confidence": 95,
  "key_messages": [
    "nginx container 'web-server' running on port 8080"
  ],
  "extracted_patterns": {
    "urls": [],
    "file_paths": [],
    "error_codes": [],
    "warnings": [],
    "process_ids": ["12abc34def56"],
    "ports": [8080, 80]
  },
  "actionable_items": [
    "Container is healthy and accessible at http://localhost:8080"
  ],
  "follow_up_suggestions": [
    "docker logs web-server",
    "curl http://localhost:8080"
  ],
  "explanation": "Analyzed structured output from \"docker ps\""
}
```

**Output Types Detected:**
- `structured`: Tables, JSON, formatted data
- `error`: Error messages, stack traces
- `success`: Success messages, confirmations
- `informational`: Status updates, logs
- `empty`: No output

**Extracted Patterns:**
- URLs (http, https, ftp)
- File paths (absolute and relative)
- Error codes (HTTP status, errno)
- Warnings and deprecation notices
- Process IDs and PIDs
- Port numbers

---

### 6. semantic_search_stats

Get statistics about semantic search system.

**Parameters:** None

**Example Response:**
```json
{
  "status": "operational",
  "commandCount": 1250,
  "embeddingsGenerated": 1250,
  "cacheHitRate": 0.68,
  "averageSearchLatency": 145,
  "initialized": true,
  "lastIndexed": "2024-01-15T14:22:00Z"
}
```

**Metrics:**
- `commandCount`: Total commands indexed in history
- `embeddingsGenerated`: Total embeddings created
- `cacheHitRate`: Percentage of searches using cached embeddings
- `averageSearchLatency`: Average search time in milliseconds
- `initialized`: Whether service is ready

---

## Technical Details

### Embedding Model

**Model**: `voyage-3.5-lite`
- **Dimensions**: 512
- **Context length**: 8,192 tokens
- **Type**: Asymmetric (query vs document)
- **Cost**: $0.016 per 1M tokens

**Input Types:**
- `query`: Used for search queries (semantic_command_search, search_documentation)
- `document`: Used for indexing (command history, documentation)

**Note**: Query and document embeddings exist in different spaces, resulting in lower similarity scores (30-50% typical) compared to same-type embeddings.

### Vector Storage

**Database**: SQLite with `sqlite-vss` extension
- **Location**: `~/.macos-shell/embeddings/vectors.db`
- **Tables**: 3 main vector stores
  - `command_history_vss`: Command execution history
  - `documentation_vss`: Command documentation
  - `error_knowledge_vss`: Error solutions
- **Search**: Cosine similarity using `vss_search()`
- **Index**: vss0 virtual tables for fast lookup

### Similarity Thresholds

Default thresholds are optimized for query/document inputType difference:

| Tool | Default Threshold | Range | Notes |
|------|------------------|-------|-------|
| semantic_command_search | 0.3 (30%) | 0.0-1.0 | Lower for broader results |
| search_documentation | 0.3 (30%) | 0.0-1.0 | Optimized for query→doc |
| error_solution_lookup | 0.6 (60%) | 0.0-1.0 | Higher for precise matches |
| recommend_commands | 0.4 (40%) | 0.0-1.0 | Balanced confidence |

**Similarity Score Interpretation:**
- `0.8-1.0`: Very high similarity (exact matches)
- `0.6-0.8`: High similarity (strong semantic match)
- `0.4-0.6`: Moderate similarity (related concepts)
- `0.3-0.4`: Low similarity (tangentially related)
- `0.0-0.3`: Very low similarity (likely unrelated)

### Performance

**Embedding Generation:**
- **First call**: 300-500ms (API request)
- **Cached**: <1ms (LRU cache, 1-hour TTL)
- **Batch size**: 100 documents per API call

**Vector Search:**
- **Query time**: 5-15ms (SQLite VSS)
- **Index overhead**: Negligible (<1MB per 1000 docs)
- **Scalability**: Linear with document count

**Overall Latency:**
- **Cold search**: 300-500ms (embedding + search)
- **Warm search**: 150-200ms (cached embedding + search)
- **Hot search**: 5-15ms (cached embedding + cached results)

### Caching Strategy

**Embedding Cache:**
- **Type**: LRU (Least Recently Used)
- **TTL**: 1 hour
- **Max size**: 1000 embeddings
- **Key**: SHA-256 hash of text content
- **Hit rate**: ~68% (typical workload)

**Result Cache:**
- Not implemented (queries vary too much)
- Consider adding for common queries

---

## Initialization

### Automatic Initialization

The server automatically initializes semantic search on first startup:

1. **Load VSS Extension** - Loads `sqlite-vss` into SQLite
2. **Create Tables** - Creates vector storage tables if missing
3. **Initialize Services** - Starts embedding and search services
4. **Index Documentation** - Indexes 70+ command docs (23 errors, 58 successful)
5. **Load Error KB** - Loads common error solutions
6. **Ready** - Server accepts requests

**Initialization Time**: 2-5 seconds (one-time on first start)

### Manual Re-initialization

To force re-initialization (e.g., after API key change):

```bash
# Backup existing database
cp ~/.macos-shell/embeddings/vectors.db ~/.macos-shell/embeddings/vectors.db.backup

# Delete database to force fresh initialization
rm -f ~/.macos-shell/embeddings/vectors.db*

# Restart server
# In Claude Desktop: /mcp → Select macos-shell → Restart
```

---

## Troubleshooting

### Issue: "No results found"

**Symptoms:**
- All searches return 0 results
- `results_found: 0` in all responses

**Possible Causes:**

1. **Invalid API Key**
   ```bash
   # Test API key directly
   curl https://api.voyageai.com/v1/embeddings \
     -H "Authorization: Bearer YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"input": ["test"], "model": "voyage-3.5-lite"}'
   ```

   **Fix**: Update API key in `~/Library/Application Support/Claude/claude_desktop_config.json`

2. **Similarity Threshold Too High**
   - Default thresholds may filter all results
   - Try lowering `min_similarity` parameter:
     ```json
     {"query": "list files", "min_similarity": 0.2}
     ```

3. **Database Not Initialized**
   - Check logs for initialization errors:
     ```bash
     tail -50 ~/.macos-shell/logs/server.log | grep -i "error\|fatal"
     ```

4. **No Indexed Commands**
   - Check stats:
     ```
     Use tool: semantic_search_stats
     ```
   - If `commandCount: 0`, run some commands first to build history

### Issue: "Embedding generation failed"

**Symptoms:**
- Error: "Failed to generate embedding"
- Searches timeout or fail

**Possible Causes:**

1. **API Key Not Configured**
   ```bash
   # Check environment variable is set
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | grep VOYAGE
   ```

2. **Network Issues**
   - Check connectivity to Voyage AI:
     ```bash
     curl -I https://api.voyageai.com
     ```

3. **Rate Limiting**
   - Voyage AI limits: 300 requests/minute (free tier)
   - Wait 60 seconds and retry

### Issue: "VSS search error"

**Symptoms:**
- Error: "LIMIT required on vss_search() queries"
- Database errors in logs

**Possible Causes:**

1. **Corrupted Database**
   - Delete and re-initialize:
     ```bash
     rm -f ~/.macos-shell/embeddings/vectors.db*
     # Restart server
     ```

2. **VSS Extension Not Loaded**
   - Check logs for "sqlite-vss loaded successfully"
   - Rebuild server: `npm run build`

### Issue: Low relevance scores

**Symptoms:**
- Relevant results have low similarity (20-40%)
- Expected matches appear but with low confidence

**Explanation:**
- This is **expected behavior** due to query vs document embedding spaces
- Voyage AI uses different embedding spaces for queries and documents
- Typical similarity: 30-50% for good matches

**Not a bug - working as designed!**

### Debug Logging

Enable debug logging to diagnose issues:

```bash
# In ~/.macos-shell/config.json (create if missing)
{
  "logging": {
    "level": "debug",
    "enableSemanticDebug": true
  }
}
```

This logs:
- Embedding generation details
- VSS query results before filtering
- Similarity score distributions
- Cache hit/miss patterns

---

## Best Practices

### Query Optimization

**DO:**
- ✅ Use natural language: "deploy to production"
- ✅ Be specific: "fix database connection timeout"
- ✅ Include action verbs: "install", "deploy", "fix", "check"
- ✅ Adjust `min_similarity` if too many/few results

**DON'T:**
- ❌ Use exact command syntax: `npm run deploy --prod`
- ❌ Single words: "deploy" (too vague)
- ❌ Expect exact matches (30-50% similarity is typical)

### Command History

**Build useful history:**
- Run diverse commands to improve recommendations
- Include successful AND failed attempts (failures teach patterns)
- Use descriptive scripts and aliases
- Maintain 100+ commands for best results

### Performance

**Optimize for speed:**
- Cache hits return in <1ms
- Similar queries use cached embeddings
- Batch operations when possible
- Consider `limit` parameter for faster responses

### Security

**Protect sensitive data:**
- API keys are cached but not logged
- Command output may contain secrets (be cautious with analyze_output)
- Database contains full command history (secure `~/.macos-shell/`)
- Embeddings don't leak original text but similarity reveals patterns

---

## Limitations

### Known Constraints

1. **Embedding Cost**
   - $0.016 per 1M tokens (Voyage AI)
   - ~100 tokens per command = 10,000 commands per $1.60
   - Caching reduces cost by ~70%

2. **Database Size**
   - ~2KB per command (including embedding)
   - 10,000 commands = 20MB database
   - No automatic cleanup (manual `rm -f vectors.db` to reset)

3. **Query/Document Mismatch**
   - Lower similarity scores (30-50% typical)
   - Adjust expectations and thresholds accordingly

4. **Cold Start**
   - First query after restart: 300-500ms
   - Subsequent queries: 150-200ms
   - Consider warming cache with common queries

5. **Language Support**
   - Optimized for English commands and documentation
   - Other languages may have lower accuracy

### Future Improvements

- [ ] Automatic database cleanup and archiving
- [ ] Multi-language documentation support
- [ ] Real-time command indexing (currently batch)
- [ ] Query expansion and synonym handling
- [ ] Personalized similarity scoring
- [ ] Cross-session pattern learning

---

## Examples

### Example 1: Find Past Deployment Commands

```json
// Tool: semantic_command_search
{
  "query": "deploy to production",
  "limit": 5,
  "min_similarity": 0.3
}

// Response: 5 past deployment commands with context
// Use to build deployment checklist or script
```

### Example 2: Learn Git Merge Conflict Resolution

```json
// Tool: search_documentation
{
  "query": "resolve git merge conflicts",
  "command_filter": "git"
}

// Response: git merge, git rebase docs with examples
// Learn proper conflict resolution workflow
```

### Example 3: Troubleshoot Port Conflict

```json
// Tool: error_solution_lookup
{
  "error_message": "Error: listen EADDRINUSE: address already in use :::3000"
}

// Response: Solution with lsof command to kill process
// Execute suggested solution immediately
```

### Example 4: Get Docker Command Suggestions

```json
// Tool: recommend_commands
{
  "intent": "start docker container with volume",
  "max_recommendations": 3
}

// Response: docker run commands with volume mounts
// Based on your past successful docker operations
```

### Example 5: Analyze Test Output

```json
// Tool: analyze_output
{
  "command": "npm test",
  "stdout": "PASS src/utils.test.ts\n  ✓ should parse config (12 ms)\n  ✓ should validate input (8 ms)\n\nTest Suites: 1 passed, 1 total\nTests: 2 passed, 2 total",
  "exit_code": 0,
  "duration_ms": 2450
}

// Response: Summary, extracted patterns, follow-up suggestions
// "All tests passed. Consider adding edge case tests."
```

---

## FAQ

**Q: How accurate is semantic search compared to exact matching?**

A: Semantic search finds **conceptually similar** commands, not exact matches. Accuracy is ~85% for common intents, but depends on command history diversity. Exact matching (grep) is better for known syntax, semantic search is better for "I did something similar last week but can't remember the command."

**Q: Does semantic search work with no command history?**

A: Documentation search and error lookup work immediately (pre-indexed). Command search and recommendations require 10+ commands to be useful, 100+ commands for best results.

**Q: What if Voyage AI is down or slow?**

A: Fail-fast: Server returns error immediately. No graceful degradation to exact matching. This is by design - semantic search is all-or-nothing. Consider adding fallback in client code.

**Q: Can I use a different embedding model?**

A: Not currently. Voyage-3.5-lite is hardcoded. To add support for OpenAI/Cohere/etc:
1. Update `src/services/embedding-service.ts` with new client
2. Update dimension handling (OpenAI uses 1536, not 512)
3. Rebuild vector database with new dimensions

**Q: How do I clear the database?**

```bash
rm -f ~/.macos-shell/embeddings/vectors.db*
# Restart server - will re-initialize fresh database
```

**Q: Can I export/import the database?**

A: Yes! The database is a standard SQLite file:

```bash
# Export
sqlite3 ~/.macos-shell/embeddings/vectors.db .dump > backup.sql

# Import
sqlite3 new_vectors.db < backup.sql
```

**Note**: Embeddings are ~2KB each, so backups can be large.

---

## Support

For issues or questions:
1. Check troubleshooting section above
2. Enable debug logging
3. Check server logs: `~/.macos-shell/logs/server.log`
4. File issue: https://github.com/quanticsoul4772/macos-shell/issues

---

## License

MIT License - See LICENSE file for details.
