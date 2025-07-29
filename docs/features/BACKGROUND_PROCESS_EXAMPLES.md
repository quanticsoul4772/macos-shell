# Background Process Management - Working Examples

## Overview

The macOS Shell MCP Server v2.1.0 includes background process management capabilities. This document provides real-world examples of how to use the 4 new background process tools.

## Tool Reference

- **`run_background`** - Start a command in the background
- **`list_processes`** - List all background processes  
- **`get_process_output`** - Retrieve output from a background process
- **`kill_process`** - Terminate a background process

## Quick Demo

### Starting a Simple Background Process

```typescript
// Start a simple long-running command
const result = await run_background({
  command: "sleep",
  args: ["60"],
  session: "default"
});

console.log(`Process ID: ${result.content[0].text}`);
// Output: Started background process:
// ID: abc123-def456-...
// Command: sleep 60
// PID: 12345
// Status: running
// Session: default
```

### Monitoring Process Output

```typescript
// Start a process that generates output
const echo = await run_background({
  command: "node",
  args: ["-e", "setInterval(() => console.log(new Date().toISOString()), 1000)"],
  session: "default",
  name: "timestamp-generator"
});

// Wait a bit for output to generate
await new Promise(resolve => setTimeout(resolve, 3000));

// Get the output
const output = await get_process_output({
  process_id: echo.processId
});

console.log(output.content[0].text);
// Output shows timestamped lines like:
// [1] [OUT] 2025-06-01T02:50:15.123Z
// [2] [OUT] 2025-06-01T02:50:16.124Z
// [3] [OUT] 2025-06-01T02:50:17.125Z
```

## Real-World Use Cases

### 1. Development Server Management

```typescript
// Create a dedicated session for development
await create_shell_session({
  name: "dev-servers",
  cwd: "/Users/me/projects/myapp"
});

// Start the frontend development server
const frontend = await run_background({
  command: "npm",
  args: ["run", "dev:frontend"],
  session: "dev-servers",
  name: "frontend"
});

// Start the backend API server
const backend = await run_background({
  command: "npm", 
  args: ["run", "dev:backend"],
  session: "dev-servers",
  name: "backend"
});

// Start a database container
const database = await run_background({
  command: "docker",
  args: ["run", "--name", "dev-db", "-p", "5432:5432", "postgres:14"],
  session: "dev-servers",
  name: "database"
});

// List all running dev servers
const servers = await list_processes({
  session: "dev-servers"
});

console.log(`Running ${servers.content[0].text}`);
// Shows all 3 processes with their status, PID, and runtime
```

### 2. Build Process Monitoring

```typescript
// Start a build process
const build = await run_background({
  command: "npm",
  args: ["run", "build"],
  session: "build"
});

// Extract process ID from response
const processId = build.content[0].text.match(/ID: ([a-f0-9-]+)/)[1];

// Monitor build progress
let lastLine = 0;
const checkBuild = async () => {
  const output = await get_process_output({
    process_id: processId,
    from_line: lastLine
  });
  
  // Parse output to check for new lines
  const lines = output.content[0].text.split('\n');
  const outputLines = lines.filter(l => l.match(/^\[\d+\]/));
  
  if (outputLines.length > 0) {
    // Update last line number
    const lastOutputLine = outputLines[outputLines.length - 1];
    const lineMatch = lastOutputLine.match(/^\[(\d+)\]/);
    if (lineMatch) {
      lastLine = parseInt(lineMatch[1]);
    }
    
    // Check for completion or errors
    const hasError = outputLines.some(l => l.includes('[ERR]'));
    if (hasError) {
      console.log("Build error detected!");
    }
  }
  
  // Check if process is still running
  const processes = await list_processes();
  const buildProc = processes.content[0].text.includes(processId);
  
  if (!buildProc || processes.content[0].text.includes('Status: stopped')) {
    console.log("Build completed!");
    return false;
  }
  
  return true;
};

// Check every 2 seconds
while (await checkBuild()) {
  await new Promise(resolve => setTimeout(resolve, 2000));
}
```

### 3. Log File Monitoring

