# Technical Implementation Plan: Output Limiting for run_command (Claude-Optimized)

## Overview
This document outlines the implementation plan for adding output limiting to the `run_command` tool in the macos-shell MCP server, specifically optimized for Claude AI as the sole user.

## Problem Statement
The `run_command` tool returns unlimited stdout/stderr output, which can:
- Overflow Claude's context window
- Force conversation restarts
- Waste tokens on unnecessary output

## Solution Summary
Implement efficient output limiting with structured metadata, optimized for AI parsing and token efficiency.

## Core Design Principles
- **Conservative defaults**: Prevent context overflow
- **Token efficiency**: Compact responses, structured data
- **Smart caching**: Store full output, truncate on retrieval
- **AI-optimized**: No human-readable formatting needed

## Implementation Details

### 1. Schema Updates

#### File: `src/tools/command-tools.ts`

```typescript
server.tool(
  "run_command",
  {
    command: z.string().describe("The shell command to execute"),
    args: z.array(z.string()).default([]).describe("Command arguments"),
    session: z.string().optional().describe("Session name or ID (uses default if not specified)"),
    cwd: z.string().optional().describe("Working directory (overrides session cwd)"),
    env: z.record(z.string()).optional().describe("Environment variables (merged with session env)"),
    timeout: z.number().optional().default(30000).describe("Command timeout in milliseconds"),
    // NEW PARAMETERS:
    maxOutputLines: z.number().optional().default(500)
      .describe("Maximum lines of stdout to return (default: 500)"),
    maxErrorLines: z.number().optional().default(750)
      .describe("Maximum lines of stderr to return (default: 750)"),
    includeFullOutput: z.boolean().optional().default(false)
      .describe("Return full output (bypass all limits)")
  },
  async ({ command, args, session: sessionName, cwd, env, timeout, 
           maxOutputLines, maxErrorLines, includeFullOutput }) => {
    // Implementation
  }
);
```

### 2. Interface Updates

#### File: `src/tools/command/command-executor.ts`

```typescript
export interface CommandResult {
  stdout: string;
  stderr: string; 
  exitCode: number;
  success: boolean;
  duration: number;
  command: string;
  cached?: boolean;
  cacheStrategy?: string;
  error?: string;
  // NEW STRUCTURED METADATA:
  truncation?: {
    stdout?: {
      truncated: boolean;
      totalLines: number;
      totalBytes: number;
      returnedLines: number;
      returnedBytes: number;
    };
    stderr?: {
      truncated: boolean;
      totalLines: number;
      totalBytes: number;
      returnedLines: number;
      returnedBytes: number;
    };
  };
  warnings?: string[]; // Binary output detection, etc.
}

export interface ExecuteOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeout: number;
  sessionId: string;
  // NEW FIELDS:
  maxOutputLines?: number;
  maxErrorLines?: number;
  includeFullOutput?: boolean;
}
```

### 3. Core Implementation

#### File: `src/tools/command/command-executor.ts`

