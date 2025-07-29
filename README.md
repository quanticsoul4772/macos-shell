# macOS Shell MCP Server

A Model Context Protocol (MCP) server that enables AI assistants to execute shell commands on macOS with session management, working directory persistence, environment isolation, and background process management.

**Version**: 3.2.0

## Features

### Core Features
- **Session Management**: Create multiple named sessions with isolated environments
- **Working Directory Persistence**: Each session maintains its own working directory
- **Environment Variables**: Set and manage environment variables per session
- **Command History**: Track executed commands with timing and output
- **Script Execution**: Run multi-line shell scripts
- **Background Processes**: Run processes in the background with output capture
- **Error Handling**: Error reporting with exit codes

### AI-Specific Features

This server is designed for AI usage patterns:

#### Command Caching
- Cacheable commands execute in 1ms vs 120ms uncached
- Classification: Status commands (`git status`, `ls`, `docker ps`) are never cached
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
- Auto-corrects file path typos using Levenshtein distance
- Retries network errors with exponential backoff
- Adds flags like `--legacy-peer-deps` for npm errors
- Suggests command alternatives (python → python3)

#### Performance Monitoring
- Stats logged every minute to stderr
- Tracks cache hit rate, deduplication rate, error recovery
- Shows command patterns for optimization insights

## SSH Implementation

### Performance Comparison
- New SSH connection: ~2 seconds (DNS lookup + authentication overhead)
- Existing session: 0.000s
- Sessions persist across multiple tool calls

### SSH Workflow
```bash
# Check existing sessions
const sessions = await ssh_interactive_list();

# If session exists, reuse it (0.000s execution)
if (sessions.find(s => s.host === 'myserver.com')) {
  await ssh_interactive_send({
    session_id: existingSessionId,
    input: "ls -la"
  });
} else {
  # Create new session only if needed (2s connection)
  const newSession = await ssh_interactive_start({
    host: 'myserver.com',
    user: 'myuser'
  });
}
```

### Common Mistakes to Avoid
- Creating new SSH connections for each command
- Using `run_command` with sshpass for multiple commands
- Forgetting to check `ssh_interactive_list` first
- Check existing sessions before creating new ones
- Reuse session IDs for command execution
- Use interactive sessions for servers requiring multiple commands

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd macos-shell

# Install dependencies
npm install

# Build the server
npm run build

