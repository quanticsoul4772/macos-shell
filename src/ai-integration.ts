/**
 * AI Integration Layer
 * Connects AI optimizations to existing command execution
 */

import { aiCache } from './ai-cache.js';
import { aiDedup } from './ai-dedup.js';
import { aiErrorHandler } from './ai-error-handler.js';
import { getLogger } from './utils/logger.js';

const logger = getLogger('ai-integration');

export class AIOptimizedExecutor {
  private isAIClient: boolean = true; // Always true for this server
  
  /**
   * Execute command with all AI optimizations
   */
  async execute(command: string, options: any): Promise<any> {
    const { cwd = process.cwd() } = options;
    
    // 1. Check cache first
    const cached = aiCache.get(command, cwd);
    if (cached) {
      logger.debug({ module: 'ai-integration', action: 'cache-hit', command }, `AI Cache hit for: ${command}`);
      return cached;
    }
    
    // 2. Deduplicate if needed
    return aiDedup.execute(command, cwd, async () => {
      let attempt = 1;
      let lastError: any;
      
      while (attempt <= 3) {
        try {
          // Execute the actual command
          const result = await this.executeRaw(command, options);
          
          // Cache successful result
          aiCache.set(command, cwd, result);
          
          return result;
        } catch (error) {
          lastError = error;
          
          // 3. Handle errors intelligently
          const { shouldRetry, correctedCommand, delay } = await aiErrorHandler.handle(
            error,
            { command, cwd, attempt }
          );
          
          if (shouldRetry) {
            if (correctedCommand) {
              command = correctedCommand;
              logger.info({ module: 'ai-integration', action: 'error-correction', correctedCommand }, `AI Error: Using corrected command: ${command}`);
            }
            
            if (delay && delay > 0) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            attempt++;
          } else {
            break;
          }
        }
      }
      
      throw lastError;
    });
  }
  
  /**
   * Raw command execution (implement based on existing code)
   */
  private async executeRaw(command: string, options: any): Promise<any> {
    // This should call the existing command execution logic
    // For now, returning a placeholder
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const result = await execAsync(command, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env },
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer for AI usage
    });
    
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  }
  
  /**
   * Get AI optimization statistics
   */
  getStats(): any {
    return {
      cache: aiCache.getStats(),
      dedup: aiDedup.getStats(),
      errorHandler: aiErrorHandler.getStats(),
    };
  }
}

export const aiExecutor = new AIOptimizedExecutor();
