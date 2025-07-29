// Command Executor Module
// Core command execution logic without AI enhancements

import { execa, ExecaError } from "execa";
import { SessionManager } from '../../session-manager.js';
import logger from '../../utils/logger.js';

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
}

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
      maxOutputLines = 100, maxErrorLines = 50 
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
        reject: false,  // Don't throw on non-zero exit
        maxBuffer: this.MAX_BUFFER_SIZE
      });

      const duration = Date.now() - startTime;
      const success = exitCode === 0;

      // Process output with truncation
      const stdoutResult = this.truncateOutput(stdout || '', maxOutputLines);
      const stderrResult = this.truncateOutput(stderr || '', maxErrorLines);
      
      const finalStdout = stdoutResult.truncated;
      const finalStderr = stderrResult.truncated;
      let truncation: CommandResult['truncation'];
      
      if (stdoutResult.metadata.truncated || stderrResult.metadata.truncated) {
        truncation = {};
        if (stdoutResult.metadata.truncated) {
          truncation.stdout = stdoutResult.metadata;
        }
        if (stderrResult.metadata.truncated) {
          truncation.stderr = stderrResult.metadata;
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
      const stdout = typeof execaError.stdout === 'string' ? execaError.stdout : '';
      const stderr = typeof execaError.stderr === 'string' ? execaError.stderr : error.message;
      
      const stdoutResult = this.truncateOutput(stdout, maxOutputLines);
      const stderrResult = this.truncateOutput(stderr, maxErrorLines);
      
      const finalStdout = stdoutResult.truncated;
      const finalStderr = stderrResult.truncated;
      let truncation: CommandResult['truncation'];
      
      if (stdoutResult.metadata.truncated || stderrResult.metadata.truncated) {
        truncation = {};
        if (stdoutResult.metadata.truncated) {
          truncation.stdout = stdoutResult.metadata;
        }
        if (stderrResult.metadata.truncated) {
          truncation.stderr = stderrResult.metadata;
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
