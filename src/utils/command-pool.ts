/**
 * Command Execution Pool
 * Manages concurrent command execution with pooling and rate limiting
 */

import { execa, Options as ExecaOptions } from 'execa';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { getLogger } from './logger.js';
import { CommandOptions, CommandResult } from '../types/command.types.js';

const logger = getLogger('command-pool');

export interface PoolOptions {
  maxConcurrent?: number;
  maxQueueSize?: number;
  queueTimeout?: number;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
}

export interface QueuedCommand {
  id: string;
  command: string;
  args: string[];
  options: ExecaOptions;
  priority: number;
  timestamp: Date;
  resolve: (result: CommandResult) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

export interface PoolStats {
  active: number;
  queued: number;
  completed: number;
  failed: number;
  averageWaitTime: number;
  averageExecutionTime: number;
  rejectedDueToQueueFull: number;
  rejectedDueToRateLimit: number;
}

export class CommandPool extends EventEmitter {
  private readonly options: Required<PoolOptions>;
  private readonly queue: QueuedCommand[] = [];
  private readonly activeCommands = new Map<string, ChildProcess>();
  private readonly executionTimes: number[] = [];
  private readonly waitTimes: number[] = [];
  
  // Rate limiting
  private requestTimestamps: number[] = [];
  
  // Statistics
  private stats: PoolStats = {
    active: 0,
    queued: 0,
    completed: 0,
    failed: 0,
    averageWaitTime: 0,
    averageExecutionTime: 0,
    rejectedDueToQueueFull: 0,
    rejectedDueToRateLimit: 0,
  };

  constructor(options: PoolOptions = {}) {
    super();
    
    this.options = {
      maxConcurrent: options.maxConcurrent || 10,
      maxQueueSize: options.maxQueueSize || 100,
      queueTimeout: options.queueTimeout || 30000,
      rateLimit: options.rateLimit || {
        maxRequests: 100,
        windowMs: 60000, // 1 minute
      },
    };

    logger.info({
      module: 'command-pool',
      action: 'initialize',
      maxConcurrent: this.options.maxConcurrent,
      maxQueueSize: this.options.maxQueueSize,
    }, 'Command pool initialized');
  }

  /**
   * Execute a command through the pool
   */
  async execute(
    command: string,
    args: string[] = [],
    options: ExecaOptions = {},
    priority: number = 5
  ): Promise<CommandResult> {
    const id = this.generateId();
    
    // Check rate limit
    if (!this.checkRateLimit()) {
      this.stats.rejectedDueToRateLimit++;
      const error = new Error('Rate limit exceeded');
      this.emit('rate-limited', { command, args });
      throw error;
    }

    // Check queue size
    if (this.queue.length >= this.options.maxQueueSize) {
      this.stats.rejectedDueToQueueFull++;
      const error = new Error('Command queue is full');
      this.emit('queue-full', { command, args, queueSize: this.queue.length });
      throw error;
    }

    return new Promise<CommandResult>((resolve, reject) => {
      const queuedCommand: QueuedCommand = {
        id,
        command,
        args,
        options,
        priority,
        timestamp: new Date(),
        resolve,
        reject,
      };

      // Set queue timeout
      if (this.options.queueTimeout > 0) {
        queuedCommand.timeout = setTimeout(() => {
          this.removeFromQueue(id);
          reject(new Error(`Command timed out in queue after ${this.options.queueTimeout}ms`));
        }, this.options.queueTimeout);
      }

      // Add to queue
      this.addToQueue(queuedCommand);
      
      // Try to process immediately
      this.processNext();
    });
  }

  /**
   * Add command to queue with priority
   */
  private addToQueue(command: QueuedCommand): void {
    // Insert based on priority (lower number = higher priority)
    const insertIndex = this.queue.findIndex(cmd => cmd.priority > command.priority);
    
    if (insertIndex === -1) {
      this.queue.push(command);
    } else {
      this.queue.splice(insertIndex, 0, command);
    }

    this.stats.queued = this.queue.length;
    
    logger.debug({
      module: 'command-pool',
      action: 'queue-add',
      id: command.id,
      command: command.command,
      priority: command.priority,
      queueLength: this.queue.length,
    }, 'Command added to queue');
  }

  /**
   * Remove command from queue
   */
  private removeFromQueue(id: string): boolean {
    const index = this.queue.findIndex(cmd => cmd.id === id);
    if (index !== -1) {
      const command = this.queue[index];
      if (command.timeout) {
        clearTimeout(command.timeout);
      }
      this.queue.splice(index, 1);
      this.stats.queued = this.queue.length;
      return true;
    }
    return false;
  }

