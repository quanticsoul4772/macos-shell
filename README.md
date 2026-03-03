# macOS Shell MCP Server

An MCP server for shell command execution on macOS with session management, background processes, caching, and semantic search.

## Installation

```bash
git clone https://github.com/quanticsoul4772/macos-shell.git
cd macos-shell
npm install
npm run build
```

## Configuration

### Claude Code

Add to `~/.claude.json` under `mcpServers`:

```json
{
  "macos-shell": {
    "type": "stdio",
    "command": "node",
    "args": ["/path/to/macos-shell/build/server.js"],
    "env": {
      "VOYAGE_API_KEY": "your-voyage-api-key"
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "macos-shell": {
      "command": "node",
      "args": ["/path/to/macos-shell/build/server.js"],
      "env": {
        "VOYAGE_API_KEY": "your-voyage-api-key"
      }
    }
  }
}
```

The `VOYAGE_API_KEY` enables semantic search features. Without it, set `"EMBEDDINGS_ENABLED": "false"` instead.

## Tools (41)

### Command execution (3)
- `run_command` -- execute a shell command
- `run_script` -- execute a multi-line shell script
- `batch_execute_enhanced` -- execute commands with conditional logic and retries

### Sessions (3)
- `create_shell_session` -- create a named session with isolated environment
- `list_shell_sessions` -- list active sessions
- `close_session` -- close a session and free resources

### Navigation and environment (5)
- `cd` -- change working directory
- `pwd` -- get current working directory
- `set_env` -- set environment variables
- `get_env` -- get environment variables
- `history` -- view command history

### Background processes (8)
- `run_background` -- start a background process
- `list_processes` -- list processes with resource usage
- `get_process_output` -- retrieve output with search
- `stream_process_output` -- stream output as it arrives
- `kill_process` -- terminate a process
- `cleanup_orphans` -- manage processes from previous sessions
- `kill_all_matching` -- kill processes matching a pattern
- `save_process_output` -- save output to a file

### System (3)
- `get_system_health` -- system health metrics
- `preflight_check` -- validate conditions before operations
- `system_profile` -- gather system information

### SSH (8)
- `ssh_interactive_start` -- start an SSH session
- `ssh_interactive_send` -- send input to SSH session
- `ssh_interactive_control` -- send control characters
- `ssh_interactive_output` -- get output with search
- `ssh_interactive_wait` -- wait for new output
- `ssh_interactive_resize` -- resize terminal
- `ssh_interactive_close` -- close SSH session
- `ssh_interactive_list` -- list active SSH sessions

### Cache management (5)
- `cache_stats` -- cache statistics
- `cache_clear_command` -- clear specific command from cache
- `cache_clear_pattern` -- clear commands matching a pattern
- `cache_mark_never` -- mark a command to never cache
- `cache_explain` -- explain cache decision for a command

### Semantic search (6)
Requires `VOYAGE_API_KEY`. See [docs/SEMANTIC_SEARCH.md](docs/SEMANTIC_SEARCH.md) for details.

- `semantic_command_search` -- search command history by intent
- `search_documentation` -- search command docs semantically
- `recommend_commands` -- get suggestions based on intent
- `error_solution_lookup` -- find solutions for error messages
- `analyze_output` -- extract patterns from command output
- `semantic_search_stats` -- search system statistics

## Environment variables

| Variable | Description |
|----------|-------------|
| `VOYAGE_API_KEY` | Voyage AI API key for semantic search |
| `EMBEDDINGS_ENABLED` | Set to `false` to disable semantic search |
| `MCP_DISABLE_CACHE` | Set to `true` to disable command caching |
| `MCP_DEBUG` | Set to `true` for debug logging to stderr |
| `MCP_LOG_FILE` | Path to write log output |

## Limitations

- macOS only (uses `/bin/zsh`)
- 30-second default command timeout (configurable up to 10 minutes)
- Commands run with the permissions of the user running the MCP client
- Output buffer limited to 300 lines per background process
- Sudo commands require passwordless sudo or will hang

## Further documentation

- [Changelog](docs/CHANGELOG.md)
- [Semantic search](docs/SEMANTIC_SEARCH.md)
- [Cache system](docs/features/CACHE_SYSTEM.md)
- [Testing](docs/TESTING.md)

## Development

See [CLAUDE.md](CLAUDE.md) for build commands, architecture, testing, and contribution details.

## License

ISC
