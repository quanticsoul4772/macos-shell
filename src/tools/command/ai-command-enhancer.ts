// AI Command Enhancer Module
// Integrates AI cache, deduplication, and error handling

import { CommandExecutor, CommandResult, ExecuteOptions } from './command-executor.js';
import { aiCache } from '../../ai-cache.js';
import { aiDedup } from '../../ai-dedup.js';
import { aiErrorHandler } from '../../ai-error-handler.js';
import { duplicateDetector } from '../../duplicate-detector.js';
import { learningPersistence } from '../../learning-persistence.js';
import { cacheClassifier, CacheStrategy } from '../../ai-cache-classifier.js';
import { outputAnalyzer } from '../../output-analyzer.js';
import logger from '../../utils/logger.js';

export class AICommandEnhancer {
  private cacheEnabled: boolean;
  private readonly MAX_SINGLE_LINE_LENGTH = 10000; // Same as CommandExecutor

  constructor(private executor: CommandExecutor) {
    // Allow disabling cache via environment variable
    this.cacheEnabled = process.env.MCP_DISABLE_CACHE !== 'true';
    
    if (!this.cacheEnabled) {
      logger.info({ 
        module: 'ai-command-enhancer', 
        action: 'init' 
      }, 'AI Command cache disabled via MCP_DISABLE_CACHE=true');
    }
    
    // Listen for duplicate detection
    duplicateDetector.on('duplicate-detected', async (event) => {
      // Auto-mark as never cache
      cacheClassifier.addRule({
        pattern: event.command,
        strategy: CacheStrategy.NEVER,
        reason: `Auto-detected: ${event.duplicateCount} duplicate results within ${event.timeSpan}ms`
      }, 'high');
      
      // Save to persistent storage
      await learningPersistence.saveRule({
        pattern: event.command,
        isRegex: false,
        strategy: CacheStrategy.NEVER,
        reason: `Auto-detected duplicate results`,
        timestamp: new Date().toISOString(),
        source: 'auto-detect'
      });
      
      logger.info({
        module: 'ai-command-enhancer',
        action: 'auto-never-cache',
        command: event.command
      }, `Automatically marked command as never-cache: ${event.command}`);
    });
  }

  /**
   * Detects if output appears to be binary data
   */
  private isBinaryOutput(data: string): boolean {
    const nullBytes = (data.match(/\x00/g) || []).length;
    const nonPrintable = (data.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g) || []).length;
    const totalChars = Math.min(data.length, 1000);
    return nullBytes > 0 || (nonPrintable / totalChars) > 0.3;
  }

  /**
   * Truncates output - same logic as CommandExecutor
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
    
    const headLines = Math.ceil(maxLines * 0.6);
    const tailLines = Math.floor(maxLines * 0.4);
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
        returnedLines: maxLines + 1,
        returnedBytes: truncatedOutput.length
      }
    };
  }

  async executeWithAI(options: ExecuteOptions): Promise<CommandResult> {
    const { command, args, cwd, sessionId, maxOutputLines, maxErrorLines } = options;
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
        const stdoutResult = this.truncateOutput(cached.stdout || '', maxOutputLines || 100);
        const stderrResult = this.truncateOutput(cached.stderr || '', maxErrorLines || 50);
        
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

        // Record cached result in history through executor
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

    // Execute with deduplication and error handling
    const result = await aiDedup.execute(fullCommand, cwd, async () => {
      return this.executeWithRetry(options);
    });

    // Cache successful result (if caching enabled)
    if (this.cacheEnabled && result.success) {
      aiCache.set(fullCommand, cwd, {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      });
    }
    
    // Check for duplicates only on fresh executions
    if (!result.cached && result.success) {
      const isDuplicate = duplicateDetector.checkDuplicate(
        fullCommand,
        cwd,
        result
      );
      
      // If duplicate detected, clear this command from cache
      if (isDuplicate) {
        aiCache.clearCommand(fullCommand, cwd);
      }
      
      // Analyze output for dynamic content
      const analysis = outputAnalyzer.analyze(result.stdout);
      
      if (analysis.confidence > 0.8 && 
          analysis.suggestedStrategy === CacheStrategy.NEVER) {
        // High confidence that this should not be cached
        logger.info({
          module: 'ai-command-enhancer',
          action: 'output-analysis',
          command: fullCommand,
          analysis
        }, `Output analysis suggests never-cache for: ${fullCommand}`);
        
        // Add rule but don't save automatically - let duplicate detection confirm
        cacheClassifier.addRule({
          pattern: fullCommand,
          strategy: CacheStrategy.NEVER,
          reason: `Output analysis detected: ${analysis.changeIndicators.join(', ')}`
        }, 'low'); // Low priority - can be overridden
      }
    }

    return result;
  }

  /**
   * Execute command without any AI enhancements (bypass cache, dedup, etc.)
   */
  async executeRaw(options: ExecuteOptions): Promise<CommandResult> {
    return this.executor.execute(options);
  }

  /**
   * Get cache explanation for a command
   */
  explainCache(command: string): string {
    return aiCache.explainCacheDecision(command);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    aiCache.clear();
    logger.info({ 
      module: 'ai-command-enhancer', 
      action: 'cache-clear' 
    }, 'AI Command cache cleared');
  }

  /**
   * Toggle cache on/off at runtime
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    logger.info({ 
      module: 'ai-command-enhancer', 
      action: 'cache-toggle',
      enabled
    }, `AI Command cache ${enabled ? 'enabled' : 'disabled'}`);
  }

  private async executeWithRetry(options: ExecuteOptions): Promise<CommandResult> {
    let attemptCount = 1;
    let lastError: any;
    let currentOptions = { ...options };

    while (attemptCount <= 3) {
      try {
        const result = await this.executor.execute(currentOptions);
        
        if (result.success || !result.error) {
          return result;
        }

        // If command failed but didn't throw, treat as error
        throw new Error(result.stderr || `Command failed with exit code ${result.exitCode}`);
      } catch (error: any) {
        lastError = error;

        // Let AI error handler try to fix it
        const errorResult = await aiErrorHandler.handle(error, {
          command: `${currentOptions.command} ${currentOptions.args.join(' ')}`.trim(),
          cwd: currentOptions.cwd,
          attempt: attemptCount
        });

        if (errorResult.shouldRetry) {
          if (errorResult.correctedCommand) {
            // Parse corrected command
            const parts = errorResult.correctedCommand.split(' ');
            currentOptions = {
              ...currentOptions,
              command: parts[0],
              args: parts.slice(1)
            };
            
            logger.info({ 
              module: 'ai-command-enhancer', 
              action: 'error-retry', 
              correctedCommand: errorResult.correctedCommand 
            }, `AI Error: Retrying with corrected command: ${errorResult.correctedCommand}`);
          }

          if (errorResult.delay) {
            await new Promise(resolve => setTimeout(resolve, errorResult.delay));
          }

          attemptCount++;
        } else {
          // Return error result instead of throwing
          return {
            stdout: '',
            stderr: error.message || 'Unknown error',
            exitCode: -1,
            success: false,
            duration: 0,
            command: `${currentOptions.command} ${currentOptions.args.join(' ')}`.trim(),
            error: error.code || 'UNKNOWN'
          };
        }
      }
    }

    // Return last error result
    return {
      stdout: '',
      stderr: lastError?.message || 'Max retry attempts exceeded',
      exitCode: -1,
      success: false,
      duration: 0,
      command: `${currentOptions.command} ${currentOptions.args.join(' ')}`.trim(),
      error: 'MAX_RETRIES_EXCEEDED'
    };
  }
}