```typescript
// Tail application logs
const logWatcher = await run_background({
  command: "tail",
  args: ["-f", "/var/log/system.log"],
  session: "monitoring"
});

const processId = logWatcher.content[0].text.match(/ID: ([a-f0-9-]+)/)[1];

// Periodically check for specific patterns
setInterval(async () => {
  const output = await get_process_output({
    process_id: processId,
    lines: 50  // Get last 50 lines
  });
  
  // Look for errors in the output
  const lines = output.content[0].text.split('\n');
  const errorLines = lines.filter(l => 
    l.includes('ERROR') || 
    l.includes('FAILED') ||
    l.includes('Exception')
  );
  
  if (errorLines.length > 0) {
    console.log(`Found ${errorLines.length} errors in logs`);
    errorLines.forEach(line => console.log(line));
  }
}, 10000); // Check every 10 seconds
```

### 4. Parallel Task Execution

```typescript
// Run multiple tasks in parallel
const tasks = [
  { name: "test-unit", command: "npm", args: ["run", "test:unit"] },
  { name: "test-integration", command: "npm", args: ["run", "test:integration"] },
  { name: "test-e2e", command: "npm", args: ["run", "test:e2e"] },
  { name: "lint", command: "npm", args: ["run", "lint"] },
  { name: "typecheck", command: "npm", args: ["run", "typecheck"] }
];

// Start all tasks
const runningTasks = [];
for (const task of tasks) {
  const result = await run_background({
    command: task.command,
    args: task.args,
    session: "ci",
    name: task.name
  });
  
  const processId = result.content[0].text.match(/ID: ([a-f0-9-]+)/)[1];
  runningTasks.push({ ...task, processId });
}

// Wait for all tasks to complete
let allComplete = false;
while (!allComplete) {
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const processes = await list_processes({ session: "ci" });
  const processText = processes.content[0].text;
  
  // Check if all processes have stopped
  allComplete = runningTasks.every(task => {
    const taskInfo = processText.includes(task.processId);
    return !taskInfo || processText.includes(`ID: ${task.processId}`) && 
           (processText.includes('Status: stopped') || processText.includes('Status: failed'));
  });
}

// Collect results
for (const task of runningTasks) {
  const output = await get_process_output({
    process_id: task.processId,
    lines: 100
  });
  
  console.log(`\n=== ${task.name} ===`);
  console.log(output.content[0].text);
}
```

### 5. Resource Monitoring

```typescript
// Monitor system resources
const cpuMonitor = await run_background({
  command: "sh",
  args: ["-c", "while true; do ps aux | head -5; sleep 5; done"],
  session: "monitoring",
  name: "cpu-monitor"
});

const processId = cpuMonitor.content[0].text.match(/ID: ([a-f0-9-]+)/)[1];

// Collect metrics every 30 seconds
setInterval(async () => {
  const output = await get_process_output({
    process_id: processId,
    lines: 20
  });
  
  // Parse and analyze the output
  const lines = output.content[0].text.split('\n');
  const dataLines = lines.filter(l => l.includes('[OUT]'));
  
  if (dataLines.length > 0) {
    console.log("Current top processes:");
    dataLines.slice(-5).forEach(line => console.log(line));
  }
}, 30000);
```

## Working with Process Output

### Understanding Output Format

The `get_process_output` tool returns output in a specific format:

```
[lineNumber] [type] content
```

Where:
- `lineNumber` - Sequential line number (1-based)
- `type` - Either `[OUT]` for stdout or `[ERR]` for stderr
- `content` - The actual output line

Example:
```
[1] [OUT] Starting server...
[2] [OUT] Server listening on port 3000
[3] [ERR] Warning: deprecated API used
[4] [OUT] Ready to accept connections
```

### Pagination and Buffering

The CircularBuffer stores the last 300 lines of output (AI-optimized):

```typescript
// Get all output
const allOutput = await get_process_output({
  process_id: processId
});

// Get last 50 lines
const recentOutput = await get_process_output({
  process_id: processId,
  lines: 50
});

// Get output starting from line 100
const fromLine = await get_process_output({
  process_id: processId,
  from_line: 100,
  lines: 50  // Get 50 lines starting from line 100
});
```