  /**
   * Process next command in queue
   */
  private async processNext(): Promise<void> {
    // Check if we can process more commands
    if (this.activeCommands.size >= this.options.maxConcurrent || this.queue.length === 0) {
      return;
    }

    // Get next command from queue
    const command = this.queue.shift();
    if (!command) return;

    // Clear queue timeout
    if (command.timeout) {
      clearTimeout(command.timeout);
    }

    // Calculate wait time
    const waitTime = Date.now() - command.timestamp.getTime();
    this.waitTimes.push(waitTime);
    if (this.waitTimes.length > 100) this.waitTimes.shift();
    
    // Update stats
    this.stats.queued = this.queue.length;
    this.stats.active = this.activeCommands.size + 1;
    this.stats.averageWaitTime = this.calculateAverage(this.waitTimes);

    // Execute command
    const startTime = Date.now();
    
    try {
      logger.debug({
        module: 'command-pool',
        action: 'execute-start',
        id: command.id,
        command: command.command,
        waitTime,
      }, 'Executing command');

      const childProcess = execa(command.command, command.args, {
        ...command.options,
        reject: false,
      });

      this.activeCommands.set(command.id, childProcess);
      
      const result = await childProcess;
      
      const executionTime = Date.now() - startTime;
      this.executionTimes.push(executionTime);
      if (this.executionTimes.length > 100) this.executionTimes.shift();
      
      const commandResult: CommandResult = {
        stdout: typeof result.stdout === 'string' ? result.stdout : '',
        stderr: typeof result.stderr === 'string' ? result.stderr : '',
        exitCode: result.exitCode || 0,
        success: result.exitCode === 0,
        duration: executionTime,
      };

      // Update stats
      this.stats.completed++;
      this.stats.averageExecutionTime = this.calculateAverage(this.executionTimes);
      
      command.resolve(commandResult);
      
      this.emit('command-complete', {
        id: command.id,
        command: command.command,
        result: commandResult,
        waitTime,
        executionTime,
      });

    } catch (error) {
      this.stats.failed++;
      command.reject(error as Error);
      
      this.emit('command-error', {
        id: command.id,
        command: command.command,
        error,
      });
      
      logger.error({
        module: 'command-pool',
        action: 'execute-error',
        id: command.id,
        command: command.command,
        error,
      }, 'Command execution failed');
      
    } finally {
      this.activeCommands.delete(command.id);
      this.stats.active = this.activeCommands.size;
      
      // Process next command
      setImmediate(() => this.processNext());
    }
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(): boolean {
    const now = Date.now();
    const windowStart = now - this.options.rateLimit.windowMs;
    
    // Remove old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > windowStart);
    
    // Check if under limit
    if (this.requestTimestamps.length >= this.options.rateLimit.maxRequests) {
      return false;
    }
    
    // Add current timestamp
    this.requestTimestamps.push(now);
    return true;
  }

  /**
   * Generate unique command ID
   */
  private generateId(): string {
    return `cmd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate average of numbers
   */
  private calculateAverage(numbers: number[]): number {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    return { ...this.stats };
  }

  /**
   * Clear the queue
   */
  clearQueue(): void {
    for (const command of this.queue) {
      if (command.timeout) {
        clearTimeout(command.timeout);
      }
      command.reject(new Error('Queue cleared'));
    }
    this.queue.length = 0;
    this.stats.queued = 0;
    
    logger.info({
      module: 'command-pool',
      action: 'queue-cleared',
    }, 'Command queue cleared');
  }

  /**
   * Terminate all active commands
   */
  async terminateAll(): Promise<void> {
    const terminations = Array.from(this.activeCommands.values()).map(
      process => process.kill('SIGTERM')
    );
    
    await Promise.allSettled(terminations);
    this.activeCommands.clear();
    this.stats.active = 0;
    
    logger.info({
      module: 'command-pool',
      action: 'terminate-all',
      count: terminations.length,
    }, 'All active commands terminated');
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.clearQueue();
    await this.terminateAll();
    this.removeAllListeners();
    
    logger.info({
      module: 'command-pool',
      action: 'shutdown',
      stats: this.stats,
    }, 'Command pool shut down');
  }
}

// Export singleton instance
export const commandPool = new CommandPool();