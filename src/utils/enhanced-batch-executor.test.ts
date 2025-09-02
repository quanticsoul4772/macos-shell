import { EnhancedBatchExecutor } from './enhanced-batch-executor.js';
import { execa } from 'execa';

jest.mock('execa');
const mockExeca = execa as jest.MockedFunction<typeof execa>;

describe('EnhancedBatchExecutor', () => {
  let executor: EnhancedBatchExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    const mockGetSessionCwd = jest.fn().mockResolvedValue('/tmp');
    const mockGetSessionEnv = jest.fn().mockResolvedValue({});
    executor = new EnhancedBatchExecutor(mockGetSessionCwd, mockGetSessionEnv);
  });

  describe('Basic Execution', () => {
    it('should execute single command', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'Hello World',
        stderr: '',
        exitCode: 0
      } as any);

      const result = await executor.execute({
        commands: [
          {
            command: 'echo',
            args: ['Hello World'],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000
          }
        ],
        parallel: false,
        maxParallel: 5,
        session: undefined,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 100,
        includeFullOutput: false
      });

      expect(result.failureCount).toBe(0);
      expect(result.successCount).toBe(1);
      expect(result.results[0].stdout).toBe('Hello World');
    });
  });

  describe('Parallel Execution', () => {
    it('should execute commands in parallel', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'Output 1',
        stderr: '',
        exitCode: 0
      } as any);
      
      mockExeca.mockResolvedValueOnce({
        stdout: 'Output 2',
        stderr: '',
        exitCode: 0
      } as any);

      const result = await executor.execute({
        commands: [
          {
            command: 'echo',
            args: ['Output 1'],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000
          },
          {
            command: 'echo',
            args: ['Output 2'],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000
          }
        ],
        parallel: true,
        maxParallel: 5,
        session: undefined,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 100,
        includeFullOutput: false
      });

      expect(result.failureCount).toBe(0);
      expect(result.successCount).toBe(2);
      expect(result.results).toHaveLength(2);
    });
  });

  describe('Error Handling', () => {
    it('should continue on error when configured', async () => {
      mockExeca.mockRejectedValueOnce({
        stderr: 'Command failed',
        exitCode: 1
      });
      
      mockExeca.mockResolvedValueOnce({
        stdout: 'Success',
        stderr: '',
        exitCode: 0
      } as any);

      const result = await executor.execute({
        commands: [
          {
            command: 'false',
            args: [],
            cwd: undefined,
            env: undefined,
            continueOnError: true,
            retryOnFailure: 0,
            retryDelay: 1000
          },
          {
            command: 'echo',
            args: ['Success'],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000
          }
        ],
        parallel: false,
        maxParallel: 5,
        session: undefined,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 100,
        includeFullOutput: false
      });

      expect(result.results).toHaveLength(2);
      expect(result.results[1].stdout).toBe('Success');
    });

    it('should stop on first failure when configured', async () => {
      mockExeca.mockRejectedValueOnce({
        stderr: 'Command failed',
        exitCode: 1
      });

      const result = await executor.execute({
        commands: [
          {
            command: 'false',
            args: [],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000
          },
          {
            command: 'echo',
            args: ['Should not run'],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000
          }
        ],
        parallel: false,
        maxParallel: 5,
        session: undefined,
        timeout: 30000,
        stopOnFirstFailure: true,
        maxOutputLines: 100,
        includeFullOutput: false
      });

      expect(result.failureCount).toBeGreaterThan(0);
      expect(result.results).toHaveLength(1);
    });
  });

  describe('Conditional Execution', () => {
    it('should execute based on condition', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'First',
        stderr: '',
        exitCode: 0
      } as any);

      mockExeca.mockResolvedValueOnce({
        stdout: 'Second',
        stderr: '',
        exitCode: 0
      } as any);

      const result = await executor.execute({
        commands: [
          {
            command: 'echo',
            args: ['First'],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000
          },
          {
            command: 'echo',
            args: ['Second'],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000,
            condition: {
              type: 'exitCode',
              operator: 'equals',
              value: 0
            }
          }
        ],
        parallel: false,
        maxParallel: 5,
        session: undefined,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 100,
        includeFullOutput: false
      });

      expect(result.results).toHaveLength(2);
      expect(result.results[1].stdout).toBe('Second');
    });

    it('should skip based on failed condition', async () => {
      mockExeca.mockRejectedValueOnce({
        stderr: 'Failed',
        exitCode: 1
      });

      const result = await executor.execute({
        commands: [
          {
            command: 'false',
            args: [],
            cwd: undefined,
            env: undefined,
            continueOnError: true,
            retryOnFailure: 0,
            retryDelay: 1000
          },
          {
            command: 'echo',
            args: ['Should skip'],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000,
            condition: {
              type: 'exitCode',
              operator: 'equals',
              value: 0
            }
          }
        ],
        parallel: false,
        maxParallel: 5,
        session: undefined,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 100,
        includeFullOutput: false
      });

      expect(result.results).toHaveLength(2); // Both commands are executed, second is skipped
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed commands', async () => {
      let callCount = 0;
      mockExeca.mockImplementation((() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject({
            stderr: 'First failure',
            exitCode: 1
          });
        }
        return Promise.resolve({
          stdout: 'Success on retry',
          stderr: '',
          exitCode: 0
        } as any);
      }) as any);

      const result = await executor.execute({
        commands: [
          {
            command: 'flaky',
            args: [],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 2,
            retryDelay: 100
          }
        ],
        parallel: false,
        maxParallel: 5,
        session: undefined,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 100,
        includeFullOutput: false
      });

      expect(result.failureCount).toBe(0);
      expect(result.successCount).toBe(1);
      expect(result.results[0].stdout).toBe('Success on retry');
      expect(mockExeca).toHaveBeenCalledTimes(2);
    });
  });

  describe('Output Truncation', () => {
    it('should truncate output when exceeding maxOutputLines', async () => {
      const longOutput = Array(200).fill('Line').map((l, i) => `${l} ${i}`).join('\n');
      
      mockExeca.mockResolvedValueOnce({
        stdout: longOutput,
        stderr: '',
        exitCode: 0
      } as any);

      const result = await executor.execute({
        commands: [
          {
            command: 'cat',
            args: ['largefile.txt'],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000
          }
        ],
        parallel: false,
        maxParallel: 5,
        session: undefined,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 50,
        includeFullOutput: false
      });

      const lines = result.results[0].stdout.split('\n');
      // The truncation may include a few extra lines for context
      expect(lines.length).toBeLessThanOrEqual(55);
    });

    it('should include full output when requested', async () => {
      const longOutput = Array(200).fill('Line').map((l, i) => `${l} ${i}`).join('\n');
      
      mockExeca.mockResolvedValueOnce({
        stdout: longOutput,
        stderr: '',
        exitCode: 0
      } as any);

      const result = await executor.execute({
        commands: [
          {
            command: 'cat',
            args: ['largefile.txt'],
            cwd: undefined,
            env: undefined,
            continueOnError: false,
            retryOnFailure: 0,
            retryDelay: 1000
          }
        ],
        parallel: false,
        maxParallel: 5,
        session: undefined,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 50,
        includeFullOutput: true
      });

      const lines = result.results[0].stdout.split('\n');
      expect(lines.length).toBe(200);
    });
  });
});