# Test the server (optional)
npm start
```

## Configuration for Claude Desktop

This server executes shell commands through the MCP protocol.

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

## Available Tools (35 Total)

### 1. Command Execution
- **`run_command`** - Execute shell commands
  - Parameters: `command`, `args[]`, `session?`, `cwd?`, `env?`, `timeout?`
  - Returns: Exit code, stdout, stderr
  
- **`run_script`** - Execute multi-line shell scripts
  - Parameters: `script`, `session?`, `timeout?`
  - Returns: Exit code, stdout, stderr

- **`batch_execute_enhanced`** - Execute commands with conditional logic and retries
  - Parameters: `commands[]` with conditions, `parallel?`, `stopOnFirstFailure?`, `maxOutputLines?`, `includeFullOutput?`
  - Returns: Execution results with skip reasons
  - Output truncation to prevent context window overload:
    - `maxOutputLines` (default: 50) - Limits stdout/stderr lines per command
    - `includeFullOutput` (default: false) - Override to get full output
    - Shows first/last lines with "... [X lines omitted] ..." in the middle
    - Includes line counts and truncation indicators

### 2. Session Management
- **`create_shell_session`** - Create a new named session with isolated environment
  - Parameters: `name`, `cwd?`, `env?`
  - Returns: Session ID and working directory
  
- **`list_shell_sessions`** - List active sessions with details
  - Parameters: None
  - Returns: List of sessions with creation time, last used, command count, background process count
  
- **`close_session`** - Close a session and free resources
  - Parameters: `session`
  - Returns: Success confirmation

### 3. Working Directory
- **`cd`** - Change working directory (persists in session)
  - Parameters: `path`, `session?`
  - Returns: New working directory path
  
- **`pwd`** - Get current working directory
  - Parameters: `session?`
  - Returns: Current directory path

### 4. Environment Management
- **`set_env`** - Set environment variables in a session
  - Parameters: `name`, `value`, `session?`
  - Returns: Confirmation with variable details
  
- **`get_env`** - Get environment variables
  - Parameters: `name?`, `session?`
  - Returns: Variable value(s)

### 5. History
- **`history`** - View command history for a session
  - Parameters: `session?`, `limit?`
  - Returns: Commands with timestamps, exit codes, duration

### 6. Background Process Management
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
  - Waits up to timeout (default 30s) for new output
  - Use `after_line` from previous response to continue streaming
  
- **`kill_process`** - Terminate a background process (including orphaned processes)
  - Parameters: `process_id`, `signal?` (SIGTERM/SIGKILL)
  - Returns: Success confirmation
  - Works on orphaned processes from previous server sessions
  
- **`cleanup_orphans`** - Manage processes from previous server sessions
  - Parameters: `mode?` (list/kill/interactive), `force?` (use SIGKILL)
  - Returns: List of orphans or cleanup results
  - Interactive mode provides suggestions for handling orphans

- **`kill_all_matching`** - Kill processes matching a pattern
  - Parameters: `pattern`, `pattern_type?` (text/regex), `signal?`, `dry_run?`
  - Returns: List of killed processes or dry run preview

- **`save_process_output`** - Save process output to a file
  - Parameters: `process_id`, `file_path`, `format?` (text/json), `include_metadata?`
  - Returns: Success confirmation with file details

### 7. System Health
- **`get_system_health`** - Get system health information
  - Parameters: `session?`
  - Returns: System metrics including memory, CPU, disk, and resource usage

### 8. AI Optimization Tools
- **`preflight_check`** - Validate multiple conditions before operations
  - Parameters: `commands[]`, `paths[]`, `ports[]`, `env_vars[]`, `session?`
  - Returns: Validation results with summary
  - Checks command existence, file permissions, port availability, env vars
  
- **`system_profile`** - Gather system information in one call
  - Parameters: `include[]` (os, shell, node, python, git, docker, etc.)
  - Returns: Structured system information
  - Replaces multiple discovery commands with single call

### 9. Interactive SSH Tools
- **`ssh_interactive_start`** - Start an SSH session
  - Parameters: `host`, `port?`, `user?`, `options[]?`, `key_file?`
  - Returns: Session ID and initial output (ANSI codes stripped)
  - Maintains SSH connections with TTY support
  
- **`ssh_interactive_send`** - Send input to an SSH session
  - Parameters: `session_id`, `input`, `add_newline?`
  - Returns: Output after sending input
  - Supports commands and interactive responses
  
- **`ssh_interactive_control`** - Send control characters (e.g., Ctrl+C)
  - Parameters: `session_id`, `char`
  - Returns: Success confirmation
  - Use for interrupting commands or terminal controls
  
- **`ssh_interactive_output`** - Get output from SSH session with search
  - Parameters: `session_id`, `lines?`, `from_line?`, `search?`, `search_type?`, `case_sensitive?`, `invert_match?`
  - Returns: Output with optional search filtering and match counts
  - Stores output with ANSI codes stripped for AI processing
  
- **`ssh_interactive_wait`** - Wait for new output from SSH session
  - Parameters: `session_id`, `after_line`, `timeout?`
  - Returns: New output lines as they arrive
  - Uses long-polling for output monitoring
  
- **`ssh_interactive_resize`** - Resize terminal dimensions
  - Parameters: `session_id`, `cols`, `rows`
  - Returns: Success confirmation
  - Adjust terminal size for output formatting
  
- **`ssh_interactive_close`** - Close an SSH session
  - Parameters: `session_id`
  - Returns: Success confirmation
  - Terminates SSH connection and frees resources
  
- **`ssh_interactive_list`** - List active SSH sessions
  - Parameters: None
  - Returns: List of sessions with host, status, runtime, and output line count

### 10. Cache Management Tools
- **`cache_stats`** - Get cache statistics
  - Parameters: None
  - Returns: Cache size, hit rate, strategy breakdown, learned rules
  - Monitor cache performance and effectiveness
  
- **`cache_clear_command`** - Clear specific commands from cache
  - Parameters: `command`
  - Returns: Number of entries cleared
  - Remove stale cached results for specific commands
  
- **`cache_clear_pattern`** - Clear commands matching regex pattern
  - Parameters: `pattern`
  - Returns: Number of entries cleared
  - Bulk remove cached entries by pattern
  
- **`cache_mark_never`** - Mark command to never be cached
  - Parameters: `command`, `reason`
  - Returns: Success confirmation
  - Prevent specific commands from being cached
  
- **`cache_explain`** - Explain cache decision for a command
  - Parameters: `command`
  - Returns: Cache strategy, TTL, reason, and analysis
  - Understand why commands are/aren't cached

## Why AI Optimizations Matter

As an AI assistant, I execute commands differently than humans:
- I run the same commands multiple times when exploring projects
- I execute predictable command sequences (e.g., `ls` followed by `cat`)
- I don't need interactive features or visual formatting
- I can retry and correct errors

The v3.0.0 optimizations exploit these patterns for performance improvements without configuration.

For detailed information about AI features, see [AI_FEATURES.md](docs/features/AI_FEATURES.md).

## Usage Examples

These examples show how I (as an AI assistant) use the tools:

### Basic Command Execution
```typescript
// Command (uses default session)
await run_command({
  command: "ls",
  args: ["-la"]
});

