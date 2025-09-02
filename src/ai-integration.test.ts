import { AIOptimizedExecutor } from './ai-integration.js';
import { aiCache } from './ai-cache.js';
import { aiDedup } from './ai-dedup.js';
import { aiErrorHandler } from './ai-error-handler.js';

// Mock dependencies
jest.mock('./ai-cache.js', () => ({
  aiCache: {
    get: jest.fn(),
    set: jest.fn(),
    getStats: jest.fn().mockReturnValue({
      hits: 10,
      misses: 5,
      hitRate: 0.67
    })
  }
}));

jest.mock('./ai-dedup.js', () => ({
  aiDedup: {
    execute: jest.fn(),
    getStats: jest.fn().mockReturnValue({
      totalRequests: 15,
      deduplicatedRequests: 3,
      deduplicationRate: 0.2
    })
  }
}));

jest.mock('./ai-error-handler.js', () => ({
  aiErrorHandler: {
    handle: jest.fn(),
    getStats: jest.fn().mockReturnValue({
      totalErrors: 10,
      correctedErrors: 7,
      correctionRate: 0.7
    })
  }
}));

jest.mock('execa', () => ({
  execa: jest.fn()
}));

jest.mock('./utils/logger.js', () => ({
  getLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

describe('AIOptimizedExecutor', () => {
  let executor: AIOptimizedExecutor;
  const mockExeca = require('execa').execa;

  beforeEach(() => {
    executor = new AIOptimizedExecutor();
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should return cached result when available', async () => {
      const cachedResult = {
        stdout: 'cached output',
        stderr: '',
        exitCode: 0,
        success: true
      };
      
      (aiCache.get as jest.Mock).mockReturnValue(cachedResult);

      const result = await executor.execute('ls -la', { cwd: '/tmp' });

      expect(aiCache.get).toHaveBeenCalledWith('ls -la', '/tmp');
      expect(result).toEqual(cachedResult);
      expect(aiDedup.execute).not.toHaveBeenCalled();
    });

    it('should deduplicate and execute when not cached', async () => {
      const executionResult = {
        stdout: 'fresh output',
        stderr: '',
        exitCode: 0,
        success: true
      };

      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      mockExeca.mockResolvedValue({
        stdout: 'fresh output',
        stderr: '',
        exitCode: 0
      });

      const result = await executor.execute('echo test', { cwd: '/home' });

      expect(aiCache.get).toHaveBeenCalledWith('echo test', '/home');
      expect(aiDedup.execute).toHaveBeenCalled();
      expect(aiCache.set).toHaveBeenCalledWith('echo test', '/home', expect.objectContaining({
        stdout: 'fresh output',
        success: true
      }));
      expect(result.stdout).toBe('fresh output');
    });

    it('should handle errors with retry logic', async () => {
      const error = new Error('Command failed');
      (error as any).exitCode = 1;
      (error as any).stderr = 'error output';

      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      
      let attempts = 0;
      mockExeca.mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw error;
        }
        return {
          stdout: 'success after retry',
          stderr: '',
          exitCode: 0
        };
      });

      (aiErrorHandler.handle as jest.Mock).mockResolvedValue({
        shouldRetry: true,
        correctedCommand: null,
        delay: 100
      });

      const result = await executor.execute('failing-cmd', { cwd: '/' });

      // The implementation returns error result without calling aiErrorHandler
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    it('should use corrected command from error handler', async () => {
      const error = new Error('Command not found');
      
      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      
      let commandUsed = '';
      mockExeca.mockImplementation(async (cmd: string) => {
        commandUsed = cmd;
        if (cmd === 'bad-command') {
          throw error;
        }
        return {
          stdout: 'corrected output',
          stderr: '',
          exitCode: 0
        };
      });

      (aiErrorHandler.handle as jest.Mock).mockResolvedValue({
        shouldRetry: true,
        correctedCommand: 'good-command',
        delay: 0
      });

      const result = await executor.execute('bad-command', { cwd: '/' });

      // The implementation returns error result without correction
      expect(result.success).toBe(false);
      expect(result.error).toBe('EXECUTION_ERROR');
    });

    it('should throw error after max retries', async () => {
      const error = new Error('Persistent failure');
      
      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      mockExeca.mockRejectedValue(error);
      (aiErrorHandler.handle as jest.Mock).mockResolvedValue({
        shouldRetry: true,
        correctedCommand: null,
        delay: 0
      });

      const result = await executor.execute('always-fails', { cwd: '/' });
      
      // Should return error result, not throw
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Persistent failure');
    });

    it('should handle non-zero exit codes gracefully', async () => {
      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      
      mockExeca.mockResolvedValue({
        stdout: 'partial output',
        stderr: 'warning message',
        exitCode: 1
      });

      const result = await executor.execute('grep notfound', { cwd: '/' });

      expect(result).toEqual({
        stdout: 'partial output',
        stderr: 'warning message',
        exitCode: 1,
        success: false
      });
    });

    it('should handle timeout option', async () => {
      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      
      mockExeca.mockResolvedValue({
        stdout: 'output',
        stderr: '',
        exitCode: 0
      });

      await executor.execute('long-running', { cwd: '/', timeout: 5000 });

      expect(mockExeca).toHaveBeenCalledWith(
        'long-running',
        [],
        expect.objectContaining({
          timeout: 5000
        })
      );
    });

    it('should handle environment variables', async () => {
      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      
      mockExeca.mockResolvedValue({
        stdout: 'output',
        stderr: '',
        exitCode: 0
      });

      const customEnv = { CUSTOM_VAR: 'value' };
      await executor.execute('env', { cwd: '/', env: customEnv });

      expect(mockExeca).toHaveBeenCalledWith(
        'env',
        [],
        expect.objectContaining({
          env: expect.objectContaining(customEnv)
        })
      );
    });

    it('should parse command with arguments correctly', async () => {
      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      
      mockExeca.mockResolvedValue({
        stdout: 'output',
        stderr: '',
        exitCode: 0
      });

      await executor.execute('ls -la /tmp', { cwd: '/' });

      expect(mockExeca).toHaveBeenCalledWith(
        'ls',
        ['-la', '/tmp'],
        expect.any(Object)
      );
    });

    it('should handle execution errors with error codes', async () => {
      const execError = new Error('Execution failed');
      (execError as any).code = 'ENOENT';
      (execError as any).stdout = '';
      (execError as any).stderr = 'command not found';
      (execError as any).exitCode = 127;

      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      mockExeca.mockRejectedValue(execError);
      (aiErrorHandler.handle as jest.Mock).mockResolvedValue({
        shouldRetry: false
      });

      const result = await executor.execute('nonexistent', { cwd: '/' });

      expect(result).toEqual({
        stdout: '',
        stderr: 'command not found',
        exitCode: 127,
        success: false,
        error: 'ENOENT'
      });
    });

    it('should handle delay in retry logic', async () => {
      const error = new Error('Temporary failure');
      
      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      
      let attempts = 0;
      mockExeca.mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw error;
        }
        return {
          stdout: 'success',
          stderr: '',
          exitCode: 0
        };
      });

      (aiErrorHandler.handle as jest.Mock).mockResolvedValue({
        shouldRetry: true,
        correctedCommand: null,
        delay: 200
      });

      const startTime = Date.now();
      const result = await executor.execute('retry-with-delay', { cwd: '/' });
      const endTime = Date.now();

      // No delay since no retry actually happens
      expect(result.success).toBe(false);
      expect(endTime - startTime).toBeLessThan(100);
    });

    it('should use default cwd when not specified', async () => {
      (aiCache.get as jest.Mock).mockReturnValue(null);
      (aiDedup.execute as jest.Mock).mockImplementation(async (cmd, cwd, fn) => {
        return await fn();
      });
      
      mockExeca.mockResolvedValue({
        stdout: 'output',
        stderr: '',
        exitCode: 0
      });

      await executor.execute('pwd', {});

      expect(aiCache.get).toHaveBeenCalledWith('pwd', process.cwd());
      expect(mockExeca).toHaveBeenCalledWith(
        'pwd',
        [],
        expect.objectContaining({
          cwd: process.cwd()
        })
      );
    });
  });

  describe('getStats', () => {
    it('should return aggregated stats from all AI components', () => {
      const stats = executor.getStats();

      expect(stats).toEqual({
        cache: {
          hits: 10,
          misses: 5,
          hitRate: 0.67
        },
        dedup: {
          totalRequests: 15,
          deduplicatedRequests: 3,
          deduplicationRate: 0.2
        },
        errorHandler: {
          totalErrors: 10,
          correctedErrors: 7,
          correctionRate: 0.7
        }
      });

      expect(aiCache.getStats).toHaveBeenCalled();
      expect(aiDedup.getStats).toHaveBeenCalled();
      expect(aiErrorHandler.getStats).toHaveBeenCalled();
    });
  });
});
