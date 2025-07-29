# Orphan Process Handling - Implementation Plan

## Problem Statement

When the macOS Shell MCP server restarts, background processes continue running but the server loses its handles to them. Currently, these processes are marked as FAILED, leaving orphan processes running that I (as an AI assistant) cannot see or control through MCP. This forces me to ask for manual cleanup using Activity Monitor or terminal commands, which breaks the tool abstraction I rely on.

## Solution Overview

Implement an orphan process detection and cleanup system that:
1. Detects orphaned processes on server startup
2. Clearly identifies them with a new ORPHANED status
3. Provides tools for me (AI assistant) to manage orphans through MCP
4. Maintains visibility and control without surprises

## Implementation Details

### 1. Add ORPHANED Status

**File**: `src/background-process.ts`

```typescript
export enum ProcessStatus {
  STARTING = "starting",
  RUNNING = "running", 
  STOPPED = "stopped",
  FAILED = "failed",
  KILLED = "killed",
  ORPHANED = "orphaned"  // NEW
}
```

### 2. Detect Orphans on Startup

**File**: `src/server.ts` - Modify `loadProcessMetadata()` method

```typescript
private async loadProcessMetadata(): Promise<void> {
  try {
    const files = await fs.readdir(PROCESSES_DIR);
    const processFiles = files.filter(f => f.endsWith('.json'));
    
    for (const file of processFiles) {
      try {
        const data = await fs.readFile(path.join(PROCESSES_DIR, file), 'utf-8');
        const saved = JSON.parse(data);
        
        // Check if process is orphaned (still running)
        let status = ProcessStatus.FAILED;
        if (saved.pid && saved.status === ProcessStatus.RUNNING) {
          try {
            // Signal 0 checks if process is alive without affecting it
            process.kill(saved.pid, 0);
            status = ProcessStatus.ORPHANED;
            console.log(`Detected orphaned process: ${saved.command} (PID: ${saved.pid})`);
          } catch {
            // Process is not running, it's truly failed
            status = ProcessStatus.FAILED;
          }
        }
        
        // Reconstruct process metadata
        const backgroundProcess: BackgroundProcess = {
          id: saved.id,
          sessionId: saved.sessionId,
          command: saved.command,
          args: saved.args,
          pid: saved.pid,
          status: status,  // Use detected status
          startTime: new Date(saved.startTime),
          endTime: status === ProcessStatus.ORPHANED ? undefined : new Date(),
          exitCode: status === ProcessStatus.ORPHANED ? undefined : null,
          outputBuffer: new CircularBuffer(300), // AI-optimized
          metadata: saved.metadata
        };
        
        // Restore output history if available
        if (saved.outputHistory) {
          for (const line of saved.outputHistory) {
            backgroundProcess.outputBuffer.add({
              ...line,
              timestamp: new Date(line.timestamp)
            });
          }
        }
        
        this.backgroundProcesses.set(backgroundProcess.id, backgroundProcess);
      } catch (error) {
        console.error(`Failed to load process ${file}:`, error);
      }
    }
  } catch (error) {
    console.error("Failed to load process metadata:", error);
  }
}
```

### 3. Create cleanup_orphans Tool

**File**: `src/server.ts` - Add new MCP tool

```typescript
server.tool(
  "cleanup_orphans",
  {
    mode: z.enum(['list', 'kill', 'interactive']).default('interactive')
      .describe("Operation mode: list shows orphans, kill removes them, interactive asks for confirmation"),
    session: z.string().optional()
      .describe("Filter by session name or ID"),
    force: z.boolean().optional().default(false)
      .describe("Use SIGKILL instead of SIGTERM for killing")
  },
  async ({ mode, session: sessionName, force }) => {
    // Get orphaned processes
    let orphans = Array.from(sessionManager.backgroundProcesses.values())
      .filter(p => p.status === ProcessStatus.ORPHANED);
    
    // Filter by session if specified
    if (sessionName) {
      const session = await sessionManager.getSession(sessionName);
      if (!session) {
        return {
          content: [
            { 
              type: "text", 
              text: `Error: Session '${sessionName}' not found` 
            }
          ],
          isError: true
        };
      }
      orphans = orphans.filter(p => p.sessionId === session.id);
    }
    
    if (orphans.length === 0) {
      return {
        content: [
          { 
            type: "text", 
            text: sessionName 
              ? `No orphaned processes found in session '${sessionName}'` 
              : "No orphaned processes found" 
          }
        ]
      };
    }
    
    // Format orphan list
    const orphanList = await Promise.all(orphans.map(async p => {
      const session = await sessionManager.getSession(p.sessionId);
      return `- PID ${p.pid}: ${p.command} ${p.args.join(' ')} (session: ${session?.name || p.sessionId})`;
    }));
    
    switch (mode) {
      case 'list':
        return {
          content: [
            { 
              type: "text", 
              text: `Found ${orphans.length} orphaned process(es):\n\n${orphanList.join('\n')}\n\nThese processes are still running but cannot be managed by the MCP server.` 
            }
          ]
        };
        
      case 'kill':
        const signal = force ? 'SIGKILL' : 'SIGTERM';
        let killed = 0;
        let failed = 0;
        
        for (const orphan of orphans) {
          if (orphan.pid) {
            try {
              process.kill(orphan.pid, signal);
              killed++;
              // Update status
              sessionManager.updateBackgroundProcess(orphan.id, {
                status: ProcessStatus.KILLED,
                endTime: new Date()
              });
              // Schedule removal
              setTimeout(() => {
                sessionManager.backgroundProcesses.delete(orphan.id);
                sessionManager.deleteProcessFile(orphan.id);
              }, 5000);
            } catch (error) {
              failed++;
              console.error(`Failed to kill orphan ${orphan.pid}:`, error);
            }
          }
        }
        
        return {
          content: [
            { 
              type: "text", 
              text: `Orphan cleanup complete:\n- Killed: ${killed} process(es) with ${signal}\n- Failed: ${failed}\n\n${orphanList.join('\n')}` 
            }
          ]
        };
        
      case 'interactive':
        return {
          content: [
            { 
              type: "text", 
              text: `Found ${orphans.length} orphaned process(es):\n\n${orphanList.join('\n')}\n\nTo kill these processes, run: cleanup_orphans mode=kill\nTo force kill (SIGKILL), run: cleanup_orphans mode=kill force=true` 
            }
          ]
        };
    }
  }
);
```

