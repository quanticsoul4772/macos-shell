# Semantic Search

AI-powered semantic search using Voyage AI embeddings and SQLite vector similarity search (VSS). Enables natural language search over command history, documentation, and error solutions.

## Prerequisites

- Voyage AI API key (get one at https://www.voyageai.com/)
- SQLite VSS extension (bundled with the server)

## Configuration

Add `VOYAGE_API_KEY` to your MCP server config:

```json
{
  "macos-shell": {
    "env": {
      "VOYAGE_API_KEY": "pa-YOUR-KEY-HERE"
    }
  }
}
```

Or set it as an environment variable:

```bash
export VOYAGE_API_KEY="pa-YOUR-KEY-HERE"
```

To verify initialization, check the server logs for:
```
Semantic search initialized
Embedding service initialized with voyage-3.5-lite
```

## Tools

### semantic_command_search

Search command history by intent rather than exact text.

**Parameters:**
- `query` (required): natural language description of what you want to find
- `limit` (optional): max results (default: 10)
- `min_similarity` (optional): minimum similarity score 0-1 (default: 0.3)
- `session` (optional): filter to a specific session

**Example:**
```json
{"query": "deploy to production", "limit": 5}
```

### search_documentation

Search command documentation using semantic similarity.

**Parameters:**
- `query` (required): what you want to learn about
- `limit` (optional): max results (default: 5)
- `command_filter` (optional): filter to a specific command (e.g., "git", "docker")

**Example:**
```json
{"query": "how to list files", "command_filter": "ls"}
```

Indexes 70+ common commands across file management, git, docker, network, and system categories.

### recommend_commands

Get command suggestions based on intent and historical patterns.

**Parameters:**
- `intent` (required): what you want to accomplish
- `max_recommendations` (optional): max results (default: 5)
- `min_confidence` (optional): minimum confidence 0-1 (default: 0.4)
- `session` (optional): session for context

Recommendations factor in historical success rate, usage frequency, temporal patterns, and working directory context.

### error_solution_lookup

Find solutions for error messages from the knowledge base.

**Parameters:**
- `error_message` (required): the error text
- `limit` (optional): max results (default: 3)
- `min_similarity` (optional): minimum similarity 0-1 (default: 0.6)

Covers errors in categories: network, filesystem, process, git, docker.

### analyze_output

Extract patterns, insights, and suggestions from command output.

**Parameters:**
- `command` (required): the command that was executed
- `stdout` (required): standard output
- `stderr` (optional): standard error
- `exit_code` (required): exit code
- `duration_ms` (optional): duration in milliseconds
- `cwd` (optional): working directory

Detects output types (structured, error, success, informational) and extracts URLs, file paths, error codes, warnings, process IDs, and port numbers.

### semantic_search_stats

Get statistics about the semantic search system. Takes no parameters.

Returns command count, embeddings generated, cache hit rate, average search latency, and initialization status.

## Technical details

### Embedding model

Uses `voyage-3.5-lite` with 512 dimensions, 8192 token context, and asymmetric query/document embedding. Cost is $0.016 per 1M tokens.

Queries use `query` input type; indexed content uses `document` input type. These exist in different embedding spaces, so similarity scores of 30-50% are typical for good matches.

### Vector storage

SQLite with `sqlite-vss` extension, stored at `~/.macos-shell/embeddings/vectors.db`. Three vector stores: command history, documentation, and error solutions. Uses cosine similarity for search.

### Similarity thresholds

| Tool | Default | Notes |
|------|---------|-------|
| semantic_command_search | 0.3 | Lower for broader results |
| search_documentation | 0.3 | Optimized for query-to-document |
| error_solution_lookup | 0.6 | Higher for precise matches |
| recommend_commands | 0.4 | Balanced confidence |

Score interpretation: 0.8-1.0 very high, 0.6-0.8 high, 0.4-0.6 moderate, 0.3-0.4 low.

### Performance

- First embedding call: 300-500ms (API request)
- Cached embedding: <1ms (LRU cache, 1-hour TTL)
- Vector search: 5-15ms
- Cold search total: 300-500ms
- Warm search total: 150-200ms

### Caching

Embedding cache uses LRU eviction with 1-hour TTL and 1000 entry capacity. Keys are SHA-256 hashes. Typical hit rate is around 68%.

## Troubleshooting

### No results found

- Test your API key: `curl https://api.voyageai.com/v1/embeddings -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"input": ["test"], "model": "voyage-3.5-lite"}'`
- Try lowering `min_similarity` (e.g., 0.2)
- Check `semantic_search_stats` -- if `commandCount` is 0, run some commands first
- Check server logs for initialization errors

### Embedding generation failed

- Verify `VOYAGE_API_KEY` is set in your config
- Check network connectivity to `api.voyageai.com`
- Free tier rate limit is 300 requests/minute

### Low relevance scores

Scores of 30-50% for good matches are expected behavior. Voyage AI uses different embedding spaces for queries and documents, so scores are lower than same-type comparisons.

### Reset the database

```bash
rm -f ~/.macos-shell/embeddings/vectors.db*
# Restart the server to re-initialize
```

## Limitations

- Embedding cost: ~10,000 commands per $1.60, caching reduces cost by ~70%
- Database: ~2KB per command, no automatic cleanup
- Optimized for English commands and documentation
- No graceful degradation if Voyage AI is unavailable
