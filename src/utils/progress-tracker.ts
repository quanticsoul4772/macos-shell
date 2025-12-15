/**
 * Progress tracking utilities for SDK 1.18.0 features
 * Provides progress notifications and request ID correlation for shell operations
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getLogger } from './logger.js';

const logger = getLogger('ProgressTracker');

/**
 * Metadata structure from SDK 1.18.0
 */
export interface RequestMetadata {
  progressToken?: string | number;
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Context extracted from tool handler
 */
export interface ToolContext {
  progressToken?: string;
  requestId?: string;
  server?: McpServer;
}

/**
 * Progress tracker for shell operations
 */
export class ProgressTracker {
  private currentProgress = 0;
  private startTime = Date.now();
  private lastUpdateTime = 0;
  private updateThrottle = 100; // Minimum ms between updates

  constructor(
    private readonly server: McpServer | undefined,
    private readonly progressToken: string | undefined,
    private readonly requestId: string | undefined = undefined
  ) {
    if (this.progressToken && this.server) {
      logger.debug(`Progress tracker initialized for request ${requestId || 'unknown'}`);
    }
  }

  /**
   * Send a throttled progress update
   */
  async update(percentage: number, message: string): Promise<void> {
    this.currentProgress = Math.min(100, Math.max(0, percentage));

    // Throttle updates
    const now = Date.now();
    if (now - this.lastUpdateTime < this.updateThrottle && this.currentProgress < 100) {
      return;
    }
    this.lastUpdateTime = now;

    if (!this.server || !this.progressToken) {
      return;
    }

    try {
      // SDK 1.18.0 uses sendNotification for progress
      await (this.server as any).sendNotification('notifications/progress', {
        progressToken: this.progressToken,
        progress: this.currentProgress,
        total: 100,
        message
      });

      logger.debug(`Progress update: ${this.currentProgress}% - ${message}`);
    } catch (error) {
      logger.debug(`Failed to send progress notification: ${error}`);
    }
  }

  /**
   * Mark operation as complete
   */
  async complete(message: string = 'Operation completed'): Promise<void> {
    await this.update(100, message);
    const elapsed = Date.now() - this.startTime;
    logger.debug(`Operation completed in ${elapsed}ms`);
  }

  /**
   * Report an error
   */
  async error(message: string): Promise<void> {
    if (this.server && this.progressToken) {
      try {
        await (this.server as any).sendNotification('notifications/progress', {
          progressToken: this.progressToken,
          progress: this.currentProgress,
          total: 100,
          message: `Error: ${message}`,
          error: true
        });
      } catch (error) {
        logger.debug(`Failed to send error notification: ${error}`);
      }
    }
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedTime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Update progress based on lines processed
   */
  async updateForLines(current: number, total: number, operation: string): Promise<void> {
    if (total > 0) {
      const percentage = (current / total) * 100;
      await this.update(percentage, `${operation}: ${current}/${total} lines`);
    }
  }

  /**
   * Update progress for file operations
   */
  async updateForFiles(current: number, total: number, currentFile?: string): Promise<void> {
    if (total > 0) {
      const percentage = (current / total) * 100;
      const message = currentFile
        ? `Processing file ${current}/${total}: ${currentFile}`
        : `Processing ${current}/${total} files`;
      await this.update(percentage, message);
    }
  }
}

/**
 * Extract tool context from request
 */
export function extractToolContext(request: any, server?: McpServer): ToolContext {
  const meta = request?._meta as RequestMetadata | undefined;

  return {
    progressToken: meta?.progressToken ? String(meta.progressToken) : undefined,
    requestId: meta?.requestId,
    server
  };
}

/**
 * Progress reporter for shell command execution
 */
export class ShellProgressReporter {
  private outputLines = 0;
  private errorLines = 0;
  private lastProgress = 0;

  constructor(
    private readonly tracker: ProgressTracker,
    private readonly estimatedDuration: number = 5000 // Default 5 seconds
  ) {}

  /**
   * Report output line received
   */
  async reportOutputLine(line: string): Promise<void> {
    this.outputLines++;

    // Update progress based on time elapsed
    const elapsed = this.tracker.getElapsedTime();
    const progress = Math.min(90, (elapsed / this.estimatedDuration) * 90);

    if (progress - this.lastProgress > 5) { // Update every 5%
      this.lastProgress = progress;
      await this.tracker.update(progress, `Processing output... (${this.outputLines} lines)`);
    }
  }

  /**
   * Report error line received
   */
  async reportErrorLine(line: string): Promise<void> {
    this.errorLines++;

    if (this.errorLines === 1) {
      await this.tracker.update(this.lastProgress, `Warning: Error output detected`);
    }
  }

  /**
   * Report command start
   */
  async reportStart(command: string): Promise<void> {
    await this.tracker.update(0, `Starting command: ${command}`);
  }

  /**
   * Report command completion
   */
  async reportComplete(exitCode: number): Promise<void> {
    const message = exitCode === 0
      ? `Command completed successfully (${this.outputLines} lines output)`
      : `Command failed with exit code ${exitCode}`;
    await this.tracker.complete(message);
  }
}

/**
 * Progress stages for batch operations
 */
export enum BatchStage {
  INIT = 'Initializing batch operation',
  VALIDATION = 'Validating commands',
  EXECUTION = 'Executing commands',
  COLLECTING = 'Collecting results',
  COMPLETE = 'Batch operation complete'
}

/**
 * Progress reporter for batch operations
 */
export class BatchProgressReporter {
  private currentCommand = 0;
  private totalCommands = 0;

  constructor(
    private readonly tracker: ProgressTracker,
    totalCommands: number
  ) {
    this.totalCommands = totalCommands;
  }

  /**
   * Report batch stage
   */
  async reportStage(stage: BatchStage): Promise<void> {
    let progress = 0;
    switch (stage) {
      case BatchStage.INIT:
        progress = 0;
        break;
      case BatchStage.VALIDATION:
        progress = 10;
        break;
      case BatchStage.EXECUTION:
        progress = 20;
        break;
      case BatchStage.COLLECTING:
        progress = 90;
        break;
      case BatchStage.COMPLETE:
        progress = 100;
        break;
    }
    await this.tracker.update(progress, stage);
  }

  /**
   * Report command execution progress
   */
  async reportCommandProgress(commandIndex: number, command: string, status: 'starting' | 'completed' | 'failed'): Promise<void> {
    this.currentCommand = commandIndex + 1;
    const baseProgress = 20; // After validation
    const executionRange = 70; // 20-90% for execution
    const commandProgress = baseProgress + (this.currentCommand / this.totalCommands) * executionRange;

    let message = '';
    switch (status) {
      case 'starting':
        message = `Executing command ${this.currentCommand}/${this.totalCommands}: ${command}`;
        break;
      case 'completed':
        message = `Completed command ${this.currentCommand}/${this.totalCommands}`;
        break;
      case 'failed':
        message = `Failed command ${this.currentCommand}/${this.totalCommands}: ${command}`;
        break;
    }

    await this.tracker.update(commandProgress, message);
  }

  /**
   * Complete the batch operation
   */
  async complete(successCount: number, failureCount: number): Promise<void> {
    const message = `Batch complete: ${successCount} succeeded, ${failureCount} failed`;
    await this.tracker.complete(message);
  }
}