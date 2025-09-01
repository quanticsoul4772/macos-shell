import { InputValidator, validators } from './input-validator';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock logger
jest.mock('./logger.js', () => ({
  getLogger: jest.fn(() => ({
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// Mock fs/promises
jest.mock('fs/promises');

describe('InputValidator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateCommand', () => {
    it('should validate valid commands', () => {
      const result = InputValidator.validateCommand('ls -la');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized).toBe('ls -la');
    });

    it('should reject empty commands', () => {
      const result = InputValidator.validateCommand('  ');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Command cannot be empty');
    });

    it('should reject commands with null bytes', () => {
      const result = InputValidator.validateCommand('ls\0-la');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Command contains null bytes');
    });

    it('should reject commands exceeding max length', () => {
      const longCommand = 'a'.repeat(32769);
      const result = InputValidator.validateCommand(longCommand);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Command exceeds maximum length of 32768 characters');
    });

    it('should warn about dangerous commands', () => {
      const result = InputValidator.validateCommand('rm -rf /');
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Command appears to perform dangerous system operations');
    });

    it('should trim whitespace from commands', () => {
      const result = InputValidator.validateCommand('  echo hello  ');
      
      expect(result.isValid).toBe(true);
      expect(result.sanitized).toBe('echo hello');
    });
  });

  describe('validateTimeout', () => {
    it('should validate valid timeouts', () => {
      const result = InputValidator.validateTimeout(5000);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized).toBe(5000);
    });

    it('should reject negative timeouts', () => {
      const result = InputValidator.validateTimeout(-100);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Timeout must be a positive integer');
    });

    it('should reject non-integer timeouts', () => {
      const result = InputValidator.validateTimeout(100.5);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Timeout must be a positive integer');
    });

    it('should reject timeouts exceeding max', () => {
      const result = InputValidator.validateTimeout(600001);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Timeout exceeds maximum of 600000ms (10 minutes)');
    });

    it('should warn about very short timeouts', () => {
      const result = InputValidator.validateTimeout(50);
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Timeout is very short (<100ms), command may not complete');
    });

    it('should clamp timeout values', () => {
      const result = InputValidator.validateTimeout(700000);
      
      expect(result.sanitized).toBe(600000);
    });
  });

  describe('validateSessionName', () => {
    it('should validate valid session names', () => {
      const result = InputValidator.validateSessionName('my-session_1.0');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized).toBe('my-session_1.0');
    });

    it('should reject empty session names', () => {
      const result = InputValidator.validateSessionName('  ');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Session name cannot be empty');
    });

    it('should reject session names exceeding max length', () => {
      const longName = 'a'.repeat(256);
      const result = InputValidator.validateSessionName(longName);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Session name exceeds maximum length of 255 characters');
    });

    it('should reject session names with invalid characters', () => {
      const result = InputValidator.validateSessionName('my session!@#');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Session name contains invalid characters (use only letters, numbers, _, -, .)');
    });

    it('should sanitize invalid characters', () => {
      const result = InputValidator.validateSessionName('my session!');
      
      expect(result.sanitized).toBe('my_session_');
    });
  });

  describe('validateEnvironment', () => {
    it('should validate valid environment variables', () => {
      const result = InputValidator.validateEnvironment({
        PATH: '/usr/bin',
        HOME: '/home/user',
      });
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized).toEqual({
        PATH: '/usr/bin',
        HOME: '/home/user',
      });
    });

    it('should reject invalid variable names', () => {
      const result = InputValidator.validateEnvironment({
        '123INVALID': 'value',
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid environment variable name: 123INVALID');
    });

    it('should reject variables with null bytes', () => {
      const result = InputValidator.validateEnvironment({
        VALID: 'value\0null',
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Environment variable VALID contains null bytes');
    });

    it('should warn about sensitive variables', () => {
      const result = InputValidator.validateEnvironment({
        API_KEY: 'secret',
        DB_PASSWORD: 'pass123',
      });
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toContain('Environment variable API_KEY may contain sensitive data');
      expect(result.warnings).toContain('Environment variable DB_PASSWORD may contain sensitive data');
    });

    it('should reject when total size exceeds limit', () => {
      const largeEnv: Record<string, string> = {};
      for (let i = 0; i < 1000; i++) {
        largeEnv[`VAR_${i}`] = 'x'.repeat(150);
      }
      
      const result = InputValidator.validateEnvironment(largeEnv);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Environment variables exceed maximum size of 131072 bytes');
    });
  });

  describe('validatePath', () => {
    it('should validate valid paths', async () => {
      const result = await InputValidator.validatePath('/home/user/file.txt');
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.sanitized).toBe(path.resolve('/home/user/file.txt'));
    });

    it('should reject paths with null bytes', async () => {
      const result = await InputValidator.validatePath('/home/user\0/file.txt');
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path contains null bytes');
    });

    it('should reject paths exceeding max length', async () => {
      const longPath = '/' + 'a'.repeat(4096);
      const result = await InputValidator.validatePath(longPath);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path exceeds maximum length of 4096 characters');
    });

    it('should warn about dangerous paths', async () => {
      const result = await InputValidator.validatePath('/etc/passwd');
      
      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('sensitive system directory');
    });

    it('should check path existence when required', async () => {
      const mockStat = fs.stat as jest.MockedFunction<typeof fs.stat>;
      mockStat.mockRejectedValueOnce(new Error('File not found'));
      
      const result = await InputValidator.validatePath('/nonexistent', { mustExist: true });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path does not exist: /nonexistent');
    });

    it('should check if path escapes base directory', async () => {
      const result = await InputValidator.validatePath('../../../etc/passwd', {
        basePath: '/home/user',
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path escapes base directory: /home/user');
    });

    it('should reject symbolic links when not allowed', async () => {
      const mockStat = fs.stat as jest.MockedFunction<typeof fs.stat>;
      mockStat.mockResolvedValueOnce({
        isSymbolicLink: () => true,
      } as any);
      
      const result = await InputValidator.validatePath('/some/link', {
        mustExist: true,
        allowSymlinks: false,
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Symbolic links are not allowed');
    });

    it('should check writability when required', async () => {
      const mockStat = fs.stat as jest.MockedFunction<typeof fs.stat>;
      const mockAccess = fs.access as jest.MockedFunction<typeof fs.access>;
      
      mockStat.mockResolvedValueOnce({
        isSymbolicLink: () => false,
      } as any);
      
      mockAccess.mockRejectedValueOnce(new Error('Not writable'));
      
      const result = await InputValidator.validatePath('/readonly/file', {
        mustExist: true,
        checkWritable: true,
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Path is not writable');
    });
  });

  describe('validateArrayBounds', () => {
    it('should validate arrays within bounds', () => {
      const result = InputValidator.validateArrayBounds([1, 2, 3], {
        minLength: 2,
        maxLength: 5,
      });
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject arrays below min length', () => {
      const result = InputValidator.validateArrayBounds([1], {
        minLength: 2,
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Array must contain at least 2 items');
    });

    it('should reject arrays above max length', () => {
      const result = InputValidator.validateArrayBounds([1, 2, 3, 4], {
        maxLength: 3,
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Array cannot contain more than 3 items');
    });

    it('should reject arrays with duplicate items when uniqueness required', () => {
      const result = InputValidator.validateArrayBounds([1, 2, 2, 3], {
        uniqueItems: true,
      });
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Array contains duplicate items');
    });

    it('should handle complex objects for uniqueness check', () => {
      const result = InputValidator.validateArrayBounds(
        [{ id: 1 }, { id: 2 }, { id: 1 }],
        { uniqueItems: true }
      );
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Array contains duplicate items');
    });
  });

  describe('batchValidate', () => {
    it('should aggregate results from multiple validations', async () => {
      const result = await InputValidator.batchValidate([
        () => InputValidator.validateCommand('ls -la'),
        () => InputValidator.validateTimeout(5000),
        () => InputValidator.validateSessionName('valid-session'),
      ]);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should fail if any validation fails', async () => {
      const result = await InputValidator.batchValidate([
        () => InputValidator.validateCommand('ls -la'),
        () => InputValidator.validateTimeout(-100), // This will fail
        () => InputValidator.validateSessionName('valid-session'),
      ]);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Timeout must be a positive integer');
    });

    it('should collect all errors and warnings', async () => {
      const result = await InputValidator.batchValidate([
        () => InputValidator.validateCommand('rm -rf /'), // Warning
        () => InputValidator.validateTimeout(50), // Warning
        () => InputValidator.validateSessionName(''), // Error
      ]);
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.warnings).toHaveLength(2);
    });
  });

  describe('validators convenience exports', () => {
    it('should export convenience methods', () => {
      expect(validators.path).toBe(InputValidator.validatePath);
      expect(validators.command).toBe(InputValidator.validateCommand);
      expect(validators.environment).toBe(InputValidator.validateEnvironment);
      expect(validators.timeout).toBe(InputValidator.validateTimeout);
      expect(validators.sessionName).toBe(InputValidator.validateSessionName);
      expect(validators.array).toBe(InputValidator.validateArrayBounds);
      expect(validators.batch).toBe(InputValidator.batchValidate);
    });
  });
});
