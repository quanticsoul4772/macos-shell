// Enhanced Batch Executor with Conditional Execution
// AI-optimized improvements for conditional command chaining

import { z } from 'zod';
import { execa, ExecaError } from 'execa';
import { v4 as uuidv4 } from 'uuid';

// Condition types for command execution
export const ConditionSchema = z.object({
  type: z.enum(['exitCode', 'stdout', 'stderr', 'success', 'previousCommand']),
  operator: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'matches', 'greaterThan', 'lessThan']),
  value: z.union([z.string(), z.number(), z.boolean()]),
  targetCommand: z.number().optional().describe("Index of command to check (default: previous)")
});

// Enhanced schema with conditions
export const EnhancedBatchExecuteSchema = z.object({
  commands: z.array(z.object({
    command: z.string(),
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    continueOnError: z.boolean().default(false),
    condition: ConditionSchema.optional().describe("Execute only if condition is met"),
    retryOnFailure: z.number().optional().default(0).describe("Number of retries if command fails"),
    retryDelay: z.number().optional().default(1000).describe("Delay between retries in ms")
  })),
  parallel: z.boolean().default(false),
  maxParallel: z.number().default(5),
  session: z.string().optional(),
  timeout: z.number().default(30000),
  stopOnFirstFailure: z.boolean().default(false).describe("Stop entire batch on first failure"),
  maxOutputLines: z.number().optional().default(50).describe("Maximum lines of stdout/stderr per command (default: 50)"),
  includeFullOutput: z.boolean().optional().default(false).describe("Include full output regardless of size")
});

export type EnhancedBatchCommand = z.infer<typeof EnhancedBatchExecuteSchema>['commands'][0];
export type Condition = z.infer<typeof ConditionSchema>;

export interface EnhancedBatchResult {
  id: string;
  command: string;
  args: string[];
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
  retries?: number;
  stdoutLines?: number;
  stderrLines?: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}

export interface EnhancedBatchExecutionResult {
  batchId: string;
  results: EnhancedBatchResult[];
  totalCommands: number;
  executedCount: number;
  skippedCount: number;
  successCount: number;
  failureCount: number;
  totalDuration: number;
  parallel: boolean;
  outputTruncated?: boolean;
  tip?: string;
}

/**
 * Enhanced Batch Executor with conditional execution and retry logic
 * Optimized for AI workflows that need intelligent command chaining
 */
export class EnhancedBatchExecutor {
  constructor(
    private getSessionCwd: (sessionId?: string) => Promise<string>,
    private getSessionEnv: (sessionId?: string) => Promise<Record<string, string>>
  ) {}
  
  private truncateOutput(output: string, maxLines: number): {
    truncated: string;
    totalLines: number;
    isTruncated: boolean;
  } {
    const lines = output.split('\n');
    const totalLines = lines.length;
    
    if (totalLines <= maxLines) {
      return {
        truncated: output,
        totalLines,
        isTruncated: false
      };
    }
    
    const halfLines = Math.floor(maxLines / 2);
    const headLines = lines.slice(0, halfLines);
    const tailLines = lines.slice(-halfLines);
    const omittedCount = totalLines - maxLines;
    
    const truncated = [
      ...headLines,
      `\n... [${omittedCount} lines omitted] ...\n`,
      ...tailLines
    ].join('\n');
    
    return {
      truncated,
      totalLines,
      isTruncated: true
    };
  }
  
  async execute(params: z.infer<typeof EnhancedBatchExecuteSchema>): Promise<EnhancedBatchExecutionResult> {
    const batchId = uuidv4();
    const startTime = Date.now();
    
    // Get session defaults
    const defaultCwd = await this.getSessionCwd(params.session);
    const defaultEnv = await this.getSessionEnv(params.session);
    
    let results: EnhancedBatchResult[];
    
    if (params.parallel) {
      // Parallel execution doesn't support conditions between commands
      results = await this.executeParallel(
        params.commands, 
        defaultCwd, 
        defaultEnv, 
        params.maxParallel,
        params.timeout,
        params.maxOutputLines,
        params.includeFullOutput
      );
    } else {
      results = await this.executeSequential(
        params.commands, 
        defaultCwd, 
        defaultEnv,
        params.timeout,
        params.stopOnFirstFailure,
        params.maxOutputLines,
        params.includeFullOutput
      );
    }
    
    const executedCount = results.filter(r => !r.skipped).length;
    const skippedCount = results.filter(r => r.skipped).length;
    const successCount = results.filter(r => r.success && !r.skipped).length;
    const failureCount = results.filter(r => !r.success && !r.skipped).length;
    const totalDuration = Date.now() - startTime;
    
    // Check if any output was truncated
    const outputTruncated = results.some(r => r.stdoutTruncated || r.stderrTruncated);
    
    return {
      batchId,
      results,
      totalCommands: params.commands.length,
      executedCount,
      skippedCount,
      successCount,
      failureCount,
      totalDuration,
      parallel: params.parallel,
      ...(outputTruncated && {
        outputTruncated: true,
        tip: `Output was truncated. Use maxOutputLines parameter to increase limit (current: ${params.maxOutputLines}) or set includeFullOutput: true`
      })
    };
  }
  