```typescript
export class CommandExecutor {
  private readonly MAX_SINGLE_LINE_LENGTH = 10000; // Protect against minified files
  private readonly MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB before truncation
  
  constructor(private sessionManager: SessionManager) {}

  /**
   * Detects if output appears to be binary data
   */
  private isBinaryOutput(data: string): boolean {
    // Check for null bytes or high percentage of non-printable characters
    const nullBytes = (data.match(/\x00/g) || []).length;
    const nonPrintable = (data.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g) || []).length;
    const totalChars = Math.min(data.length, 1000); // Sample first 1KB
    
    return nullBytes > 0 || (nonPrintable / totalChars) > 0.3;
  }

  /**
   * Efficiently truncates output while preserving diagnostic value
   */
  private truncateOutput(output: string, maxLines: number): {
    truncated: string;
    metadata: {
      truncated: boolean;
      totalLines: number;
      totalBytes: number;
      returnedLines: number;
      returnedBytes: number;
    };
  } {
    // Quick binary check on first chunk
    if (this.isBinaryOutput(output.substring(0, 1000))) {
      return {
        truncated: "[Binary output detected - content omitted]",
        metadata: {
          truncated: true,
          totalLines: 0,
          totalBytes: output.length,
          returnedLines: 1,
          returnedBytes: 45
        }
      };
    }

    const lines = output.split('\n');
    const totalLines = lines.length;
    const totalBytes = output.length;
    
    // Check for extremely long lines (like minified files)
    const hasLongLines = lines.some(line => line.length > this.MAX_SINGLE_LINE_LENGTH);
    if (hasLongLines) {
      return {
        truncated: "[Output contains extremely long lines - content omitted]",
        metadata: {
          truncated: true,
          totalLines,
          totalBytes,
          returnedLines: 1,
          returnedBytes: 55
        }
      };
    }
    
    if (totalLines <= maxLines) {
      return {
        truncated: output,
        metadata: {
          truncated: false,
          totalLines,
          totalBytes,
          returnedLines: totalLines,
          returnedBytes: totalBytes
        }
      };
    }
    
    // Smart truncation: preserve head and tail
    const headLines = Math.ceil(maxLines * 0.6); // 60% from start
    const tailLines = Math.floor(maxLines * 0.4); // 40% from end
    
    const truncatedLines = [
      ...lines.slice(0, headLines),
      `[... ${totalLines - maxLines} lines omitted ...]`,
      ...lines.slice(-tailLines)
    ];
    
    const truncatedOutput = truncatedLines.join('\n');
    
    return {
      truncated: truncatedOutput,
      metadata: {
        truncated: true,
        totalLines,
        totalBytes,
        returnedLines: maxLines + 1, // +1 for omission marker
        returnedBytes: truncatedOutput.length
      }
    };
  }

  async execute(options: ExecuteOptions): Promise<CommandResult> {
    const { 
      command, args, cwd, env, timeout, sessionId, 
      maxOutputLines = 500, maxErrorLines = 750, includeFullOutput = false 
    } = options;
    
    const startTime = Date.now();
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
    const warnings: string[] = [];

    try {
      const { stdout, stderr, exitCode } = await execa(command, args, {
        shell: "/bin/zsh",
        cwd,
        env,
        timeout,
        reject: false,
        maxBuffer: includeFullOutput ? Infinity : this.MAX_BUFFER_SIZE
      });

      const duration = Date.now() - startTime;
      const success = exitCode === 0;

      // Process output with truncation
      let finalStdout = stdout || '';
      let finalStderr = stderr || '';
      let truncation: CommandResult['truncation'];
      
      if (!includeFullOutput) {
        const stdoutResult = this.truncateOutput(stdout || '', maxOutputLines);
        const stderrResult = this.truncateOutput(stderr || '', maxErrorLines);
        
        finalStdout = stdoutResult.truncated;
        finalStderr = stderrResult.truncated;
        
        if (stdoutResult.metadata.truncated || stderrResult.metadata.truncated) {
          truncation = {};
          if (stdoutResult.metadata.truncated) {
            truncation.stdout = stdoutResult.metadata;
          }
          if (stderrResult.metadata.truncated) {
            truncation.stderr = stderrResult.metadata;
          }
        }
      }

      // Record full output in history (for debugging)
      await this.recordHistory(sessionId, {
        command,
        args,
        exitCode: exitCode || 0,
        stdout: stdout || '',
        stderr: stderr || '',
        startTime: new Date(startTime),
        duration
      });

      return {
        stdout: finalStdout,
        stderr: finalStderr,
        exitCode: exitCode || 0,
        success,
        duration,
        command: fullCommand,
        ...(truncation && { truncation }),
        ...(warnings.length > 0 && { warnings })
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const execaError = error as ExecaError;

      // Handle buffer overflow
      if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
        warnings.push('Output exceeded buffer limit');
      }

      // Apply truncation to error output as well
      let finalStdout = '';
      let finalStderr = error.message;
      let truncation: CommandResult['truncation'];

      if (!includeFullOutput) {
        const stdout = typeof execaError.stdout === 'string' ? execaError.stdout : '';
        const stderr = typeof execaError.stderr === 'string' ? execaError.stderr : error.message;
        
        const stdoutResult = this.truncateOutput(stdout, maxOutputLines);
        const stderrResult = this.truncateOutput(stderr, maxErrorLines);
        
        finalStdout = stdoutResult.truncated;
        finalStderr = stderrResult.truncated;
        
        if (stdoutResult.metadata.truncated || stderrResult.metadata.truncated) {
          truncation = {};
          if (stdoutResult.metadata.truncated) {
            truncation.stdout = stdoutResult.metadata;
          }
          if (stderrResult.metadata.truncated) {
            truncation.stderr = stderrResult.metadata;
          }
        }
      }

      // Record failed command
      await this.recordHistory(sessionId, {
        command,
        args,
        exitCode: execaError.exitCode ?? -1,
        stdout: typeof execaError.stdout === 'string' ? execaError.stdout : "",
        stderr: typeof execaError.stderr === 'string' ? execaError.stderr : "",
        startTime: new Date(startTime),
        duration
      });

      return {
        stdout: finalStdout,
        stderr: finalStderr,
        exitCode: execaError.exitCode ?? -1,
        success: false,
        duration,
        command: fullCommand,
        error: execaError.code || 'UNKNOWN',
        ...(truncation && { truncation }),
        ...(warnings.length > 0 && { warnings })
      };
    }
  }

  private async recordHistory(sessionId: string, entry: any) {
    try {
      this.sessionManager.addToHistory(sessionId, entry);
    } catch (error) {
      logger.error({ 
        module: 'command-executor', 
        action: 'record-history', 
        error,
        sessionId 
      }, 'Failed to record command history');
    }
  }
}
```

