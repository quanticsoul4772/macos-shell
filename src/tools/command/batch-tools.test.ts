// batch-tools.test.ts
// Tests for batch command execution tools

import { jest } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBatchTools } from './batch-tools.js';
import { SessionManager } from '../../session-manager.js';
import { BatchExecutor } from '../../utils/batch-executor.js';

// Mock the enhanced batch executor module
const mockEnhancedExecute: jest.MockedFunction<any> = jest.fn();
jest.mock('../../utils/enhanced-batch-executor.js', () => {
  return {
    EnhancedBatchExecutor: jest.fn().mockImplementation(() => ({
      execute: mockEnhancedExecute
    }))
  };
});

describe('Batch Tools', () => {
  let server: McpServer;
  let sessionManager: SessionManager;
  let batchExecutor: BatchExecutor;
  let registeredTools: Map<string, any>;

  beforeEach(async () => {
    // Import the mocked module
    const { EnhancedBatchExecutor } = await import('../../utils/enhanced-batch-executor.js');
    
    // Create a mock MCP server
    registeredTools = new Map();
    server = {
      tool: jest.fn((name: string, schema: any, handler: any) => {
        registeredTools.set(name, { schema, handler });
      })
    } as any;

    // Create session manager
    sessionManager = new SessionManager();

    // Create batch executor
    batchExecutor = new BatchExecutor(
      async () => '/default/cwd',
      async () => ({ PATH: '/usr/bin' })
    );

    // Mock batch executor execute method
    jest.spyOn(batchExecutor, 'execute').mockImplementation(async (params: any) => ({
      batchId: 'test-batch-123',
      results: params.commands.map((cmd: any) => ({
        command: cmd.command,
        args: cmd.args,
        stdout: 'Success output',
        stderr: '',
        exitCode: 0,
        duration: 50,
        error: undefined
      })),
      totalCommands: params.commands.length,
      successCount: params.commands.length,
      failureCount: 0,
      totalDuration: 100,
      parallel: params.parallel || false
    }));

    // Register the tools
    registerBatchTools(server, sessionManager, batchExecutor);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockEnhancedExecute.mockClear();
  });

  describe('batch_execute', () => {
    it('should register the batch_execute tool', () => {
      expect(server.tool).toHaveBeenCalledWith(
        'batch_execute',
        expect.objectContaining({
          commands: expect.any(Object),
          parallel: expect.any(Object),
          maxParallel: expect.any(Object),
          session: expect.any(Object),
          timeout: expect.any(Object)
        }),
        expect.any(Function)
      );
      expect(registeredTools.has('batch_execute')).toBe(true);
    });

    it('should execute commands sequentially', async () => {
      const tool = registeredTools.get('batch_execute');
      const params = {
        commands: [
          { command: 'echo', args: ['Hello'], cwd: undefined, env: undefined, continueOnError: false },
          { command: 'ls', args: ['-la'], cwd: undefined, env: undefined, continueOnError: false }
        ],
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      };

      const result = await tool.handler(params);

      expect(result.isError).toBeUndefined();
      expect(batchExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining(params)
      );
      
      const response = JSON.parse(result.content[0].text);
      expect(response.results).toHaveLength(2);
      expect(response.successCount).toBe(2);
      expect(response.failureCount).toBe(0);
    });

    it('should execute commands in parallel', async () => {
      const tool = registeredTools.get('batch_execute');
      const params = {
        commands: [
          { command: 'sleep', args: ['1'], cwd: undefined, env: undefined, continueOnError: false },
          { command: 'sleep', args: ['1'], cwd: undefined, env: undefined, continueOnError: false }
        ],
        parallel: true,
        maxParallel: 2,
        timeout: 30000
      };

      const result = await tool.handler(params);

      expect(result.isError).toBeUndefined();
      expect(batchExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining(params)
      );
    });

    it('should handle execution errors', async () => {
      (batchExecutor.execute as jest.MockedFunction<typeof batchExecutor.execute>).mockRejectedValueOnce(new Error('Execution failed'));

      const tool = registeredTools.get('batch_execute');
      const params = {
        commands: [{ command: 'fail', args: [], cwd: undefined, env: undefined, continueOnError: false }],
        parallel: false,
        maxParallel: 5,
        timeout: 30000
      };

      const result = await tool.handler(params);

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error.code).toBe('BATCH_EXECUTION_FAILED');
      expect(response.error.message).toBe('Execution failed');
      expect(response.error.recoverable).toBe(true);
    });

    it('should respect session parameter', async () => {
      const tool = registeredTools.get('batch_execute');
      const params = {
        commands: [{ command: 'pwd', args: [], cwd: undefined, env: undefined, continueOnError: false }],
        parallel: false,
        maxParallel: 5,
        session: 'test-session',
        timeout: 30000
      };

      await tool.handler(params);

      expect(batchExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({ session: 'test-session' })
      );
    });
  });

  describe('batch_execute_enhanced', () => {
    it('should register the batch_execute_enhanced tool', () => {
      expect(server.tool).toHaveBeenCalledWith(
        'batch_execute_enhanced',
        expect.objectContaining({
          commands: expect.any(Object),
          parallel: expect.any(Object),
          maxParallel: expect.any(Object),
          session: expect.any(Object),
          timeout: expect.any(Object),
          stopOnFirstFailure: expect.any(Object),
          maxOutputLines: expect.any(Object),
          includeFullOutput: expect.any(Object)
        }),
        expect.any(Function)
      );
      expect(registeredTools.has('batch_execute_enhanced')).toBe(true);
    });

    it('should execute enhanced batch with conditions', async () => {
      mockEnhancedExecute.mockResolvedValueOnce({
        results: [
          {
            command: 'test',
            args: [],
            stdout: 'Success',
            stderr: '',
            exitCode: 0,
            conditionMet: true
          }
        ],
        totalTime: 50,
        successCount: 1,
        failureCount: 0,
        skippedCount: 0
      });

      const tool = registeredTools.get('batch_execute_enhanced');
      const params = {
        commands: [{
          command: 'test',
          args: [],
          condition: {
            type: 'exitCode' as const,
            operator: 'equals' as const,
            value: 0
          },
          continueOnError: false
        }],
        parallel: false,
        maxParallel: 5,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 50,
        includeFullOutput: false
      };

      const result = await tool.handler(params);

      expect(result.isError).toBeUndefined();
      expect(mockEnhancedExecute).toHaveBeenCalledWith(params);
      
      const response = JSON.parse(result.content[0].text);
      expect(response.successCount).toBe(1);
      expect(response.results[0].conditionMet).toBe(true);
    });

    it('should handle retry on failure', async () => {
      mockEnhancedExecute.mockResolvedValueOnce({
        results: [
          {
            command: 'flaky-command',
            args: [],
            stdout: 'Eventually succeeded',
            stderr: '',
            exitCode: 0,
            retryCount: 2
          }
        ],
        totalTime: 150,
        successCount: 1,
        failureCount: 0
      });

      const tool = registeredTools.get('batch_execute_enhanced');
      const params = {
        commands: [{
          command: 'flaky-command',
          args: [],
          retryOnFailure: 3,
          retryDelay: 100,
          continueOnError: false
        }],
        parallel: false,
        maxParallel: 5,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 50,
        includeFullOutput: false
      };

      const result = await tool.handler(params);

      expect(result.isError).toBeUndefined();
      const response = JSON.parse(result.content[0].text);
      expect(response.results[0].retryCount).toBe(2);
    });

    it('should handle enhanced batch execution errors', async () => {
      mockEnhancedExecute.mockRejectedValueOnce(new Error('Enhanced execution failed'));

      const tool = registeredTools.get('batch_execute_enhanced');
      const params = {
        commands: [{ command: 'fail', args: [], continueOnError: false }],
        parallel: false,
        maxParallel: 5,
        timeout: 30000,
        stopOnFirstFailure: true,
        maxOutputLines: 50,
        includeFullOutput: false
      };

      const result = await tool.handler(params);

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error.code).toBe('ENHANCED_BATCH_EXECUTION_FAILED');
      expect(response.error.message).toBe('Enhanced execution failed');
    });

    it('should respect output line limits', async () => {
      const longOutput = Array(100).fill('Line of output').join('\n');
      mockEnhancedExecute.mockResolvedValueOnce({
        results: [
          {
            command: 'verbose-command',
            args: [],
            stdout: longOutput,
            stderr: '',
            exitCode: 0
          }
        ],
        totalTime: 100,
        successCount: 1,
        failureCount: 0
      });

      const tool = registeredTools.get('batch_execute_enhanced');
      const params = {
        commands: [{ command: 'verbose-command', args: [], continueOnError: false }],
        parallel: false,
        maxParallel: 5,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 10,
        includeFullOutput: false
      };

      await tool.handler(params);

      expect(mockEnhancedExecute).toHaveBeenCalledWith(
        expect.objectContaining({ maxOutputLines: 10 })
      );
    });

    it('should include full output when requested', async () => {
      mockEnhancedExecute.mockResolvedValueOnce({
        results: [
          {
            command: 'output-command',
            args: [],
            stdout: 'Full output included',
            stderr: 'Error output included',
            exitCode: 0
          }
        ],
        totalTime: 50,
        successCount: 1,
        failureCount: 0
      });

      const tool = registeredTools.get('batch_execute_enhanced');
      const params = {
        commands: [{ command: 'output-command', args: [], continueOnError: false }],
        parallel: false,
        maxParallel: 5,
        timeout: 30000,
        stopOnFirstFailure: false,
        maxOutputLines: 50,
        includeFullOutput: true
      };

      const result = await tool.handler(params);

      expect(mockEnhancedExecute).toHaveBeenCalledWith(
        expect.objectContaining({ includeFullOutput: true })
      );
    });
  });
});