### 4. Update list_processes Display

**File**: `src/server.ts` - Modify list_processes tool

```typescript
// In the list_processes tool, update the status display:
const processInfoPromises = processes.map(async p => {
  const runtime = p.endTime 
    ? `${((p.endTime.getTime() - p.startTime.getTime()) / 1000).toFixed(1)}s`
    : `${((Date.now() - p.startTime.getTime()) / 1000).toFixed(1)}s`;
  
  const sessionInfo = await sessionManager.getSession(p.sessionId);
  
  // Add warning for orphaned processes
  const statusDisplay = p.status === ProcessStatus.ORPHANED 
    ? `⚠️  ${p.status} (process still running but unmanaged)`
    : p.status;
  
  return `ID: ${p.id}
  Command: ${p.command} ${p.args.join(' ')}
  Status: ${statusDisplay}
  PID: ${p.pid || 'N/A'}${p.status === ProcessStatus.ORPHANED ? ' (kill manually or use cleanup_orphans)' : ''}
  Runtime: ${runtime}
  Session: ${sessionInfo?.name || p.sessionId}
  Started: ${p.startTime.toISOString()}${p.exitCode !== undefined ? `
  Exit code: ${p.exitCode}` : ''}`;
});
```

### 5. Allow kill_process on Orphans

**File**: `src/server.ts` - Modify kill_process tool

```typescript
// In kill_process tool, modify the status check:
if (process.status !== ProcessStatus.RUNNING && process.status !== ProcessStatus.ORPHANED) {
  return {
    content: [
      { 
        type: "text", 
        text: `Process '${process_id}' is not running (status: ${process.status})` 
      }
    ],
    isError: true
  };
}

// For orphaned processes, use system kill instead of process handle
if (process.status === ProcessStatus.ORPHANED && process.pid) {
  try {
    process.kill(process.pid, signal);
    sessionManager.updateBackgroundProcess(process_id, {
      status: ProcessStatus.KILLED,
      endTime: new Date()
    });
    // Schedule removal
    setTimeout(() => {
      sessionManager.backgroundProcesses.delete(process_id);
      sessionManager.deleteProcessFile(process_id);
    }, 5000);
    
    return {
      content: [
        { 
          type: "text", 
          text: `Successfully sent ${signal} to orphaned process '${process_id}'\nCommand: ${process.command} ${process.args.join(' ')}\nPID: ${process.pid}\nNote: Process will be removed from list after 5 seconds` 
        }
      ]
    };
  } catch (error: any) {
    return {
      content: [
        { 
          type: "text", 
          text: `Failed to kill orphaned process '${process_id}': ${error.message}` 
        }
      ],
      isError: true
    };
  }
}
```

## Benefits

1. **Visibility**: I can see which processes are orphaned through MCP
2. **Control**: I can clean up orphans without needing external tools
3. **Flexibility**: Multiple modes for different use cases in my workflow
4. **Safety**: No automatic killing unless I explicitly request it
5. **Transparency**: Clear status indicators and warnings for my decision-making

## Future Enhancements

1. **Auto-cleanup config**: Add server configuration option to automatically kill orphans on startup
2. **Grace period**: Allow configurable time before considering a process orphaned
3. **Process adoption**: Attempt to re-attach to orphaned processes (complex, OS-specific)

## Testing Plan

1. Start background processes
2. Restart server
3. Verify processes marked as ORPHANED
4. Test cleanup_orphans in all modes
5. Verify kill_process works on orphans
6. Confirm process files are cleaned up

## Migration Notes

- No breaking changes to existing tools
- Existing FAILED status remains for truly dead processes
- New ORPHANED status is additive
- cleanup_orphans is a new tool, doesn't affect existing workflows
