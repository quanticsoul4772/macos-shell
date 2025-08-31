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
   * Raw command execution using secure execa library
   */
  private async executeRaw(command: string, options: any): Promise<any> {
    // Import execa for secure command execution
    const { execa } = await import('execa');
    
    // Parse command and arguments safely
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    
    try {
      const result = await execa(cmd, args, {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for AI usage
        timeout: options.timeout || 30000,
        reject: false, // Don't throw on non-zero exit
        shell: false // Explicitly disable shell to prevent injection
      });
      
      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exitCode || 0,
        success: result.exitCode === 0
      };
    } catch (error: any) {
      // Handle execution errors
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.exitCode || -1,
        success: false,
        error: error.code || 'EXECUTION_ERROR'
      };
    }
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