// Command with custom timeout
await run_command({
  command: "npm",
  args: ["install"],
  timeout: 120000  // 2 minutes
});

// Bash -c commands work
await run_command({
  command: "bash",
  args: ["-c", "for i in {1..5}; do echo \"Line $i\"; done"]
});
```

### Background Process Management
```typescript
// Start a process
const result = await run_background({
  command: "npm",
  args: ["run", "dev"],
  session: "dev",
  name: "frontend-server"
});
// Returns: { processId: "abc123...", pid: 12345, status: "running" }

// List background processes
await list_processes();
// Returns list with status, runtime, etc.

// Get output from a process
await get_process_output({
  process_id: "abc123...",
  lines: 50  // Last 50 lines
});
// Returns:
// [1] [OUT] Starting development server...
// [2] [OUT] Listening on http://localhost:3000
// [3] [ERR] Warning: some deprecation notice

// Search output for content
await get_process_output({
  process_id: "abc123...",
  search: "error",
  case_sensitive: false
});
// Returns:
// Search: "error" (case-insensitive)
// Matches: 3 of 150 lines
// [45] [ERR] Error: Connection timeout
// [67] [OUT] Recovered from error
// [134] [ERR] Error: Failed to compile

// Stream output
let lastLine = 0;
const streaming = await stream_process_output({
  process_id: "abc123...",
  after_line: lastLine,
  timeout: 5000  // Wait up to 5 seconds for new output
});
// Returns new lines as they arrive:
// Lines 4 to 7 (4 new lines)
// [4] [OUT] Compiled successfully!
// [5] [OUT] webpack compiled with 1 warning
// [6] [OUT] Server ready
// [7] [OUT] Accepting connections...
// Next call: use after_line=7 to continue streaming

// Kill a process
await kill_process({
  process_id: "abc123...",
  signal: "SIGTERM"
});

// After server restart, check for orphaned processes
await cleanup_orphans();
// Returns:
// Found 2 orphaned process(es) from previous server session:
// PID: 12345 | Command: npm run dev | Session: dev | Running for: 3600.2s
// PID: 12346 | Command: docker compose up | Session: db | Running for: 3598.5s
// 
// Suggested actions:
// 1. Kill all orphans: cleanup_orphans(mode: "kill")
// 2. Force kill all orphans: cleanup_orphans(mode: "kill", force: true)
// 3. Kill specific process: kill_process(process_id: "<id>") for each process listed
```

### Session Management
```typescript
// Create a development session
await create_shell_session({
  name: "dev",
  cwd: "/Users/me/projects/myapp",
  env: {
    NODE_ENV: "development",
    PORT: "3000"
  }
});

// List sessions
await list_shell_sessions();
// Returns session information

// Run commands in that session
await run_command({
  command: "npm",
  args: ["run", "dev"],
  session: "dev"
});

// Change directory within session
await cd({
  path: "src",
  session: "dev"
});

// Check where we are
await pwd({ session: "dev" });
// Returns: /Users/me/projects/myapp/src
```

### Bash Commands
```typescript
// These commands work without crashing the server

// Loops in bash
await run_background({
  command: "bash",
  args: ["-c", "while true; do echo 'Server running...'; sleep 1; done"],
  name: "monitoring-loop"
});

// Scripts with quotes
await run_command({
  command: "bash",
  args: ["-c", "echo 'Testing \"quoted\" strings' && echo 'Success!'"]
});

// Multiple commands
await run_command({
  command: "bash",
  args: ["-c", "cd /tmp && ls -la && pwd"]
});
```

### Environment Variables
```typescript
// Set a variable
await set_env({
  name: "API_KEY",
  value: "secret123",
  session: "dev"
});

// Get variables
await get_env({ session: "dev" });

