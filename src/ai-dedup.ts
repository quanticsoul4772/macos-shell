import { EventEmitter } from 'events';
import { createHash } from 'crypto';

/**
 * AI-Optimized Command Deduplication
 * Prevents redundant command execution when AI runs same commands rapidly
 */

interface PendingCommand {
  command: string;
  cwd: string;
  promise: Promise<any>;
  timestamp: number;
  waitingCount: number;
}

interface DedupStats {
  totalCommands: number;
  dedupedCommands: number;
  savedExecutions: number;
  avgWaitTime: number;
}

export class AICommandDedup extends EventEmitter {
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private stats: DedupStats = {
    totalCommands: 0,
    dedupedCommands: 0,
    savedExecutions: 0,
    avgWaitTime: 0,
  };

  // AI-specific deduplication settings
  private readonly DEDUP_WINDOW_MS = 10000; // 10 seconds
  private readonly BATCH_WAIT_MS = 100; // Wait 100ms to batch commands
  
  // Commands that benefit most from deduplication
  private readonly HIGH_DEDUP_COMMANDS = [
    'ls', 'pwd', 'git status', 'git branch', 'npm list',
    'cat package.json', 'cat README.md', 'whoami', 'date'
  ];

  constructor() {
    super();
    this.setupCleanup();
  }

  /**
   * Execute command with deduplication
   */
  async execute(
    command: string, 
    cwd: string, 
    executor: () => Promise<any>
  ): Promise<any> {
    this.stats.totalCommands++;
    
    const key = this.generateKey(command, cwd);
    const existing = this.pendingCommands.get(key);
    
    // Check if identical command is already running or recently completed
    if (existing && this.isWithinWindow(existing.timestamp)) {
      this.stats.dedupedCommands++;
      this.stats.savedExecutions++;
      existing.waitingCount++;
      
      this.emit('dedup:hit', {
        command,
        cwd,
        waitingCount: existing.waitingCount,
        timeSaved: Date.now() - existing.timestamp
      });
      
      return existing.promise;
    }
    
    // For high-dedup commands, wait briefly to batch
    if (this.shouldBatch(command)) {
      await this.waitForBatch();
      
      // Check again after waiting
      const afterWait = this.pendingCommands.get(key);
      if (afterWait && this.isWithinWindow(afterWait.timestamp)) {
        this.stats.savedExecutions++;
        return afterWait.promise;
      }
    }
    
    // Execute the command
    const pendingCommand: PendingCommand = {
      command,
      cwd,
      promise: executor(),
      timestamp: Date.now(),
      waitingCount: 0,
    };
    
    this.pendingCommands.set(key, pendingCommand);
    
    // Clean up after completion
    pendingCommand.promise
      .finally(() => {
        // Keep in map for dedup window
        setTimeout(() => {
          this.pendingCommands.delete(key);
        }, this.DEDUP_WINDOW_MS);
      });
    
    return pendingCommand.promise;
  }

  /**
   * Check if command should be batched
   */
  private shouldBatch(command: string): boolean {
    const baseCommand = command.split(' ')[0];
    return this.HIGH_DEDUP_COMMANDS.some(cmd => 
      command === cmd || baseCommand === cmd
    );
  }

  /**
   * Wait briefly to allow batching
   */
  private async waitForBatch(): Promise<void> {
    return new Promise(resolve => 
      setTimeout(resolve, this.BATCH_WAIT_MS)
    );
  }

  /**
   * Check if timestamp is within deduplication window
   */
  private isWithinWindow(timestamp: number): boolean {
    return Date.now() - timestamp < this.DEDUP_WINDOW_MS;
  }

  /**
   * Generate deduplication key
   */
  private generateKey(command: string, cwd: string): string {
    // Normalize command for better deduplication
    const normalized = this.normalizeCommand(command);
    return createHash('md5')
      .update(`${cwd}:${normalized}`)
      .digest('hex');
  }

  /**
   * Normalize command for deduplication
   */
  private normalizeCommand(command: string): string {
    // Remove extra whitespace
    let normalized = command.trim().replace(/\s+/g, ' ');
    
    // Normalize common variations
    const normalizations = [
      { pattern: /ls\s+-la/, replacement: 'ls -la' },
      { pattern: /ls\s+-al/, replacement: 'ls -la' },
      { pattern: /git\s+log\s+--oneline\s+-\d+/, replacement: 'git log --oneline' },
    ];
    
    for (const { pattern, replacement } of normalizations) {
      normalized = normalized.replace(pattern, replacement);
    }
    
    return normalized;
  }

  /**
   * Setup periodic cleanup
   */
  private cleanupTimer?: NodeJS.Timeout;

  private setupCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, pending] of this.pendingCommands.entries()) {
        if (now - pending.timestamp > this.DEDUP_WINDOW_MS * 2) {
          this.pendingCommands.delete(key);
        }
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Dispose the deduplicator and clean up resources
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.pendingCommands.clear();
    this.removeAllListeners();
  }

  /**
   * Get deduplication statistics
   */
  getStats(): any {
    return {
      ...this.stats,
      dedupRate: this.stats.totalCommands > 0 
        ? (this.stats.dedupedCommands / this.stats.totalCommands) * 100 
        : 0,
      currentPending: this.pendingCommands.size,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalCommands: 0,
      dedupedCommands: 0,
      savedExecutions: 0,
      avgWaitTime: 0,
    };
  }

  /**
   * Advanced: Coalesce multiple related commands
   */
  async coalesceCommands(
    commands: Array<{ command: string; cwd: string }>,
    executor: (cmds: string[]) => Promise<any>
  ): Promise<any[]> {
    // Group similar commands
    const groups = new Map<string, typeof commands>();
    
    for (const cmd of commands) {
      const base = cmd.command.split(' ')[0];
      if (!groups.has(base)) {
        groups.set(base, []);
      }
      groups.get(base)!.push(cmd);
    }
    
    // Execute grouped commands
    const results: any[] = [];
    
    for (const [base, cmds] of groups.entries()) {
      if (cmds.length > 1 && this.canCoalesce(base)) {
        // Execute as batch
        const batchResult = await executor(cmds.map(c => c.command));
        results.push(...batchResult);
        
        this.stats.savedExecutions += cmds.length - 1;
        this.emit('coalesce:batch', { base, count: cmds.length });
      } else {
        // Execute individually
        for (const cmd of cmds) {
          const result = await this.execute(
            cmd.command, 
            cmd.cwd, 
            () => executor([cmd.command])
          );
          results.push(result[0]);
        }
      }
    }
    
    return results;
  }

  /**
   * Check if command type can be coalesced
   */
  private canCoalesce(baseCommand: string): boolean {
    const coalesceable = ['ls', 'cat', 'head', 'tail', 'wc', 'file'];
    return coalesceable.includes(baseCommand);
  }
}

// Export singleton instance
export const aiDedup = new AICommandDedup();