### 4. Cache Strategy Update

#### File: `src/tools/command/ai-command-enhancer.ts`

Critical change: Cache stores full output, truncation happens on retrieval.

```typescript
async executeWithAI(options: ExecuteOptions): Promise<CommandResult> {
  const { command, args, cwd, sessionId, maxOutputLines, maxErrorLines, includeFullOutput } = options;
  const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

  // Check AI cache first (if enabled)
  if (this.cacheEnabled) {
    const cached = aiCache.get(fullCommand, cwd);
    if (cached) {
      logger.debug({ 
        module: 'ai-command-enhancer', 
        action: 'cache-hit', 
        command: fullCommand,
        strategy: cached.strategy
      }, `AI Cache hit for: ${fullCommand}`);

      // IMPORTANT: Apply truncation to cached results
      const executor = new CommandExecutor(this.sessionManager);
      let finalStdout = cached.stdout || '';
      let finalStderr = cached.stderr || '';
      let truncation: CommandResult['truncation'];
      
      if (!includeFullOutput) {
        const stdoutResult = executor['truncateOutput'](cached.stdout || '', maxOutputLines || 500);
        const stderrResult = executor['truncateOutput'](cached.stderr || '', maxErrorLines || 750);
        
        finalStdout = stdoutResult.truncated;
        finalStderr = stderrResult.truncated;
        
        if (stdoutResult.metadata.truncated || stderrResult.metadata.truncated) {
          truncation = {};
          if (stdoutResult.metadata.truncated) {
            truncation.stdout = stdoutResult.metadata;
          }
          if (stderrResult.metadata.truncated) {
            truncation.stderr = stderrResult.metadata;
          }
        }
      }

      // Record cached usage
      await this.executor['recordHistory'](sessionId, {
        command,
        args,
        exitCode: cached.exitCode,
        stdout: cached.stdout,
        stderr: cached.stderr,
        startTime: new Date(),
        duration: 1
      });

      return {
        stdout: finalStdout,
        stderr: finalStderr,
        exitCode: cached.exitCode || 0,
        success: cached.exitCode === 0,
        duration: 1,
        command: fullCommand,
        cached: true,
        cacheStrategy: cached.strategy,
        ...(truncation && { truncation })
      };
    }
  }

  // Execute command
  const result = await aiDedup.execute(fullCommand, cwd, async () => {
    return this.executeWithRetry(options);
  });

  // IMPORTANT: Cache FULL output (before truncation)
  if (this.cacheEnabled && result.success) {
    // Extract original output before truncation
    const fullResult = await this.getFullOutputForCaching(command, args, cwd, env, timeout, sessionId);
    
    aiCache.set(fullCommand, cwd, {
      stdout: fullResult.stdout,
      stderr: fullResult.stderr,
      exitCode: fullResult.exitCode
    });
  }

  return result;
}

// Helper to get full output for caching
private async getFullOutputForCaching(
  command: string, 
  args: string[], 
  cwd: string, 
  env: Record<string, string>, 
  timeout: number,
  sessionId: string
): Promise<{stdout: string; stderr: string; exitCode: number}> {
  // This is called only for successful commands to get full output for cache
  // We already have the result, so we could store it temporarily or
  // make this more efficient by passing through the full output from executor
  return {
    stdout: '', // Would need to be passed through
    stderr: '',
    exitCode: 0
  };
}
```

