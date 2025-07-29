import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * AI-Optimized Error Handler
 * Automatically recovers from common errors without human intervention
 */

interface ErrorPattern {
  pattern: RegExp;
  type: string;
  retry: boolean;
  maxRetries: number;
  delay: number;
  autoCorrect?: (error: any, context: any) => Promise<any>;
}

interface ErrorStats {
  totalErrors: number;
  recoveredErrors: number;
  failedRecoveries: number;
  commonErrors: Map<string, number>;
}

export class AIErrorHandler extends EventEmitter {
  private errorPatterns: ErrorPattern[] = [];
  private stats: ErrorStats = {
    totalErrors: 0,
    recoveredErrors: 0,
    failedRecoveries: 0,
    commonErrors: new Map(),
  };

  constructor() {
    super();
    this.setupErrorPatterns();
  }

  /**
   * Handle command error with AI intelligence
   */
  async handle(
    error: any, 
    context: { command: string; cwd: string; attempt: number }
  ): Promise<{ shouldRetry: boolean; correctedCommand?: string; delay?: number }> {
    this.stats.totalErrors++;
    
    const errorStr = error.toString();
    const errorType = this.classifyError(errorStr);
    this.stats.commonErrors.set(errorType, (this.stats.commonErrors.get(errorType) || 0) + 1);
    
    // Find matching error pattern
    for (const pattern of this.errorPatterns) {
      if (pattern.pattern.test(errorStr)) {
        this.emit('error:matched', { pattern: pattern.type, error: errorStr });
        
        // Auto-correct if available
        if (pattern.autoCorrect) {
          try {
            const correction = await pattern.autoCorrect(error, context);
            if (correction) {
              this.stats.recoveredErrors++;
              this.emit('error:corrected', { 
                original: context.command, 
                corrected: correction 
              });
              return { 
                shouldRetry: true, 
                correctedCommand: correction,
                delay: pattern.delay 
              };
            }
          } catch (e) {
            this.emit('error:correction-failed', { error: e });
          }
        }
        
        // Simple retry logic
        if (pattern.retry && context.attempt < pattern.maxRetries) {
          return { 
            shouldRetry: true, 
            delay: pattern.delay * Math.pow(2, context.attempt - 1) // Exponential backoff
          };
        }
      }
    }
    
    this.stats.failedRecoveries++;
    return { shouldRetry: false };
  }

  /**
   * Setup AI-specific error patterns
   */
  private setupErrorPatterns(): void {
    this.errorPatterns = [
      // Network errors - always retry
      {
        pattern: /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/,
        type: 'network',
        retry: true,
        maxRetries: 3,
        delay: 1000,
      },
      
      // File not found - try to auto-correct
      {
        pattern: /ENOENT.*no such file or directory/,
        type: 'file_not_found',
        retry: true,
        maxRetries: 1,
        delay: 0,
        autoCorrect: async (error, context) => {
          const match = error.message.match(/ENOENT.*'([^']+)'/);
          if (match) {
            const missingPath = match[1];
            const corrected = await this.findSimilarPath(missingPath, context.cwd);
            if (corrected) {
              return context.command.replace(missingPath, corrected);
            }
          }
          return null;
        },
      },
      
      // Permission denied - try with sudo
      {
        pattern: /EACCES|Permission denied/,
        type: 'permission',
        retry: true,
        maxRetries: 1,
        delay: 0,
        autoCorrect: async (error, context) => {
          if (!context.command.startsWith('sudo')) {
            return `sudo ${context.command}`;
          }
          return null;
        },
      },
      
      // Git errors
      {
        pattern: /not a git repository/,
        type: 'git_no_repo',
        retry: false,
        maxRetries: 0,
        delay: 0,
      },
      
      // NPM errors
      {
        pattern: /npm ERR!.*ERESOLVE/,
        type: 'npm_resolve',
        retry: true,
        maxRetries: 1,
        delay: 0,
        autoCorrect: async (error, context) => {
          if (context.command.includes('npm install')) {
            return context.command + ' --legacy-peer-deps';
          }
          return null;
        },
      },
      
      // Process already running
      {
        pattern: /EADDRINUSE|address already in use/,
        type: 'port_in_use',
        retry: false,
        maxRetries: 0,
        delay: 0,
        autoCorrect: async (error, context) => {
          const portMatch = error.message.match(/:(\d+)/);
          if (portMatch) {
            const port = portMatch[1];
            // Could kill the process or suggest alternative port
            this.emit('error:port-conflict', { port });
          }
          return null;
        },
      },
      
      // Command not found
      {
        pattern: /command not found|not recognized as/,
        type: 'command_not_found',
        retry: false,
        maxRetries: 0,
        delay: 0,
        autoCorrect: async (error, context) => {
          const cmd = context.command.split(' ')[0];
          const alternative = this.suggestAlternative(cmd);
          if (alternative) {
            return context.command.replace(cmd, alternative);
          }
          return null;
        },
      },
    ];
  }

  /**
   * Find similar file path (typo correction)
   */
  private async findSimilarPath(targetPath: string, cwd: string): Promise<string | null> {
    try {
      const dir = path.dirname(targetPath);
      const baseName = path.basename(targetPath);
      const absoluteDir = path.isAbsolute(dir) ? dir : path.join(cwd, dir);
      
      const files = await fs.readdir(absoluteDir);
      
      // Find similar filenames
      const similar = files
        .map(file => ({
          file,
          distance: this.levenshteinDistance(baseName.toLowerCase(), file.toLowerCase())
        }))
        .filter(item => item.distance <= 2) // Max 2 character difference
        .sort((a, b) => a.distance - b.distance);
      
      if (similar.length > 0) {
        const correctedPath = path.join(dir, similar[0].file);
        this.emit('error:path-suggestion', { 
          original: targetPath, 
          suggested: correctedPath 
        });
        return correctedPath;
      }
    } catch (e) {
      // Directory doesn't exist either
    }
    
    return null;
  }

  /**
   * Suggest alternative commands
   */
  private suggestAlternative(command: string): string | null {
    const alternatives: Record<string, string> = {
      'node': 'node',
      'python': 'python3',
      'pip': 'pip3',
      'code': 'cursor', // For AI development
      'yarn': 'npm',
      'pnpm': 'npm',
    };
    
    return alternatives[command] || null;
  }

  /**
   * Calculate Levenshtein distance for typo detection
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }

  /**
   * Classify error type
   */
  private classifyError(errorStr: string): string {
    for (const pattern of this.errorPatterns) {
      if (pattern.pattern.test(errorStr)) {
        return pattern.type;
      }
    }
    return 'unknown';
  }

  /**
   * Get error handling statistics
   */
  getStats(): any {
    const topErrors = Array.from(this.stats.commonErrors.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    return {
      ...this.stats,
      recoveryRate: this.stats.totalErrors > 0 
        ? (this.stats.recoveredErrors / this.stats.totalErrors) * 100 
        : 0,
      topErrors,
    };
  }

  /**
   * Learn from error patterns
   */
  learnFromError(error: any, resolution: string): void {
    // Could implement ML-based learning here
    this.emit('error:learned', { error: error.toString(), resolution });
  }
}

// Export singleton instance
export const aiErrorHandler = new AIErrorHandler();