// Get specific variable
await get_env({
  name: "API_KEY",
  session: "dev"
});
```

### Script Execution
```typescript
// Run a multi-line script
await run_script({
  script: `
    #!/bin/zsh
    echo "Starting build process..."
    npm run clean
    npm run build
    npm run test
    echo "Build complete!"
  `,
  session: "dev",
  timeout: 300000  // 5 minutes
});
```

### Command History
```typescript
// View last 20 commands
await history({
  session: "dev",
  limit: 20
});
```

## Multiple Background Processes
```typescript
// Start multiple servers
await run_background({
  command: "npm",
  args: ["run", "frontend"],
  session: "dev",
  name: "frontend"
});

await run_background({
  command: "npm",
  args: ["run", "backend"],
  session: "dev",
  name: "backend"
});

await run_background({
  command: "docker",
  args: ["compose", "up", "postgres"],
  session: "dev",
  name: "database"
});

// Monitor processes
const processes = await list_processes({ session: "dev" });
// Shows 3 processes with their status

// Get output from each process
for (const proc of processes) {
  const output = await get_process_output({
    process_id: proc.id,
    lines: 10
  });
  console.log(`Output from ${proc.name}:`, output);
}
```

### Monitoring Tasks
```typescript
// Start a build process
const build = await run_background({
  command: "npm",
  args: ["run", "build:production"],
  session: "build"
});

// Check output
const checkOutput = async () => {
  const output = await get_process_output({
    process_id: build.processId,
    from_line: lastLine
  });
  
  // Process new output lines
  if (output.lines.length > 0) {
    lastLine = output.lines[output.lines.length - 1].lineNumber;
    // Check for errors or completion
  }
  
  // Check if running
  const processes = await list_processes();
  const buildProcess = processes.find(p => p.id === build.processId);
  
  if (buildProcess.status !== "running") {
    console.log("Build completed with exit code:", buildProcess.exitCode);
  }
};
```

### Multiple Concurrent Sessions
```typescript
// Frontend session
await create_shell_session({
  name: "frontend",
  cwd: "./frontend"
});

// Backend session
await create_shell_session({
  name: "backend",
  cwd: "./backend"
});

// Database session
await create_shell_session({
  name: "db",
  cwd: "./",
  env: {
    DATABASE_URL: "postgresql://localhost/myapp"
  }
});

// Run processes in each
await run_command({
  command: "npm",
  args: ["run", "dev"],
  session: "frontend"
});

await run_command({
  command: "npm",
  args: ["run", "server"],
  session: "backend"
});

await run_command({
  command: "docker-compose",
  args: ["up", "-d", "postgres"],
  session: "db"
});
```

### Working with Git
```typescript
// Create a git session
await create_shell_session({
  name: "git",
  cwd: "/Users/me/projects/myapp"
});

// Check status
await run_command({
  command: "git",
  args: ["status"],
  session: "git"
});

// Add and commit
await run_command({
  command: "git",
  args: ["add", "."],
  session: "git"
});

await run_command({
  command: "git",
  args: ["commit", "-m", "feat: add new feature"],
  session: "git"
});
```

### SSH Sessions
```typescript
// Check for existing sessions
const existingSessions = await ssh_interactive_list();
// Performance: 0.000s

// Look for existing session to your server
const existing = existingSessions.find(s => s.host === "192.168.21.13");

if (existing) {
  // REUSE EXISTING SESSION - 0.000s
  await ssh_interactive_send({
    session_id: existing.sessionId,
    input: "hostname"
  });
  console.log("Command executed using existing session!");
} else {
  // Create new session only if needed (2-second connection overhead)
  const ssh = await ssh_interactive_start({
    host: "192.168.21.13",
    port: 22,
    user: "myuser",
    options: ["-o", "HostKeyAlgorithms=+ssh-rsa"] // Common for older servers
  });
  console.log("New connection took ~2 seconds");
  
  // Subsequent commands are 0.000s
  await ssh_interactive_send({
    session_id: ssh.sessionId,
    input: "ls -la"
  });
}

// Multiple commands through same session - 0.000s each
for (const cmd of ["pwd", "date", "uptime", "df -h", "free -m"]) {
  await ssh_interactive_send({
    session_id: existing.sessionId,
    input: cmd
  });
  // Each command: 0.000s execution time
}

// Performance comparison:
// BAD: run_command with sshpass (2s per command)
await run_command({
  command: "sshpass",
  args: ["-p", "password", "ssh", "user@host", "ls"]
}); // 2 seconds

