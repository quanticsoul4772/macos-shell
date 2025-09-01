// Batch Executor Test Suite
// Tests sequential and parallel batch command execution

import { BatchExecutor, BatchCommand, BatchExecutionResult } from './batch-executor';
import { execa, ExecaError } from 'execa';
import { v4 as uuidv4 } from 'uuid';

// Mock dependencies
jest.mock('execa');
jest.mock('uuid');
jest.mock('./logger', () => ({
  getLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }))
}));

describe('BatchExecutor', () => {
  let executor: BatchExecutor;
  let mockGetSessionCwd: jest.Mock;
  let mockGetSessionEnv: jest.Mock;
  const mockExeca = execa as jest.MockedFunction<typeof execa>;
  const mockUuidv4 = uuidv4 as jest.MockedFunction<typeof uuidv4>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup UUID mock
    let uuidCounter = 0;
    mockUuidv4.mockImplementation((() => `batch-${++uuidCounter}`) as any);
    
    // Setup session mocks
    mockGetSessionCwd = jest.fn().mockResolvedValue('/default/cwd');
    mockGetSessionEnv = jest.fn().mockResolvedValue({ DEFAULT_ENV: 'value' });
    
    // Create executor instance
    executor = new BatchExecutor(mockGetSessionCwd, mockGetSessionEnv);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Sequential Execution', () => {
    it('should execute commands sequentially in order', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'echo', args: ['hello'], continueOnError: false },
        { command: 'ls', args: ['-la'], continueOnError: false },
        { command: 'pwd', args: [], continueOnError: false }
      ];
      
      // Track execution order
      const executionOrder: string[] = [];
      mockExeca.mockImplementation(((cmd: any) => {
        executionOrder.push(cmd as string);
        return Promise.resolve({
          stdout: `output from ${cmd}`,
          stderr: '',
          exitCode: 0,
          failed: false
        });
      }) as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(result.results).toHaveLength(3);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.parallel).toBe(false);
      expect(executionOrder).toEqual(['echo', 'ls', 'pwd']);
      
      // Verify each result
      result.results.forEach((res, index) => {
        expect(res.success).toBe(true);
        expect(res.exitCode).toBe(0);
        expect(res.stdout).toContain(commands[index].command);
      });
    });

    it('should stop on error when continueOnError is false', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'echo', args: ['hello'], continueOnError: false },
        { command: 'bad-command', args: [], continueOnError: false },
        { command: 'pwd', args: [], continueOnError: false }
      ];
      
      mockExeca
        .mockResolvedValueOnce({
          stdout: 'hello',
          stderr: '',
          exitCode: 0,
          failed: false
        } as any)
        .mockRejectedValueOnce({
          message: 'Command failed',
          exitCode: 127,
          stdout: '',
          stderr: 'command not found',
          failed: true
        } as ExecaError);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(result.results).toHaveLength(2); // Should stop after failure
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[1].error).toContain('Command failed');
      expect(mockExeca).toHaveBeenCalledTimes(2); // Third command not executed
    });

    it('should continue on error when continueOnError is true', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'echo', args: ['hello'], continueOnError: false },
        { command: 'bad-command', args: [], continueOnError: true }, // Continue on error
        { command: 'pwd', args: [], continueOnError: false }
      ];
      
      mockExeca
        .mockResolvedValueOnce({
          stdout: 'hello',
          stderr: '',
          exitCode: 0,
          failed: false
        } as any)
        .mockRejectedValueOnce({
          message: 'Command failed',
          exitCode: 127,
          stdout: '',
          stderr: 'command not found',
          failed: true
        } as ExecaError)
        .mockResolvedValueOnce({
          stdout: '/current/dir',
          stderr: '',
          exitCode: 0,
          failed: false
        } as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(result.results).toHaveLength(3); // All commands executed
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[2].success).toBe(true);
      expect(mockExeca).toHaveBeenCalledTimes(3);
    });

    it('should use custom cwd and env per command', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { 
          command: 'echo', 
          args: ['test'],
          cwd: '/custom/path',
          env: { CUSTOM_VAR: 'custom_value' },
          continueOnError: false 
        }
      ];
      
      mockExeca.mockResolvedValueOnce({
        stdout: 'test',
        stderr: '',
        exitCode: 0,
        failed: false
      } as any);
      
      // Act
      await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(mockExeca).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          cwd: '/custom/path',
          env: expect.objectContaining({
            DEFAULT_ENV: 'value',
            CUSTOM_VAR: 'custom_value'
          })
        })
      );
    });
  });

  describe('Parallel Execution', () => {
    it('should execute commands in parallel up to maxParallel limit', async () => {
      // Arrange
      const commands: BatchCommand[] = Array.from({ length: 10 }, (_, i) => ({
        command: `cmd${i}`,
        args: [],
        continueOnError: false
      }));
      
      let activeCount = 0;
      let maxActiveCount = 0;
      
      mockExeca.mockImplementation(((cmd: any) => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        
        // Simulate async work
        return new Promise(resolve => {
          setTimeout(() => {
            activeCount--;
            resolve({
              stdout: `output from ${cmd}`,
              stderr: '',
              exitCode: 0,
              failed: false
            });
          }, 10);
        });
      }) as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: true,
        maxParallel: 3, // Limit to 3 concurrent
        timeout: 30000
      });
      
      // Assert
      expect(result.results).toHaveLength(10);
      expect(result.successCount).toBe(10);
      expect(result.parallel).toBe(true);
      expect(maxActiveCount).toBeLessThanOrEqual(3); // Never exceed limit
      expect(mockExeca).toHaveBeenCalledTimes(10);
    });

    it('should maintain result order in parallel execution', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'cmd1', args: [], continueOnError: false },
        { command: 'cmd2', args: [], continueOnError: false },
        { command: 'cmd3', args: [], continueOnError: false }
      ];
      
      // Simulate different execution times
      mockExeca
        .mockImplementationOnce((() => {
          return new Promise(resolve => {
            setTimeout(() => {
              resolve({ stdout: 'output1', stderr: '', exitCode: 0, failed: false });
            }, 30);
          });
        }) as any)
        .mockImplementationOnce((() => {
          return new Promise(resolve => {
            setTimeout(() => {
              resolve({ stdout: 'output2', stderr: '', exitCode: 0, failed: false });
            }, 10);
          });
        }) as any)
        .mockImplementationOnce((() => {
          return new Promise(resolve => {
            setTimeout(() => {
              resolve({ stdout: 'output3', stderr: '', exitCode: 0, failed: false });
            }, 20);
          });
        }) as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: true,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert - Results should be in original order, not completion order
      expect(result.results[0].command).toBe('cmd1');
      expect(result.results[0].stdout).toBe('output1');
      expect(result.results[1].command).toBe('cmd2');
      expect(result.results[1].stdout).toBe('output2');
      expect(result.results[2].command).toBe('cmd3');
      expect(result.results[2].stdout).toBe('output3');
    });

    it('should handle mixed success and failure in parallel', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'success1', args: [], continueOnError: false },
        { command: 'failure', args: [], continueOnError: false },
        { command: 'success2', args: [], continueOnError: false }
      ];
      
      mockExeca
        .mockResolvedValueOnce({
          stdout: 'success1',
          stderr: '',
          exitCode: 0,
          failed: false
        } as any)
        .mockRejectedValueOnce({
          message: 'Command failed',
          exitCode: 1,
          stdout: '',
          stderr: 'error',
          failed: true
        } as ExecaError)
        .mockResolvedValueOnce({
          stdout: 'success2',
          stderr: '',
          exitCode: 0,
          failed: false
        } as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: true,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert - All commands still execute in parallel
      expect(result.results).toHaveLength(3);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[2].success).toBe(true);
    });
  });

  describe('Session Integration', () => {
    it('should use session cwd and env when provided', async () => {
      // Arrange
      mockGetSessionCwd.mockResolvedValueOnce('/session/cwd');
      mockGetSessionEnv.mockResolvedValueOnce({ SESSION_VAR: 'session_value' });
      
      const commands: BatchCommand[] = [
        { command: 'echo', args: ['test'], continueOnError: false }
      ];
      
      mockExeca.mockResolvedValueOnce({
        stdout: 'test',
        stderr: '',
        exitCode: 0,
        failed: false
      } as any);
      
      // Act
      await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        session: 'test-session',
        timeout: 30000
      });
      
      // Assert
      expect(mockGetSessionCwd).toHaveBeenCalledWith('test-session');
      expect(mockGetSessionEnv).toHaveBeenCalledWith('test-session');
      expect(mockExeca).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          cwd: '/session/cwd',
          env: expect.objectContaining({
            SESSION_VAR: 'session_value'
          })
        })
      );
    });

    it('should use defaults when no session provided', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'echo', args: ['test'], continueOnError: false }
      ];
      
      mockExeca.mockResolvedValueOnce({
        stdout: 'test',
        stderr: '',
        exitCode: 0,
        failed: false
      } as any);
      
      // Act
      await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(mockGetSessionCwd).toHaveBeenCalledWith(undefined);
      expect(mockGetSessionEnv).toHaveBeenCalledWith(undefined);
      expect(mockExeca).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          cwd: '/default/cwd',
          env: expect.objectContaining({
            DEFAULT_ENV: 'value'
          })
        })
      );
    });
  });

  describe('Timeout Handling', () => {
    it('should apply timeout to commands', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'sleep', args: ['10'], continueOnError: false }
      ];
      
      mockExeca.mockRejectedValueOnce(Object.assign(new Error('Command timed out'), {
        timedOut: true,
        exitCode: null,
        stdout: '',
        stderr: '',
        failed: true
      }) as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 100 // Very short timeout
      });
      
      // Assert
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('timed out');
      expect(mockExeca).toHaveBeenCalledWith(
        'sleep',
        ['10'],
        expect.objectContaining({
          timeout: 100
        })
      );
    });
  });

  describe('Result Metadata', () => {
    it('should generate unique IDs for batch and commands', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'echo', args: ['1'], continueOnError: false },
        { command: 'echo', args: ['2'], continueOnError: false }
      ];
      
      mockExeca.mockResolvedValue({
        stdout: 'output',
        stderr: '',
        exitCode: 0,
        failed: false
      } as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(result.batchId).toBe('batch-1');
      expect(result.results[0].id).toBe('batch-2');
      expect(result.results[1].id).toBe('batch-3');
      
      // All IDs should be unique
      const allIds = [result.batchId, ...result.results.map(r => r.id)];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });

    it('should track duration for each command and total', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'echo', args: ['1'], continueOnError: false },
        { command: 'echo', args: ['2'], continueOnError: false }
      ];
      
      let callCount = 0;
      mockExeca.mockImplementation((() => {
        // Simulate different execution times
        const delay = callCount++ * 10;
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              stdout: 'output',
              stderr: '',
              exitCode: 0,
              failed: false
            });
          }, delay);
        });
      }) as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(result.totalDuration).toBeGreaterThan(0);
      result.results.forEach(res => {
        expect(res.duration).toBeGreaterThanOrEqual(0);
      });
    });

    it('should include command and args in results', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'git', args: ['status', '--short'], continueOnError: false }
      ];
      
      mockExeca.mockResolvedValueOnce({
        stdout: 'M file.txt',
        stderr: '',
        exitCode: 0,
        failed: false
      } as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(result.results[0].command).toBe('git');
      expect(result.results[0].args).toEqual(['status', '--short']);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing stdout/stderr gracefully', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'test', args: [], continueOnError: false }
      ];
      
      mockExeca.mockRejectedValueOnce({
        message: 'Command failed',
        exitCode: 1,
        stdout: undefined,
        stderr: undefined,
        failed: true
      } as ExecaError);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(result.results[0].stdout).toBe('');
      expect(result.results[0].stderr).toBe('');
      expect(result.results[0].error).toBe('Command failed');
    });

    it('should handle null exit codes', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'test', args: [], continueOnError: false }
      ];
      
      mockExeca.mockRejectedValueOnce(Object.assign(new Error('Signal received'), {
        exitCode: null,
        stdout: '',
        stderr: '',
        failed: true
      }) as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(result.results[0].exitCode).toBeNull();
      expect(result.results[0].success).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty command list', async () => {
      // Act
      const result = await executor.execute({
        commands: [],
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(result.results).toHaveLength(0);
      expect(result.totalCommands).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
    });

    it('should handle single command', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'echo', args: ['single'], continueOnError: false }
      ];
      
      mockExeca.mockResolvedValueOnce({
        stdout: 'single',
        stderr: '',
        exitCode: 0,
        failed: false
      } as any);
      
      // Act
      const result = await executor.execute({
        commands,
        parallel: true, // Even with parallel, should work fine
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(result.results).toHaveLength(1);
      expect(result.successCount).toBe(1);
      expect(result.results[0].stdout).toBe('single');
    });

    it('should use shell for execution', async () => {
      // Arrange
      const commands: BatchCommand[] = [
        { command: 'echo', args: ['test'], continueOnError: false }
      ];
      
      mockExeca.mockResolvedValueOnce({
        stdout: 'test',
        stderr: '',
        exitCode: 0,
        failed: false
      } as any);
      
      // Act
      await executor.execute({
        commands,
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      });
      
      // Assert
      expect(mockExeca).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          shell: '/bin/zsh'
        })
      );
    });
  });
});
