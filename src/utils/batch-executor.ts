import { z } from 'zod';
import { execa, ExecaError } from 'execa';
import { v4 as uuidv4 } from 'uuid';

// Schema for batch execution
export const BatchExecuteSchema = z.object({
  commands: z.array(z.object({
    command: z.string(),
    args: z.array(z.string()).default([]),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
    continueOnError: z.boolean().default(false)
  })),
  parallel: z.boolean().default(false),
  maxParallel: z.number().default(5),
  session: z.string().optional(),
  timeout: z.number().default(30000)
});

export type BatchCommand = z.infer<typeof BatchExecuteSchema>['commands'][0];

export interface BatchResult {
  id: string;
  command: string;
  args: string[];
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  error?: string;
}

export interface BatchExecutionResult {
  batchId: string;
  results: BatchResult[];
  totalCommands: number;
  successCount: number;
  failureCount: number;
  totalDuration: number;
  parallel: boolean;
}

/**
 * Batch command executor optimized for AI usage
 * Handles multiple commands efficiently with parallel execution support
 */
export class BatchExecutor {
  constructor(
    private getSessionCwd: (sessionId?: string) => Promise<string>,
    private getSessionEnv: (sessionId?: string) => Promise<Record<string, string>>
  ) {}
  
  async execute(params: z.infer<typeof BatchExecuteSchema>): Promise<BatchExecutionResult> {
    const batchId = uuidv4();
    const startTime = Date.now();
    
    // Get session defaults
    const defaultCwd = await this.getSessionCwd(params.session);
    const defaultEnv = await this.getSessionEnv(params.session);
    
    let results: BatchResult[];
    
    if (params.parallel) {
      results = await this.executeParallel(
        params.commands, 
        defaultCwd, 
        defaultEnv, 
        params.maxParallel,
        params.timeout
      );
    } else {
      results = await this.executeSequential(
        params.commands, 
        defaultCwd, 
        defaultEnv,
        params.timeout
      );
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    const totalDuration = Date.now() - startTime;
    
    return {
      batchId,
      results,
      totalCommands: params.commands.length,
      successCount,
      failureCount,
      totalDuration,
      parallel: params.parallel
    };
  }
  
  private async executeSequential(
    commands: BatchCommand[],
    defaultCwd: string,
    defaultEnv: Record<string, string>,
    timeout: number
  ): Promise<BatchResult[]> {
    const results: BatchResult[] = [];
    
    for (const cmd of commands) {
      const result = await this.executeCommand(cmd, defaultCwd, defaultEnv, timeout);
      results.push(result);
      
      // Stop on error if not set to continue
      if (!result.success && !cmd.continueOnError) {
        break;
      }
    }
    
    return results;
  }
  
  private async executeParallel(
    commands: BatchCommand[],
    defaultCwd: string,
    defaultEnv: Record<string, string>,
    maxParallel: number,
    timeout: number
  ): Promise<BatchResult[]> {
    const results: BatchResult[] = new Array(commands.length);
    const executing = new Set<Promise<void>>();
    
    for (let i = 0; i < commands.length; i++) {
      const index = i;
      const cmd = commands[i];
      
      const executeTask = async () => {
        const result = await this.executeCommand(cmd, defaultCwd, defaultEnv, timeout);
        results[index] = result;
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
    cmd: BatchCommand,
    defaultCwd: string,
    defaultEnv: Record<string, string>,
    timeout: number
  ): Promise<BatchResult> {
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
          timeout
        }
      );
      
      return {
        id,
        command: cmd.command,
        args: cmd.args,
        success: true,
        exitCode: exitCode ?? 0,
        stdout,
        stderr,
        duration: Date.now() - startTime
      };
    } catch (error) {
      const execaError = error as ExecaError;
      
      return {
        id,
        command: cmd.command,
        args: cmd.args,
        success: false,
        exitCode: execaError.exitCode ?? null,
        stdout: typeof execaError.stdout === 'string' ? execaError.stdout : '',
        stderr: typeof execaError.stderr === 'string' ? execaError.stderr : '',
        duration: Date.now() - startTime,
        error: execaError.message
      };
    }
  }
}