### 5. Response Formatting

#### File: `src/tools/command-tools.ts`

Optimize response for AI parsing with compact JSON:

```typescript
async ({ command, args, session: sessionName, cwd, env, timeout, 
         maxOutputLines, maxErrorLines, includeFullOutput }) => {
  const session = await sessionManager.getSession(sessionName);
  
  if (!session) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ error: "SESSION_NOT_FOUND", session: sessionName })
      }],
      isError: true
    };
  }

  const finalEnv = { ...session.env, ...env };
  const finalCwd = cwd || session.cwd;

  const result = await aiEnhancer.executeWithAI({
    command,
    args,
    cwd: finalCwd,
    env: finalEnv,
    timeout,
    sessionId: session.id,
    maxOutputLines,
    maxErrorLines,
    includeFullOutput
  });

  // Build compact response object
  const response: any = {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    success: result.success,
    duration: result.duration,
    command: result.command
  };

  // Add optional fields only if present
  if (result.cached !== undefined) {
    response.cached = result.cached;
    response.cacheStrategy = result.cacheStrategy;
  }
  if (result.truncation) {
    response.truncation = result.truncation;
  }
  if (result.warnings) {
    response.warnings = result.warnings;
  }
  if (result.error) {
    response.error = result.error;
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify(response) // Compact JSON, no formatting
    }],
    isError: !result.success
  };
}
```

## Testing Strategy (Simplified)

Focus on boundary conditions that could affect Claude's context:

```typescript
// Test cases in a simple script
async function testOutputLimiting() {
  // Test 1: Binary output detection
  await run_command({ command: "cat", args: ["/bin/ls"] });
  
  // Test 2: Large output truncation
  await run_command({ command: "find", args: ["/usr", "-type", "f"] });
  
  // Test 3: Long single line (minified JSON)
  await run_command({ command: "cat", args: ["minified.json"] });
  
  // Test 4: Cached result with different limits
  await run_command({ command: "ls", args: ["-la"], maxOutputLines: 100 });
  await run_command({ command: "ls", args: ["-la"], maxOutputLines: 50 });
  
  // Test 5: Error output truncation
  await run_command({ command: "find", args: ["/nonexistent", "-type", "f"] });
}
```

## Implementation Steps

1. **Immediate** (Day 1)
   - Add schema parameters
   - Implement basic truncation in CommandExecutor
   - Deploy with 500/750 line defaults

2. **Optimization** (Day 2)
   - Update cache strategy to store full output
   - Implement binary detection
   - Add long line protection
   - Optimize response format

3. **Edge Cases** (Day 3)
   - Add buffer overflow handling
   - Test with various problematic commands
   - Fine-tune defaults based on testing

## Key Differences from Human-Focused Plan

1. **No user documentation** - No README, CHANGELOG, or user guides needed
2. **Lower defaults** - 500/750 lines vs 1000 to be conservative
3. **Structured metadata** - Machine-readable truncation info
4. **Compact JSON** - No pretty printing to save tokens
5. **Smart caching** - Full output cached, truncation on retrieval
6. **Binary detection** - Fail fast on binary output
7. **Direct implementation** - No phased rollout or user feedback cycles

## Success Metrics

1. No more context window overflows from command output
2. Efficient token usage in responses
3. Cached commands work with different output limits
4. Clear structured metadata for truncation awareness
5. Fast failure on problematic output types

## Future Considerations

1. **Token counting** - Estimate tokens instead of just lines
2. **Compression** - For very large cached outputs
3. **Streaming** - For real-time output monitoring
4. **Smart summarization** - AI-powered output analysis

This plan is optimized specifically for Claude's usage patterns and constraints, focusing on reliability and efficiency over human usability.