  private async executeSequential(
    commands: EnhancedBatchCommand[],
    defaultCwd: string,
    defaultEnv: Record<string, string>,
    timeout: number,
    stopOnFirstFailure: boolean,
    maxOutputLines: number,
    includeFullOutput: boolean
  ): Promise<EnhancedBatchResult[]> {
    const results: EnhancedBatchResult[] = [];
    
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      
      // Check condition if specified
      if (cmd.condition) {
        const shouldExecute = this.evaluateCondition(cmd.condition, results);
        
        if (!shouldExecute) {
          results.push({
            id: uuidv4(),
            command: cmd.command,
            args: cmd.args,
            success: false,
            exitCode: null,
            stdout: '',
            stderr: '',
            duration: 0,
            skipped: true,
            skipReason: `Condition not met: ${JSON.stringify(cmd.condition)}`
          });
          continue;
        }
      }
      
      // Execute with retry logic
      let lastResult: EnhancedBatchResult | null = null;
      let retries = 0;
      
      for (let attempt = 0; attempt <= cmd.retryOnFailure; attempt++) {
        if (attempt > 0) {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, cmd.retryDelay));
          retries++;
        }
        
        lastResult = await this.executeCommand(cmd, defaultCwd, defaultEnv, timeout, maxOutputLines, includeFullOutput);
        
