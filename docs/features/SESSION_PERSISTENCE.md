# Session Persistence in macOS Shell MCP Server

## Overview

Starting with version 2.3.0, the macOS Shell MCP server supports session persistence. This means your sessions, environment variables, working directories, and command history are preserved across server restarts.

## How It Works

### Persistence Directory Structure

The server creates the following directory structure in your home directory:

```
~/.macos-shell/
├── sessions/      # Session JSON files
│   ├── <session-id-1>.json
│   ├── <session-id-2>.json
│   └── ...
└── processes/     # Background process metadata
    ├── <process-id-1>.json
    ├── <process-id-2>.json
    └── ...
```

### What Gets Persisted

#### Sessions
Each session is saved as a JSON file containing:
- Session ID and name
- Current working directory
- Environment variables
- Last 100 commands from history
- Creation and last used timestamps

#### Background Processes
Process metadata is saved including:
- Process ID, command, and arguments
- Session association
- Status and timestamps
- Last 1000 lines of output
- Exit codes (if available)

### When Persistence Occurs

1. **Session Creation**: Saved immediately when created
2. **Session Updates**: Saved when:
   - Working directory changes (`cd` command)
   - Environment variables change (`set_env`)
   - Commands are executed (history updates)
3. **Process Updates**: Saved when:
   - Process starts
   - Process status changes
   - Process terminates
4. **Deletion**: Files removed when sessions/processes are deleted

### Server Startup Behavior

When the MCP server starts:

1. **Directory Initialization**: Creates persistence directories if missing
2. **Session Loading**:
   - Loads all session files from `~/.macos-shell/sessions`
   - Skips the default session (creates new one)
   - Validates working directories (falls back to home if missing)
   - Restores environment variables and history
3. **Process Loading**:
   - Loads process metadata from `~/.macos-shell/processes`
   - Marks all processes as FAILED (since actual processes can't be restored)
   - Preserves output history for viewing

### Important Notes

1. **Default Session**: The default session is never persisted and is always created fresh on startup
2. **Process State**: Background processes cannot be restored to running state - they are marked as failed
3. **Security**: Session files contain environment variables, so the persistence directory has standard file permissions
4. **Performance**: Only the last 100 commands and last 1000 process output lines are persisted to avoid large files

## Usage Examples

### Persistent Development Sessions

```bash
# Create a development session
create_shell_session({
  name: "my-project",
  cwd: "/Users/me/projects/app",
  env: {
    NODE_ENV: "development",
    API_KEY: "dev-key-123"
  }
});

# Work in the session...
cd({ path: "src", session: "my-project" });
run_command({ 
  command: "npm", 
  args: ["install"], 
  session: "my-project" 
});

# Server restarts (e.g., Claude Desktop restart)

# Session is automatically restored!
list_shell_sessions();
// Shows: my-project with same working directory and env vars

# Continue where you left off
pwd({ session: "my-project" });
// Returns: /Users/me/projects/app/src
```

### Viewing Historical Process Output

```bash
# Start a long build process
run_background({
  command: "npm",
  args: ["run", "build:production"],
  session: "build",
  name: "production-build"
});

# Server restarts during the build...

# After restart, view the captured output
list_processes();
// Shows: production-build (status: FAILED)

get_process_output({
  process_id: "<process-id>"
});
// Returns: All captured output before the restart
```

## Managing Persistence

### Viewing Persisted Data

You can inspect the persistence directory:

```bash
# List all persisted sessions
ls ~/.macos-shell/sessions/

# View a specific session
cat ~/.macos-shell/sessions/<session-id>.json | jq

# Check total size
du -sh ~/.macos-shell/
```

### Clearing Persistence

To completely reset:

```bash
# Remove all persisted data
rm -rf ~/.macos-shell/

# The directory will be recreated on next server start
```

### Backup and Restore

Since sessions are stored as JSON files, you can easily backup and restore them:

```bash
# Backup
cp -r ~/.macos-shell ~/macos-shell-backup

# Restore
cp -r ~/macos-shell-backup/* ~/.macos-shell/
```

## Limitations

1. **Process Restoration**: Running processes cannot be restored - only their metadata and output
2. **File Size**: Large command histories or output buffers are truncated
3. **Path Validation**: Restored sessions with invalid paths default to home directory
4. **Permissions**: The server runs with user permissions, so it can only access user-writable locations

## Troubleshooting

### Sessions Not Persisting

1. Check directory permissions:
   ```bash
   ls -la ~/.macos-shell
   ```

2. Verify the server has write access:
   ```bash
   touch ~/.macos-shell/test && rm ~/.macos-shell/test
   ```

3. Check for errors in Claude Desktop logs:
   ```bash
   tail -f ~/Library/Logs/Claude/mcp*.log
   ```

### Sessions Not Loading

1. Verify session files exist:
   ```bash
   ls ~/.macos-shell/sessions/
   ```

2. Check file format is valid JSON:
   ```bash
   cat ~/.macos-shell/sessions/*.json | jq
   ```

3. Look for loading errors in server startup

## Future Enhancements

Potential improvements for future versions:
- Configurable persistence location
- Encryption for sensitive environment variables
- Session templates
- Import/export functionality
- Persistence size limits and rotation
