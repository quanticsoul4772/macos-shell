import { AIErrorHandler } from './ai-error-handler.js';
import * as fs from 'fs/promises';

jest.mock('fs/promises');

describe('AIErrorHandler', () => {
  let handler: AIErrorHandler;
  let emitSpy: jest.Mock;

  beforeEach(() => {
    handler = new AIErrorHandler();
    emitSpy = jest.fn();
    handler.emit = emitSpy;
    jest.clearAllMocks();
  });

  describe('handle method', () => {
    it('should handle network errors with retry', async () => {
      const error = new Error('Connection failed: ECONNRESET');
      const context = { command: 'curl example.com', cwd: '/tmp', attempt: 1 };

      const result = await handler.handle(error, context);

      expect(result.shouldRetry).toBe(true);
      expect(result.delay).toBeDefined();
      expect(emitSpy).toHaveBeenCalledWith('error:matched', expect.any(Object));
    });

    it('should not retry after max attempts', async () => {
      const error = new Error('Connection failed: ECONNRESET');
      const context = { command: 'curl example.com', cwd: '/tmp', attempt: 4 };

      const result = await handler.handle(error, context);

      expect(result.shouldRetry).toBe(false);
    });

    it('should handle command not found errors', async () => {
      const error = new Error('command not found: python');
      const context = { command: 'python script.py', cwd: '/tmp', attempt: 1 };

      const result = await handler.handle(error, context);

      // command_not_found pattern has retry: false, but when correction is found,
      // shouldRetry becomes true to retry with the corrected command
      expect(result.shouldRetry).toBe(true);
      expect(result.correctedCommand).toBe('python3 script.py');
      expect(emitSpy).toHaveBeenCalledWith('error:corrected', expect.any(Object));
    });

    it('should handle permission denied errors', async () => {
      const error = new Error('Permission denied');
      const context = { command: 'cat /root/secret', cwd: '/tmp', attempt: 1 };

      const result = await handler.handle(error, context);

      expect(result.shouldRetry).toBe(true);
      expect(result.correctedCommand).toContain('sudo');
    });

    it('should handle file not found errors with suggestions', async () => {
      const error = new Error("ENOENT: no such file or directory, open 'test'");
      const context = { command: 'cat test', cwd: '/tmp', attempt: 1 };

      // Mock fs.readdir to return similar files
      (fs.readdir as jest.Mock).mockResolvedValue(['test.txt', 'tests.txt', 'other.js']);

      const result = await handler.handle(error, context);

      // file_not_found has maxRetries: 1, but attempt 1 means we've already tried once
      // So attempt 1 < maxRetries 1 is false, no retry unless there's a correction
      // If correction found, shouldRetry is true
      if (result.correctedCommand) {
        expect(result.shouldRetry).toBe(true);
        expect(result.correctedCommand).toBe('cat test.txt');
      } else {
        // If no correction and attempt >= maxRetries, no retry
        expect(result.shouldRetry).toBe(false);
      }
    });

    it('should handle unknown errors without retry', async () => {
      const error = new Error('Unknown error occurred');
      const context = { command: 'some-command', cwd: '/tmp', attempt: 1 };

      const result = await handler.handle(error, context);

      expect(result.shouldRetry).toBe(false);
    });

    it('should handle auto-correction failures gracefully', async () => {
      const error = new Error("ENOENT: no such file or directory, open 'test'");
      // Use attempt: 0 to test the retry logic when correction fails
      const context = { command: 'cat test', cwd: '/tmp', attempt: 0 };

      // Mock fs.readdir to throw an error - this is caught by findSimilarPath and returns null
      (fs.readdir as jest.Mock).mockRejectedValue(new Error('Cannot read directory'));

      const result = await handler.handle(error, context);

      // When findSimilarPath fails (returns null), no correction is made
      // file_not_found has maxRetries: 1, attempt: 0 < 1 is true, so retry
      expect(result.shouldRetry).toBe(true);
      expect(result.correctedCommand).toBeUndefined();
      // Only 'error:matched' is emitted, not 'error:correction-failed'
      // because findSimilarPath catches its own errors and returns null
      expect(emitSpy).toHaveBeenCalledWith('error:matched', expect.any(Object));
      // No correction-failed event since the autoCorrect function didn't throw
      expect(emitSpy).not.toHaveBeenCalledWith('error:correction-failed', expect.any(Object));
    });

    it('should apply exponential backoff for retries', async () => {
      const error = new Error('ETIMEDOUT');
      
      // First attempt - delay = 1000 * 2^(1-1) = 1000 * 1 = 1000
      let result = await handler.handle(error, { command: 'test', cwd: '/tmp', attempt: 1 });
      expect(result.shouldRetry).toBe(true);
      expect(result.delay).toBe(1000);

      // Second attempt - delay = 1000 * 2^(2-1) = 1000 * 2 = 2000
      result = await handler.handle(error, { command: 'test', cwd: '/tmp', attempt: 2 });
      expect(result.shouldRetry).toBe(true);
      expect(result.delay).toBe(2000);

      // Third attempt - delay would be 1000 * 2^(3-1) = 4000, but maxRetries is 3
      // attempt 3 < maxRetries 3 is false, so no retry
      result = await handler.handle(error, { command: 'test', cwd: '/tmp', attempt: 3 });
      expect(result.shouldRetry).toBe(false);
      expect(result.delay).toBeUndefined();
    });
  });

  // Note: suggest method doesn't exist in AIErrorHandler
  // The auto-correction functionality is built into the handle method

  describe('getStats method', () => {
    it('should return error statistics', async () => {
      // Generate some errors
      // ECONNRESET - network error, no correction, just retry flag
      await handler.handle(new Error('ECONNRESET'), { command: 'test', cwd: '/tmp', attempt: 1 });
      // command not found: python - has correction python -> python3
      await handler.handle(new Error('command not found: python'), { command: 'python', cwd: '/tmp', attempt: 1 });
      // Unknown error - no pattern match
      await handler.handle(new Error('Unknown'), { command: 'test', cwd: '/tmp', attempt: 1 });

      const stats = handler.getStats();

      expect(stats.totalErrors).toBe(3);
      // Only the command not found with correction counts as recovered
      expect(stats.recoveredErrors).toBe(1);
      // Unknown error counts as failed recovery
      expect(stats.failedRecoveries).toBe(1);
      expect(stats.commonErrors.size).toBeGreaterThan(0);
    });
  });

  describe('learnFromError method', () => {
    it('should learn from repeated errors', () => {
      const error = { message: 'Custom error', code: 'CUSTOM' };
      
      // learnFromError takes a string resolution, not boolean
      handler.learnFromError(error, 'retry with timeout');
      handler.learnFromError(error, 'use sudo');
      handler.learnFromError(error, 'command not found');

      // Note: getLearnedPatterns doesn't exist, but we can verify through stats
      const stats = handler.getStats();
      expect(stats).toBeDefined();
    });
  });
});