        if (lastResult.success) {
          break;
        }
      }
      
      if (lastResult) {
        lastResult.retries = retries;
        results.push(lastResult);
        
        // Stop on error if configured
        if (!lastResult.success && !lastResult.skipped) {
          if (stopOnFirstFailure || (!cmd.continueOnError && cmd.retryOnFailure === 0)) {
            break;
          }
        }
      }
    }
    
    return results;
  }
  
  private evaluateCondition(condition: Condition, previousResults: EnhancedBatchResult[]): boolean {
    // Determine which command result to check
    const targetIndex = condition.targetCommand ?? previousResults.length - 1;
    
    if (targetIndex < 0 || targetIndex >= previousResults.length) {
      return false; // No valid target
    }
    
    const targetResult = previousResults[targetIndex];
    
    if (targetResult.skipped) {
      return false; // Can't evaluate against skipped commands
    }
    
    let value: any;
    
    switch (condition.type) {
      case 'exitCode':
        value = targetResult.exitCode;
        break;
      case 'stdout':
        value = targetResult.stdout;
        break;
      case 'stderr':
        value = targetResult.stderr;
        break;
      case 'success':
        value = targetResult.success;
        break;
      case 'previousCommand':
        value = `${targetResult.command} ${targetResult.args.join(' ')}`;
        break;
    }
    
    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'notEquals':
        return value !== condition.value;
      case 'contains':
        return String(value).includes(String(condition.value));
      case 'notContains':
        return !String(value).includes(String(condition.value));
      case 'matches':
        try {
          const regex = new RegExp(String(condition.value));
          return regex.test(String(value));
        } catch {
          return false;
        }
      case 'greaterThan':
        return Number(value) > Number(condition.value);
      case 'lessThan':
        return Number(value) < Number(condition.value);
      default:
        return false;
    }
  }
  
  private async executeParallel(
    commands: EnhancedBatchCommand[],
    defaultCwd: string,
    defaultEnv: Record<string, string>,
    maxParallel: number,
    timeout: number,
    maxOutputLines: number,
    includeFullOutput: boolean
  ): Promise<EnhancedBatchResult[]> {
    const results: EnhancedBatchResult[] = new Array(commands.length);
    const executing = new Set<Promise<void>>();
    
    for (let i = 0; i < commands.length; i++) {
      const index = i;
      const cmd = commands[i];
      
      // Skip commands with conditions in parallel mode
      if (cmd.condition) {
        results[index] = {
          id: uuidv4(),
          command: cmd.command,
          args: cmd.args,
          success: false,
          exitCode: null,
          stdout: '',
          stderr: '',
          duration: 0,
          skipped: true,
          skipReason: 'Conditions not supported in parallel mode'
        };
        continue;
      }
      
      const executeTask = async () => {
        // Execute with retry logic
        let lastResult: EnhancedBatchResult | null = null;
        let retries = 0;
        
        for (let attempt = 0; attempt <= cmd.retryOnFailure; attempt++) {
          if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, cmd.retryDelay));
            retries++;
          }
          
          lastResult = await this.executeCommand(cmd, defaultCwd, defaultEnv, timeout, maxOutputLines, includeFullOutput);
          
          if (lastResult.success) {
            break;
          }
        }
        
        if (lastResult) {
          lastResult.retries = retries;
          results[index] = lastResult;
        }
      };
      
      const promise = executeTask();
      executing.add(promise);
      
      // Clean up completed promises
      promise.finally(() => executing.delete(promise));
      
      // Limit parallel execution
      if (executing.size >= maxParallel) {
        await Promise.race(executing);
      }
    }
    
    // Wait for all remaining tasks
    await Promise.all(executing);
    
    return results;
  }
  
  private async executeCommand(
    cmd: EnhancedBatchCommand,
    defaultCwd: string,
    defaultEnv: Record<string, string>,
    timeout: number,
    maxOutputLines: number,
    includeFullOutput: boolean
  ): Promise<EnhancedBatchResult> {
    const id = uuidv4();
    const startTime = Date.now();
    
    try {
      const { stdout, stderr, exitCode } = await execa(
        cmd.command,
        cmd.args,
        {
          shell: '/bin/zsh',
          cwd: cmd.cwd || defaultCwd,
          env: { ...defaultEnv, ...cmd.env },
          timeout,
          reject: false // Handle all exit codes
        }
      );
      
      const success = exitCode === 0;
      
      // Truncate output if needed
      let finalStdout = stdout;
      let finalStderr = stderr;
      let stdoutLines: number | undefined;
      let stderrLines: number | undefined;
      let stdoutTruncated: boolean | undefined;
      let stderrTruncated: boolean | undefined;
      
      if (!includeFullOutput) {
        const stdoutResult = this.truncateOutput(stdout, maxOutputLines);
        const stderrResult = this.truncateOutput(stderr, maxOutputLines);
        
        finalStdout = stdoutResult.truncated;
        finalStderr = stderrResult.truncated;
        
        if (stdoutResult.isTruncated || stderrResult.isTruncated) {
          stdoutLines = stdoutResult.totalLines;
          stderrLines = stderrResult.totalLines;
          stdoutTruncated = stdoutResult.isTruncated;
          stderrTruncated = stderrResult.isTruncated;
        }
      }
      
      return {
        id,
        command: cmd.command,
        args: cmd.args,
        success,
        exitCode: exitCode ?? 0,
        stdout: finalStdout,
        stderr: finalStderr,
        duration: Date.now() - startTime,
        ...(stdoutLines !== undefined && { stdoutLines }),
        ...(stderrLines !== undefined && { stderrLines }),
        ...(stdoutTruncated !== undefined && { stdoutTruncated }),
        ...(stderrTruncated !== undefined && { stderrTruncated })
      };
    } catch (error) {
      const execaError = error as ExecaError;
      
      const rawStdout = typeof execaError.stdout === 'string' ? execaError.stdout : '';
      const rawStderr = typeof execaError.stderr === 'string' ? execaError.stderr : '';
      
      // Truncate output if needed
      let finalStdout = rawStdout;
      let finalStderr = rawStderr;
      let stdoutLines: number | undefined;
      let stderrLines: number | undefined;
      let stdoutTruncated: boolean | undefined;
      let stderrTruncated: boolean | undefined;
      
      if (!includeFullOutput) {
        const stdoutResult = this.truncateOutput(rawStdout, maxOutputLines);
        const stderrResult = this.truncateOutput(rawStderr, maxOutputLines);
        
        finalStdout = stdoutResult.truncated;
        finalStderr = stderrResult.truncated;
        
        if (stdoutResult.isTruncated || stderrResult.isTruncated) {
          stdoutLines = stdoutResult.totalLines;
          stderrLines = stderrResult.totalLines;
          stdoutTruncated = stdoutResult.isTruncated;
          stderrTruncated = stderrResult.isTruncated;
        }
      }
      
      return {
        id,
        command: cmd.command,
        args: cmd.args,
        success: false,
        exitCode: execaError.exitCode ?? -1,
        stdout: finalStdout,
        stderr: finalStderr,
        duration: Date.now() - startTime,
        error: execaError.message || 'Unknown error',
        ...(stdoutLines !== undefined && { stdoutLines }),
        ...(stderrLines !== undefined && { stderrLines }),
        ...(stdoutTruncated !== undefined && { stdoutTruncated }),
        ...(stderrTruncated !== undefined && { stderrTruncated })
      };
    }
  }
}