await run_command({
  command: "sshpass",
  args: ["-p", "password", "ssh", "user@host", "pwd"]
}); // Another 2 seconds
// Total: 4 seconds for 2 commands

// GOOD: Interactive session (2s connection + 0s commands)
const session = await ssh_interactive_start({ host: "host" }); // 2s
await ssh_interactive_send({ session_id: session.sessionId, input: "ls" }); // 0s
await ssh_interactive_send({ session_id: session.sessionId, input: "pwd" }); // 0s
// Total: 2 seconds for 2 commands

// Search output for errors or content
await ssh_interactive_output({
  session_id: session.sessionId,
  search: "error",
  search_type: "text",
  case_sensitive: false
});
// Returns output with match counts

// Wait for command output
await ssh_interactive_send({
  session_id: session.sessionId,
  input: "npm run build"
});

await ssh_interactive_wait({
  session_id: session.sessionId,
  after_line: 50,
  timeout: 5000
});
// Returns new output as it arrives

// Send Ctrl+C to interrupt
await ssh_interactive_control({
  session_id: session.sessionId,
  char: "C"
});

// Sessions persist between tool calls
// Close when done with the server
await ssh_interactive_close({
  session_id: session.sessionId
});
```

## Guidelines for AI Assistants

1. **Use Named Sessions**: I create descriptive session names for different contexts
2. **Set Environment Variables**: I use session-specific environment variables instead of modifying global environment
3. **Check Exit Codes**: I check the exit code in the response
4. **Handle Timeouts**: I set appropriate timeouts for commands
5. **Clean Up Sessions**: I close sessions when done to free resources
6. **Monitor Background Processes**: I check process status and output
7. **Kill Hanging Processes**: I use kill_process to clean up stuck processes
8. **Handle Orphans**: I use cleanup_orphans after server restarts to manage orphaned processes
9. **Use Correct Tool Names**: Use `create_shell_session` and `list_shell_sessions` (not the old names)
10. **SSH Guidelines**:
    - Run `ssh_interactive_list()` before creating new SSH connections
    - Reuse existing sessions for 0.000s command execution
    - Create new connections when necessary (2s overhead)
    - Keep sessions alive for servers you'll use multiple times
    - Use interactive sessions for servers requiring more than one command

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
- Default session is created
- Sessions persist to disk in `~/.macos-shell/sessions` as JSON files
- On server restart:
  - Existing sessions are restored (except default)
  - Working directories are validated
  - Command history restored (last 100 commands)
  - Background processes marked as terminated

### Background Process Implementation
- Processes run with `detached: true` using execa
- Output captured line-by-line to **CircularBuffer**
- **CircularBuffer** features:
  - Stores last 300 lines per process
  - Memory-safe waiter management prevents memory leaks
  - Max 100 concurrent waiters per buffer
  - 60-second maximum wait timeout for long-polling operations
  - Cleanup of stale waiters every 30 seconds
  - Force cleanup when approaching waiter limit
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

### Modular Architecture
The server has been refactored from a monolithic 1,910-line file into a modular architecture:

- **Main Server**: Reduced to 192 lines - handles initialization
- **Tool Modules**: 20 tools distributed across 4 focused modules
- **Utility Modules**: Reusable optimizations (LRU cache, debouncer, buffer)
- **Session Manager**: Centralized session and process management (577 lines)

Key benefits:
- **Maintainability**: Each module under 500 lines with single responsibility
- **Performance**: AI-specific optimizations prevent memory leaks
- **Extensibility**: New tools can be added without touching core logic
- **Testing**: Components can be tested in isolation

For architecture documentation, see [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md).

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

### Project Structure
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
│   ├── README.md                    # Documentation index
│   ├── BACKGROUND_PROCESS_*.md      # Process docs
│   ├── SESSION_PERSISTENCE.md       # Session docs
│   └── *.md                         # Other feature docs
├── test/                            # Test files
├── README.md                        # Main documentation
├── ARCHITECTURE.md                  # Architecture guide
├── REFACTORING_SUMMARY.md          # Refactoring details
├── AI_FEATURES.md                   # AI optimizations
├── CHANGELOG.md                     # Version history
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
   - I use `list_processes` to check for orphaned processes (marked with WARNING)
   - I use `cleanup_orphans` to manage them:
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

## Roadmap

- Process groups and job control
- Command aliases and templates
- Shell detection (bash, fish, etc.)
- Process CPU/memory monitoring

## Contributing

Contributions are welcome!

## Changelog

See [CHANGELOG.md](docs/CHANGELOG.md) for version history.

## License

ISC