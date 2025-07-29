# Background Process Management Design Document

## Overview

This document outlines the design and implementation plan for adding background process management to the macOS Shell MCP Server. This feature will allow users to start long-running processes that continue executing after the command returns, with the ability to monitor and control these processes.

## Goals

1. **Start processes in background** - Run commands that continue after the initial call returns
2. **Monitor processes** - Track status, runtime, and resource usage
3. **Capture output** - Buffer stdout/stderr for later retrieval
4. **Control processes** - Kill, pause, or send signals to running processes
5. **Session integration** - Background processes are tied to sessions

## Non-Goals

1. ~~Process persistence across server restarts~~ ✅ Implemented in v2.3.0 (metadata and output persisted, processes marked as terminated)
2. ~~Real-time streaming of output~~ ✅ Implemented in v2.2.0 (stream_process_output tool)
3. Interactive process control (separate roadmap item)

## Design

### New Interfaces

```typescript
interface BackgroundProcess {
  id: string;                    // UUID for the process
  sessionId: string;             // Session this process belongs to
  command: string;               // Command that was executed
  args: string[];                // Command arguments
  pid: number | null;            // System process ID
  status: ProcessStatus;         // Current status
  startTime: Date;               // When process was started
  endTime?: Date;                // When process ended (if applicable)
  exitCode?: number | null;      // Exit code (if process has ended)
  outputBuffer: CircularBuffer;  // Buffered stdout/stderr
  metadata: {
    cwd: string;                 // Working directory
    env: Record<string, string>; // Environment variables
  };
}

enum ProcessStatus {
  STARTING = "starting",
  RUNNING = "running",
  STOPPED = "stopped",
  FAILED = "failed",
  KILLED = "killed"
}

class CircularBuffer {
  private buffer: OutputLine[];
  private maxLines: number;
  private totalLines: number;
  
  constructor(maxLines: number = 300) { // AI-optimized
    this.buffer = [];
    this.maxLines = maxLines;
    this.totalLines = 0;
  }
  
  add(line: OutputLine): void;
  getLines(count?: number, fromLine?: number): OutputLine[];
  clear(): void;
  getTotalLines(): number;
}

interface OutputLine {
  timestamp: Date;
  type: 'stdout' | 'stderr';
  content: string;
  lineNumber: number;
}
```

### New Tools

#### 1. `run_background`
Starts a command in the background and returns immediately.

```typescript
Parameters:
- command: string        // Command to execute
- args?: string[]        // Command arguments
- session?: string       // Session name/ID (default: "default")
- cwd?: string          // Working directory override
- env?: Record<string, string>  // Environment variables
- bufferSize?: number   // Max output lines to buffer (default: 300, AI-optimized)

Returns:
- processId: string     // UUID of the background process
- pid: number          // System process ID
- status: string       // Initial status ("starting" or "running")
```

#### 2. `list_processes`
Lists all background processes, optionally filtered by session or status.

```typescript
Parameters:
- session?: string      // Filter by session
- status?: ProcessStatus // Filter by status
- includeOutput?: boolean // Include recent output (default: false)

Returns:
- processes: Array<{
    id: string
    sessionName: string
    command: string
    args: string[]
    pid: number | null
    status: ProcessStatus
    startTime: string
    runtime: number     // milliseconds
    outputLines: number // total lines captured
    recentOutput?: string[] // last 10 lines if requested
  }>
```

#### 3. `get_process_output`
Retrieves buffered output from a background process.

```typescript
Parameters:
- processId: string     // Background process ID
- lines?: number        // Number of lines to retrieve (default: 100)
- fromLine?: number     // Start from specific line number
- type?: 'all' | 'stdout' | 'stderr' // Filter by output type

Returns:
- processId: string
- status: ProcessStatus
- totalLines: number
- requestedLines: number
- output: Array<{
    timestamp: string
    type: 'stdout' | 'stderr'
    content: string
    lineNumber: number
  }>
```

#### 4. `kill_process`
Sends a signal to a background process.

**Important Note (v2.5.2)**: Fixed a critical bug where killing processes would crash the server due to unhandled promise rejection. The implementation now includes proper error handling for SIGTERM/SIGKILL signals.

```typescript
Parameters:
- processId: string     // Background process ID
- signal?: string       // Signal to send (default: "SIGTERM")
- force?: boolean       // Use SIGKILL if true

Returns:
- processId: string
- previousStatus: ProcessStatus
- newStatus: ProcessStatus
- killed: boolean
```

### Implementation Details

#### Process Management

1. **Starting Processes**
   ```typescript
   import { spawn } from 'child_process';
   
   const proc = spawn(command, args, {
     detached: true,
     shell: '/bin/zsh',
     cwd: session.cwd,
     env: { ...session.env, ...env },
     stdio: ['ignore', 'pipe', 'pipe']
   });
   
   // Don't wait for process to exit
   proc.unref();
   ```

2. **Output Capture**
   ```typescript
   proc.stdout.on('data', (chunk) => {
     const lines = chunk.toString().split('\n');
     lines.forEach(line => {
       if (line) {
         process.outputBuffer.add({
           timestamp: new Date(),
           type: 'stdout',
           content: line,
           lineNumber: ++lineCount
         });
       }
     });
   });
   ```

