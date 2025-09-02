# macOS Shell MCP Server

A Model Context Protocol (MCP) server that provides shell command execution on macOS with session management, working directory persistence, environment isolation, and background process management.

## Architecture

![macOS Shell MCP Server Architecture](https://raw.githubusercontent.com/quanticsoul4772/macos-shell/main/docs/architecture.svg)

The server includes a layer that intercepts all commands, providing caching (85% hit rate), deduplication (80% reduction), and error correction. Commands that hit the cache return in ~1ms, while 15% of requests require tool execution.

## Installation

```bash
# Clone the repository
git clone https://github.com/quanticsoul4772/macos-shell.git
cd macos-shell

# Install dependencies
npm install

# Build the server
npm run build

# Run tests (optional)
npm test

# Start the server (optional)
npm start
```

## Configuration

Add to your Claude Desktop configuration file:

**Location**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "macos-shell": {
      "command": "node",
      "args": [
        "/path/to/macos-shell/build/server.js"
      ],
      "type": "stdio"
    }
  }
}
```

Restart Claude Desktop after adding the configuration.

## Features

### Features
- **Session Management**: Create multiple named sessions with isolated environments
- **Working Directory Persistence**: Each session maintains its own working directory
- **Environment Variables**: Set and manage environment variables per session
- **Command History**: Track executed commands with timing and output
- **Script Execution**: Run multi-line shell scripts
- **Background Processes**: Run processes in the background with output capture
- **Error Handling**: Error reporting with exit codes

### Caching and Performance

#### Command Caching
- Cacheable commands execute in 1ms vs 120ms uncached
- Status commands (`git status`, `ls`, `docker ps`) are never cached
- Variable TTLs: 
  - Never: Status/monitoring commands
  - 30s: Directory context (`pwd`, `whoami`)
  - 5m: Config files (`cat package.json`)
  - 30m: Documentation (`cat README.md`)
  - 1h: Static content (`node --version`, `--help`)
- Cache hit indicator: `"cached": true` with `"cacheStrategy"` in responses
- Disable caching: Set `MCP_DISABLE_CACHE=true` environment variable

#### Deduplication
- 10-second deduplication window for identical commands
- Batches multiple executions into single operation
- Normalizes command variations (`ls -la` = `ls -al`)

#### Error Recovery
- Corrects file path typos using Levenshtein distance
- Retries network errors with exponential backoff
- Adds flags like `--legacy-peer-deps` for npm errors
- Suggests command alternatives (python → python3)

#### Performance Monitoring
- Stats logged every minute to stderr
- Tracks cache hit rate, deduplication rate, error recovery
- Shows command patterns for optimization

## Available Tools (35 Total)

### Command Execution (3 tools)
- **`run_command`** - Execute shell commands
  - Parameters: `command`, `args[]`, `session?`, `cwd?`, `env?`, `timeout?`
  - Returns: Exit code, stdout, stderr
  
- **`run_script`** - Execute multi-line shell scripts
  - Parameters: `script`, `session?`, `timeout?`
  - Returns: Exit code, stdout, stderr

- **`batch_execute_enhanced`** - Execute commands with conditional logic and retries
  - Parameters: `commands[]` with conditions, `parallel?`, `stopOnFirstFailure?`, `maxOutputLines?`, `includeFullOutput?`
  - Returns: Execution results with skip reasons
  - Output truncation to prevent context window overload

### Session Management (3 tools)
- **`create_shell_session`** - Create a new named session with isolated environment
  - Parameters: `name`, `cwd?`, `env?`
  - Returns: Session ID and working directory
  
- **`list_shell_sessions`** - List active sessions with details
  - Parameters: None
  - Returns: List of sessions with creation time, last used, command count, background process count
  
- **`close_session`** - Close a session and free resources
  - Parameters: `session`
  - Returns: Success confirmation

### Working Directory (2 tools)
- **`cd`** - Change working directory (persists in session)
  - Parameters: `path`, `session?`
  - Returns: New working directory path
  
- **`pwd`** - Get current working directory
  - Parameters: `session?`
  - Returns: Current directory path

### Environment Management (2 tools)
- **`set_env`** - Set environment variables in a session
  - Parameters: `name`, `value`, `session?`
  - Returns: Confirmation with variable details
  
- **`get_env`** - Get environment variables
  - Parameters: `name?`, `session?`
  - Returns: Variable value(s)

### History (1 tool)
- **`history`** - View command history for a session
  - Parameters: `session?`, `limit?`
  - Returns: Commands with timestamps, exit codes, duration

### Background Process Management (8 tools)
- **`run_background`** - Start a command in the background
  - Parameters: `command`, `args[]`, `session?`, `name?`
  - Returns: Process ID, PID, status
  
- **`list_processes`** - List background processes with resource monitoring
  - Parameters: `session?` (optional filter)
  - Returns: JSON with processes including CPU%, memory, trends, and runtime
  
- **`get_process_output`** - Retrieve output from a background process with search
  - Parameters: `process_id`, `lines?`, `from_line?`, `search?`, `case_sensitive?`
  - Returns: Buffered stdout/stderr with line numbers and type indicators
  
- **`stream_process_output`** - Stream output from a background process
  - Parameters: `process_id`, `after_line?`, `timeout?`, `max_lines?`
  - Returns: New output lines as they arrive, with streaming hints
  
- **`kill_process`** - Terminate a background process (including orphaned processes)
  - Parameters: `process_id`, `signal?` (SIGTERM/SIGKILL)
  - Returns: Success confirmation
  
- **`cleanup_orphans`** - Manage processes from previous server sessions
  - Parameters: `mode?` (list/kill/interactive), `force?` (use SIGKILL)
  - Returns: List of orphans or cleanup results

- **`kill_all_matching`** - Kill processes matching a pattern
  - Parameters: `pattern`, `pattern_type?` (text/regex), `signal?`, `dry_run?`
  - Returns: List of killed processes or dry run preview

- **`save_process_output`** - Save process output to a file
  - Parameters: `process_id`, `file_path`, `format?` (text/json), `include_metadata?`
  - Returns: Success confirmation with file details

### System Tools (3 tools)
- **`get_system_health`** - Get system health information
  - Parameters: `session?`
  - Returns: System metrics including memory, CPU, disk, and resource usage

- **`preflight_check`** - Validate multiple conditions before operations
  - Parameters: `commands[]`, `paths[]`, `ports[]`, `env_vars[]`, `session?`
  - Returns: Validation results with summary
  
- **`system_profile`** - Gather system information in one call
  - Parameters: `include[]` (os, shell, node, python, git, docker, etc.)
  - Returns: Structured system information

### Interactive SSH Tools (8 tools)
- **`ssh_interactive_start`** - Start an SSH session
  - Parameters: `host`, `port?`, `user?`, `options[]?`, `key_file?`
  - Returns: Session ID and initial output (ANSI codes stripped)
  
- **`ssh_interactive_send`** - Send input to an SSH session
  - Parameters: `session_id`, `input`, `add_newline?`
  - Returns: Output after sending input
  
- **`ssh_interactive_control`** - Send control characters (e.g., Ctrl+C)
  - Parameters: `session_id`, `char`
  - Returns: Success confirmation
  
- **`ssh_interactive_output`** - Get output from SSH session with search
  - Parameters: `session_id`, `lines?`, `from_line?`, `search?`, `search_type?`, `case_sensitive?`, `invert_match?`
  - Returns: Output with optional search filtering and match counts
  
- **`ssh_interactive_wait`** - Wait for new output from SSH session
  - Parameters: `session_id`, `after_line`, `timeout?`
  - Returns: New output lines as they arrive
  
- **`ssh_interactive_resize`** - Resize terminal dimensions
  - Parameters: `session_id`, `cols`, `rows`
  - Returns: Success confirmation
  
- **`ssh_interactive_close`** - Close an SSH session
  - Parameters: `session_id`
  - Returns: Success confirmation
  
- **`ssh_interactive_list`** - List active SSH sessions
  - Parameters: None
  - Returns: List of sessions with host, status, runtime, and output line count

### Cache Management Tools (5 tools)
- **`cache_stats`** - Get cache statistics
  - Parameters: None
  - Returns: Cache size, hit rate, strategy breakdown, learned rules
  
- **`cache_clear_command`** - Clear specific commands from cache
  - Parameters: `command`
  - Returns: Number of entries cleared
  
- **`cache_clear_pattern`** - Clear commands matching regex pattern
  - Parameters: `pattern`
  - Returns: Number of entries cleared
  
- **`cache_mark_never`** - Mark command to never be cached
  - Parameters: `command`, `reason`
  - Returns: Success confirmation
  
- **`cache_explain`** - Explain cache decision for a command
  - Parameters: `command`
  - Returns: Cache strategy, TTL, reason, and analysis

## SSH Guidelines

### Session Management
- Check existing sessions before creating new ones with `ssh_interactive_list()`
- Reuse session IDs for command execution to avoid connection overhead
- Sessions persist across multiple tool calls
- Create new connections only when necessary
- Keep sessions alive for servers requiring multiple commands
- Use interactive sessions instead of `run_command` with sshpass

### Common Mistakes to Avoid
- Creating new SSH connections for each command
- Using `run_command` with sshpass for multiple commands
- Forgetting to check `ssh_interactive_list` first

## Technical Details

### Architecture
- **Language**: TypeScript (ES2020)
- **Runtime**: Node.js (>=18.0.0)
- **Dependencies**: MCP SDK, Zod, Execa, UUID
- **Shell**: `/bin/zsh` (macOS default)
- **Module System**: NodeNext with .js extensions

### Session Implementation
- Sessions are stored in memory using a Map data structure
- Each session maintains:
  - Unique ID (UUID v4)
  - Name (user-defined)
  - Working directory
  - Environment variables (isolated)
  - Command history (last 1000 commands in memory)
  - Background processes
  - Creation and last used timestamps
- Default session is created automatically
- Sessions persist to disk in `~/.macos-shell/sessions` as JSON files
- On server restart:
  - Existing sessions are restored (except default)
  - Working directories are validated
  - Command history restored (last 100 commands)
  - Background processes marked as terminated

### Background Process Implementation
- Processes run with `detached: true` using execa
- Output captured line-by-line to CircularBuffer
- CircularBuffer features:
  - Stores last 300 lines per process
  - Waiter management prevents memory leaks
  - Max 100 concurrent waiters per buffer
  - 60-second maximum wait timeout for long-polling operations
  - Cleanup of stale waiters every 30 seconds
  - Cleanup when approaching waiter limit
  - Batch notification processing
  - Cleanup on process termination
- Separate tracking for stdout and stderr
- Process states: STARTING → RUNNING → STOPPED/FAILED/KILLED/ORPHANED
- Cleanup 5 seconds after process termination
- Resource limits enforced at spawn time
- Orphan detection on server startup using `process.kill(pid, 0)`
- Handling for `bash -c` commands to prevent shell escaping issues

### Error Handling
- Commands wrapped in try/catch blocks
- Typed errors with ExecaError
- Exit codes captured (null if process killed)
- Stdout/stderr typed and captured
- Timeout errors handled
- Background process spawn failures captured in output
- Bash command parsing fixed to prevent server crashes

### Architecture Details
The server has been refactored from a 1,910-line file into modular components:

- **Main Server**: Reduced to 192 lines - handles initialization
- **Tool Modules**: 20 tools distributed across 4 focused modules
- **Utility Modules**: Reusable components (LRU cache, debouncer, buffer)
- **Session Manager**: Centralized session and process management (577 lines)

Architecture characteristics:
- Each module under 500 lines with single responsibility
- Memory leak prevention in background processes
- New tools can be added without touching core logic
- Components can be tested in isolation

## Project Structure

```
macos-shell/
├── src/
│   ├── server.ts                    # Main server (192 lines)
│   ├── session-manager.ts           # Session orchestrator (350 lines)
│   ├── sessions/                    # Session modules
│   │   ├── session-types.ts         # Types and constants
│   │   ├── session-persistence.ts   # Save/load functionality
│   │   ├── background-process-manager.ts
│   │   └── command-history-manager.ts
│   ├── tools/                       # Tool implementations
│   │   ├── command-tools.ts         # Command tool orchestrator
│   │   ├── command/                 # Command tool modules
│   │   ├── process-tools.ts         # Process tool orchestrator
│   │   ├── helpers/                 # Process helper modules
│   │   ├── interactive-ssh-tool.ts  # SSH tools
│   │   ├── session-tools.ts         # Session management
│   │   ├── system-tools.ts          # System health
│   │   ├── enhanced-ssh-tool.ts     # SSH execution
│   │   └── preflight-tools.ts       # Validation tools
│   ├── ai-*.ts                      # AI optimization layer (5 files)
│   └── utils/                       # Utility modules
│       ├── logger.ts                # Structured logging
│       ├── enhanced-circular-buffer.ts
│       ├── batch-executor.ts
│       └── resource-monitor.ts
├── build/                           # Compiled JavaScript
├── docs/                            # Feature documentation
├── test/                            # Test files
├── README.md                        # Main documentation
├── package.json                     # Dependencies
└── tsconfig.json                    # TypeScript config
```

## Limitations

- 30-second default timeout for synchronous commands (configurable, max 10 minutes)
- macOS only (uses `/bin/zsh`)
- Commands run with the permissions of the user running Claude Desktop
- Sudo commands require password input (unless passwordless sudo is configured)
- Output buffer limited to 300 lines per process (older output is discarded)

## Troubleshooting

### Common Issues

1. **"Session not found" error**
   - Ensure you're using the correct session name
   - Check if the session was closed
   - Use `list_shell_sessions` to see active sessions

2. **Command timeout**
   - Increase timeout for commands
   - Default is 30 seconds, max recommended is 600000 (10 minutes)
   - Use `run_background` for processes that need to run longer

3. **Permission denied**
   - Commands run with the permissions of the user running Claude Desktop
   - Sudo commands require interactive password input (unless passwordless sudo is configured)
   - Ensure the user has necessary permissions for the commands being run

4. **Environment variables not working**
   - Variables are session-specific
   - Use `set_env` before running commands that need them
   - Check with `get_env` to verify

5. **"Maximum process limit reached"**
   - Check running processes with `list_processes`
   - Kill unnecessary processes with `kill_process`
   - Close sessions to free their processes

6. **Process output truncated**
   - CircularBuffer stores only last 300 lines
   - Use `from_line` parameter to track output position
   - Consider writing output to files for permanent storage

7. **Orphaned processes after server restart**
   - Use `list_processes` to check for orphaned processes (marked with WARNING)
   - Use `cleanup_orphans` to manage them:
     - `cleanup_orphans()` - Interactive mode shows orphans and suggestions
     - `cleanup_orphans({ mode: "list" })` - Just list orphans
     - `cleanup_orphans({ mode: "kill" })` - Kill orphans
   - Individual orphans can be killed with `kill_process`

8. **Server crashes with bash commands** (Fixed)
   - Previously, `bash -c` commands with scripts would crash the server
   - This has been fixed by detecting bash commands and preventing double shell interpretation
   - Commands like `bash -c "while true; do echo test; done"` work

9. **Server crashes when killing processes** (Fixed)
   - Previously, killing background processes would crash the server with unhandled promise rejection
   - This has been fixed by adding error handling for process termination
   - The server remains stable when processes are killed with SIGTERM or SIGKILL

10. **Tool naming conflicts**
    - If you have iterm-mcp installed, use the correct tool names:
      - Use `create_shell_session` (not `create_session`)
      - Use `list_shell_sessions` (not `list_sessions`)
    - These were renamed to avoid conflicts

## Testing

The project maintains comprehensive test coverage with 712+ tests across 41 test suites.

### Test Status
- **Pass Rate**: 100% [PASSED]
- **Code Coverage**: 60.62%
- **Test Execution**: ~32 seconds

### Running Tests
```bash
# Run all tests
npm test

# Run with coverage report
npm test -- --coverage

# Run in watch mode
npm test -- --watch

# Run specific test file
npm test -- src/ai-cache.test.ts
```

### Documentation
- [Complete Testing Guide](docs/TESTING.md) - Comprehensive testing documentation
- [Test Status Report](docs/TEST_STATUS.md) - Current test metrics and coverage
- [Testing Roadmap](docs/testing-improvement-plan.md) - Future testing plans

## Development

### Build Commands
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server (for testing)
npm start

# Development mode (if configured)
npm run dev
```

## Roadmap

- Process groups and job control
- Command aliases and templates
- Shell detection (bash, fish, etc.)
- Process CPU/memory monitoring

## Contributing

Contributions are welcome! Please submit pull requests or issues on GitHub.

## Changelog

See [CHANGELOG.md](docs/CHANGELOG.md) for version history.

## License

ISC