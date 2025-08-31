/**
 * Tests for Enhanced Error Handler
 */

import { ErrorHandler } from './error-handler.js';
import { 
  CommandErrorCode, 
  EnhancedError,
  ExecutionError 
} from '../types/command.types.js';

describe('ErrorHandler', () => {
  describe('enhanceError', () => {
    it('should identify command not found errors', () => {
      const error: ExecutionError = {
        name: 'ExecutionError',
        message: 'Command failed',
        exitCode: 127,
        stderr: 'command not found: foo',
      };

      const enhanced = ErrorHandler.enhanceError(error);
      
      expect(enhanced.errorCode).toBe(CommandErrorCode.COMMAND_NOT_FOUND);
      expect(enhanced.recoverable).toBe(false);
      expect(enhanced.suggestion).toContain('not found');
    });

    it('should identify permission denied errors', () => {
      const error: ExecutionError = {
        name: 'ExecutionError',
        message: 'Permission denied',
        exitCode: 126,
      };

      const enhanced = ErrorHandler.enhanceError(error);
      
      expect(enhanced.errorCode).toBe(CommandErrorCode.PERMISSION_DENIED);
      expect(enhanced.suggestion).toContain('Permission denied');
    });

    it('should identify timeout errors', () => {
      const error: ExecutionError = {
        name: 'ExecutionError',
        message: 'Command timed out',
        timedOut: true,
      };

      const enhanced = ErrorHandler.enhanceError(error);
      
      expect(enhanced.errorCode).toBe(CommandErrorCode.TIMEOUT);
      expect(enhanced.recoverable).toBe(true);
    });

    it('should identify network errors', () => {
      const error: ExecutionError = {
        name: 'ExecutionError',
        message: 'Connection refused',
        stderr: 'Could not resolve host',
      };

      const enhanced = ErrorHandler.enhanceError(error);
      
      expect(enhanced.errorCode).toBe(CommandErrorCode.NETWORK_ERROR);
      expect(enhanced.recoverable).toBe(true);
    });

    it('should handle unknown errors gracefully', () => {
      const error = new Error('Something went wrong');
      
      const enhanced = ErrorHandler.enhanceError(error);
      
      expect(enhanced.errorCode).toBe(CommandErrorCode.UNKNOWN);
      expect(enhanced.message).toBe('Something went wrong');
    });

    it('should preserve context when provided', () => {
      const error = new Error('Test error');
      const context = {
        sessionId: 'test-session',
        cwd: '/test/dir',
        env: { TEST: 'true' },
        startTime: new Date(),
      };

      const enhanced = ErrorHandler.enhanceError(error, context);
      
      expect(enhanced.context).toEqual(context);
    });
  });

  describe('getRecoveryStrategy', () => {
    it('should suggest python3 for python command not found', () => {
      const error: EnhancedError = {
        name: 'ExecutionError',
        message: 'Command not found',
        errorCode: CommandErrorCode.COMMAND_NOT_FOUND,
        command: 'python script.py',
      };

      const strategy = ErrorHandler.getRecoveryStrategy(
        CommandErrorCode.COMMAND_NOT_FOUND,
        error
      );
      
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.correctedCommand).toBe('python3 script.py');
      expect(strategy.suggestion).toContain('python3');
    });

    it('should suggest sudo for permission denied', () => {
      const error: EnhancedError = {
        name: 'ExecutionError',
        message: 'Permission denied',
        errorCode: CommandErrorCode.PERMISSION_DENIED,
        command: 'apt update',
      };

      const strategy = ErrorHandler.getRecoveryStrategy(
        CommandErrorCode.PERMISSION_DENIED,
        error
      );
      
      expect(strategy.shouldRetry).toBe(false); // Don't auto-retry with sudo
      expect(strategy.suggestion).toContain('sudo');
    });

    it('should increase timeout for timeout errors', () => {
      const error: EnhancedError = {
        name: 'ExecutionError',
        message: 'Timeout',
        errorCode: CommandErrorCode.TIMEOUT,
        context: {
          sessionId: 'test',
          cwd: '/test',
          env: {},
          startTime: new Date(),
          maxAttempts: 30000,
        },
      };

      const strategy = ErrorHandler.getRecoveryStrategy(
        CommandErrorCode.TIMEOUT,
        error
      );
      
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delay).toBe(1000);
      expect(strategy.suggestion).toContain('60000ms');
    });

    it('should use exponential backoff for network errors', () => {
      const error: EnhancedError = {
        name: 'ExecutionError',
        message: 'Network error',
        errorCode: CommandErrorCode.NETWORK_ERROR,
        context: {
          sessionId: 'test',
          cwd: '/test',
          env: {},
          startTime: new Date(),
          attempt: 2,
        },
      };

      const strategy = ErrorHandler.getRecoveryStrategy(
        CommandErrorCode.NETWORK_ERROR,
        error
      );
      
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delay).toBe(2000); // 1000 * 2^(2-1)
      expect(strategy.maxRetries).toBe(3);
    });

    it('should handle resource limit errors', () => {
      const error: EnhancedError = {
        name: 'ExecutionError',
        message: 'Resource limit',
        errorCode: CommandErrorCode.RESOURCE_LIMIT,
      };

      const strategy = ErrorHandler.getRecoveryStrategy(
        CommandErrorCode.RESOURCE_LIMIT,
        error
      );
      
      expect(strategy.shouldRetry).toBe(true);
      expect(strategy.delay).toBe(5000);
      expect(strategy.maxRetries).toBe(2);
    });
  });

  describe('formatError', () => {
    it('should format error with all details', () => {
      const error: EnhancedError = {
        name: 'ExecutionError',
        message: 'Command failed',
        errorCode: CommandErrorCode.COMMAND_NOT_FOUND,
        exitCode: 127,
        command: 'foo --bar',
        stderr: 'foo: command not found',
        suggestion: 'Check if foo is installed',
      };

      const formatted = ErrorHandler.formatError(error);
      
      expect(formatted).toContain('Error: Command failed');
      expect(formatted).toContain('Type: COMMAND_NOT_FOUND');
      expect(formatted).toContain('Exit Code: 127');
      expect(formatted).toContain('Command: foo --bar');
      expect(formatted).toContain('Suggestion: Check if foo is installed');
      expect(formatted).toContain('Details: foo: command not found');
    });

    it('should handle minimal error information', () => {
      const error: EnhancedError = {
        name: 'ExecutionError',
        message: 'Unknown error',
        errorCode: CommandErrorCode.UNKNOWN,
      };

      const formatted = ErrorHandler.formatError(error);
      
      expect(formatted).toBe('Error: Unknown error');
    });
  });

  describe('sanitizeError', () => {
    it('should sanitize error for external consumption', () => {
      const error: EnhancedError = {
        name: 'ExecutionError',
        message: 'Command failed',
        errorCode: CommandErrorCode.PERMISSION_DENIED,
        exitCode: 126,
        command: '/usr/local/bin/secret-tool --password=secret123',
        stderr: 'Permission denied: /etc/sensitive/file',
        suggestion: 'Use sudo',
        recoverable: false,
      };

      const sanitized = ErrorHandler.sanitizeError(error);
      
      expect(sanitized.error).toBe(true);
      expect(sanitized.code).toBe(CommandErrorCode.PERMISSION_DENIED);
      expect(sanitized.message).toBe('Command failed');
      expect(sanitized.suggestion).toBe('Use sudo');
      expect(sanitized.recoverable).toBe(false);
      expect(sanitized.exitCode).toBe(126);
      expect(sanitized.command).toBe('/usr/local/bin/secret-tool'); // Only command name
      expect(sanitized).not.toHaveProperty('stderr'); // Sensitive paths removed
    });

    it('should handle errors without sensitive data', () => {
      const error: EnhancedError = {
        name: 'ExecutionError',
        message: 'Timeout',
        errorCode: CommandErrorCode.TIMEOUT,
        command: 'ls -la',
        recoverable: true,
      };

      const sanitized = ErrorHandler.sanitizeError(error);
      
      expect(sanitized.command).toBe('ls');
      expect(sanitized.recoverable).toBe(true);
    });
  });
});