3. **Process Monitoring**
   ```typescript
   proc.on('exit', (code, signal) => {
     process.status = code === 0 ? ProcessStatus.STOPPED : ProcessStatus.FAILED;
     process.exitCode = code;
     process.endTime = new Date();
   });
   
   // v2.5.2: Handle process termination errors
   proc.catch((error) => {
     if (error.isTerminated && (error.signal === 'SIGTERM' || error.signal === 'SIGKILL')) {
       // Expected termination, don't crash the server
       console.log(`Process ${processId} terminated with ${error.signal}`);
     } else {
       // Unexpected error
       console.error(`Unexpected error in process ${processId}:`, error);
     }
   });
   ```

#### Resource Management

1. **Output Buffer Limits**
   - Default: 300 lines per process (AI-optimized)
   - Configurable per process
   - Circular buffer drops oldest lines when full

2. **Process Limits**
   - Max 50 background processes per session
   - Max 200 total background processes
   - Automatic cleanup of stopped processes after 1 hour

3. **Memory Management**
   - Monitor total buffer memory usage
   - Warn when approaching limits
   - Option to clear old output

#### Session Integration

1. **Session Cleanup**
   - When closing a session, prompt about running background processes
   - Option to kill all or transfer to default session
   - Prevent accidental process orphaning

2. **Session State**
   - Include background process count in `list_shell_sessions`
   - Track resource usage per session

### Example Usage

```typescript
// Start a long-running build process
const { processId } = await run_background({
  command: "npm",
  args: ["run", "build:watch"],
  session: "dev"
});

// Check on all processes
const processes = await list_processes();
// Returns: [
//   {
//     id: "abc-123",
//     sessionName: "dev",
//     command: "npm",
//     args: ["run", "build:watch"],
//     pid: 12345,
//     status: "running",
//     startTime: "2024-05-30T15:30:00Z",
//     runtime: 45000,
//     outputLines: 234
//   }
// ]

// Get recent output
const output = await get_process_output({
  processId: "abc-123",
  lines: 50
});

// Kill the process
await kill_process({
  processId: "abc-123"
});
```

### Migration Path

1. Existing `run_command` behavior unchanged
2. Add `runInBackground` option to `run_command` (deprecated path)
3. New tools are additive, no breaking changes

### Testing Strategy

1. **Unit Tests**
   - CircularBuffer implementation
   - Process lifecycle management
   - Resource limit enforcement

2. **Integration Tests**
   - Start/monitor/kill cycle
   - Output capture accuracy
   - Session cleanup behavior

3. **Stress Tests**
   - Many processes (test limits)
   - Large output volumes
   - Rapid start/stop cycles

### Security Considerations

1. **Resource Limits**
   - Enforce process count limits
   - Monitor memory usage
   - CPU usage tracking (future)

2. **Command Validation**
   - No different from current `run_command`
   - Inherit current security model

3. **Process Isolation**
   - Processes run with user permissions
   - No elevation of privileges

### Future Enhancements

1. **Process Groups**
   - Group related processes
   - Bulk operations

2. **Process Templates**
   - Save common background tasks
   - Quick restart capability

3. **Metrics and Monitoring**
   - CPU/memory usage tracking
   - Process health checks
   - Alerts for failed processes

4. **~~Persistence~~** ✅ Implemented in v2.3.0
   - ~~Reconnect to processes after server restart~~ (Not possible - processes marked as terminated)
   - ~~Save process state to disk~~ ✅ Process metadata and output saved to `~/.macos-shell/processes`

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
- [ ] Create BackgroundProcess interface
- [ ] Implement CircularBuffer class
- [ ] Add background process tracking to SessionManager
- [ ] Implement process lifecycle management

### Phase 2: MCP Tools (Week 2)
- [ ] Implement `run_background` tool
- [ ] Implement `list_processes` tool
- [ ] Implement `get_process_output` tool
- [ ] Implement `kill_process` tool

### Phase 3: Integration & Testing (Week 3)
- [ ] Update existing tools for background process awareness
- [ ] Write tests
- [ ] Update documentation
- [ ] Performance testing and optimization

### Phase 4: Polish & Release (Week 4)
- [ ] Error handling improvements
- [ ] Resource limit tuning
- [ ] User documentation and examples
- [ ] Release version 2.1.0

## Success Metrics

1. **Functionality**
   - Can start/stop background processes reliably
   - Output capture works without data loss
   - Resource limits prevent system abuse

2. **Performance**
   - Minimal overhead for background processes
   - Efficient output buffering
   - Quick process status queries

3. **Usability**
   - Clear API with good error messages
   - Process management
   - Helpful documentation and examples

## Open Questions

1. Should we add process restart capability?
2. How to handle very long-running processes (days/weeks)?
3. Should we support process groups/dependencies?
4. Add support for piping between background processes?

## Conclusion

Background process management will significantly enhance the macOS Shell MCP Server, enabling use cases like:
- Development servers (webpack, nodemon)
- Build watchers
- Log tailing
- System monitoring
- Batch processing

This design provides a solid foundation that can be extended with additional features as needed.