## Process Lifecycle Management

### Graceful Shutdown

```typescript
// Start a server
const server = await run_background({
  command: "node",
  args: ["server.js"],
  session: "production"
});

const processId = server.content[0].text.match(/ID: ([a-f0-9-]+)/)[1];

// Later, gracefully shut down with SIGTERM
await kill_process({
  process_id: processId,
  signal: "SIGTERM"  // Default, allows graceful shutdown
});

// If process doesn't stop, force kill with SIGKILL
setTimeout(async () => {
  const processes = await list_processes();
  if (processes.content[0].text.includes(processId)) {
    await kill_process({
      process_id: processId,
      signal: "SIGKILL"  // Force kill
    });
  }
}, 5000);
```

### Session Cleanup

```typescript
// All processes in a session are killed when the session is closed
await create_shell_session({ name: "temp-work" });

// Start multiple processes
await run_background({
  command: "npm",
  args: ["run", "task1"],
  session: "temp-work"
});

await run_background({
  command: "npm",
  args: ["run", "task2"],
  session: "temp-work"
});

// Clean up everything at once
await close_session({ session: "temp-work" });
// All processes in the session are automatically terminated
```

## Best Practices

1. **Always capture process IDs** - Extract and store the process ID from the response for later reference
2. **Monitor process status** - Regularly check if processes are still running
3. **Handle output buffering** - Remember the 300 line limit (AI-optimized) and implement log rotation if needed
4. **Use meaningful names** - Provide descriptive names for easier process identification
5. **Clean up resources** - Kill processes when done or close sessions to free resources
6. **Check exit codes** - Monitor process completion status and exit codes
7. **Respect limits** - Maximum 50 processes per session, 200 total

## Troubleshooting

### Process Won't Start
- Check the command exists and is in PATH
- Verify working directory and environment variables
- Look for error output in the first few lines

### Output Not Captured
- Some processes buffer output - they may not show output immediately
- Use `from_line` to check for new output since last check
- Ensure the process is actually producing output

### Process Won't Die
- Try SIGTERM first for graceful shutdown
- Use SIGKILL if process doesn't respond to SIGTERM
- Check if process has child processes that need separate handling

## Session Persistence (v2.3.0+)

### How Background Processes Persist

Starting with v2.3.0, background process metadata is saved to disk:

```typescript
// Start a long-running process
const build = await run_background({
  command: "npm",
  args: ["run", "build:production"],
  session: "builds",
  name: "prod-build"
});

// Server restarts (e.g., Claude Desktop restarts)...

// After restart, the process metadata is restored
const processes = await list_processes();
// Shows: prod-build with status: FAILED (since actual process can't be restored)

// But you can still access the captured output!
const output = await get_process_output({
  process_id: "<the-original-process-id>"
});
// Returns all output that was captured before the restart
```

### Important Notes on Persistence

1. **Process State**: Running processes cannot be restored - they're marked as FAILED after restart
2. **Output History**: The last 1000 lines of output are persisted and available after restart
3. **Process Metadata**: Command, args, timestamps, and exit codes are all preserved
4. **Cleanup**: Process files are deleted 5 seconds after the process is explicitly killed

### Example: Reviewing Historical Output

```typescript
// After a server restart, list all processes
const allProcesses = await list_processes();
// Shows processes from before the restart with status: FAILED

// Find a specific process by name in the output
// Extract its ID and view the historical output
const historicalOutput = await get_process_output({
  process_id: "<process-id-from-list>",
  lines: 1000  // Get all persisted output
});

// Useful for debugging what happened during long builds or deployments
console.log("Last output before restart:", historicalOutput);
```

## Summary

Background process management in macOS Shell MCP Server provides:
- Non-blocking process execution (v2.1.0)
- Full output capture with line-by-line buffering (v2.1.0)
- Process lifecycle management (v2.1.0)
- Session-based organization (v2.1.0)
- Resource limits and cleanup (v2.1.0)
- Real-time output streaming (v2.2.0)
- Process metadata and output persistence (v2.3.0)

This enables workflows for development, monitoring, and automation tasks!