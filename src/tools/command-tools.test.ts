import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCommandTools } from './command-tools.js';
import { SessionManager } from '../session-manager.js';
import { BatchExecutor } from '../utils/batch-executor.js';
import { CommandExecutor } from './command/command-executor.js';
import { AICommandEnhancer } from './command/ai-command-enhancer.js';

// Mock all the tool registration modules
jest.mock('./command/environment-tools', () => ({
  registerEnvironmentTools: jest.fn()
}));
jest.mock('./command/script-tools', () => ({
  registerScriptTools: jest.fn()
}));
jest.mock('./command/batch-tools', () => ({
  registerBatchTools: jest.fn()
}));
jest.mock('./command/navigation-tools', () => ({
  registerNavigationTools: jest.fn()
}));
jest.mock('./cache-management-tools', () => ({
  registerCacheManagementTools: jest.fn()
}));
jest.mock('./command/command-executor');
jest.mock('./command/ai-command-enhancer');

import { registerEnvironmentTools } from './command/environment-tools.js';
import { registerScriptTools } from './command/script-tools.js';
import { registerBatchTools } from './command/batch-tools.js';
import { registerNavigationTools } from './command/navigation-tools.js';
import { registerCacheManagementTools } from './cache-management-tools.js';

describe('Command Tools', () => {
  let mockServer: jest.Mocked<McpServer>;
  let mockSessionManager: jest.Mocked<SessionManager>;
  let mockBatchExecutor: jest.Mocked<BatchExecutor>;
  let mockCommandExecutor: jest.Mocked<CommandExecutor>;
  let mockAIEnhancer: jest.Mocked<AICommandEnhancer>;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    jest.clearAllMocks();
    registeredTools = new Map();

    // Setup server mock
    mockServer = {
      tool: jest.fn((name: string, schema: any, handler: any) => {
        registeredTools.set(name, { schema, handler });
      })
    } as any;

    // Setup session manager mock
    mockSessionManager = {
      getSession: jest.fn(),
      createSession: jest.fn(),
      closeSession: jest.fn()
    } as any;

    // Setup batch executor mock
    mockBatchExecutor = {
      execute: jest.fn()
    } as any;

    // Setup command executor mock
    mockCommandExecutor = {
      execute: jest.fn()
    } as any;
    (CommandExecutor as jest.MockedClass<typeof CommandExecutor>).mockImplementation(() => mockCommandExecutor);

    // Setup AI enhancer mock
    mockAIEnhancer = {
      executeWithAI: jest.fn()
    } as any;
    (AICommandEnhancer as jest.MockedClass<typeof AICommandEnhancer>).mockImplementation(() => mockAIEnhancer);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Tool Registration', () => {
    it('should register the main run_command tool', () => {
      registerCommandTools(mockServer, mockSessionManager, mockBatchExecutor);

      expect(mockServer.tool).toHaveBeenCalledWith(
        'run_command',
        expect.any(Object),
        expect.any(Function)
      );
      expect(registeredTools.has('run_command')).toBe(true);
    });

    it('should register all sub-modules', () => {
      registerCommandTools(mockServer, mockSessionManager, mockBatchExecutor);

      expect(registerNavigationTools).toHaveBeenCalledWith(mockServer, mockSessionManager);
      expect(registerEnvironmentTools).toHaveBeenCalledWith(mockServer, mockSessionManager);
      expect(registerScriptTools).toHaveBeenCalledWith(mockServer, mockSessionManager);
      expect(registerBatchTools).toHaveBeenCalledWith(mockServer, mockSessionManager, mockBatchExecutor);
      expect(registerCacheManagementTools).toHaveBeenCalledWith(mockServer);
    });

    it('should initialize CommandExecutor with SessionManager', () => {
      registerCommandTools(mockServer, mockSessionManager, mockBatchExecutor);

      expect(CommandExecutor).toHaveBeenCalledWith(mockSessionManager);
    });

    it('should initialize AICommandEnhancer with CommandExecutor', () => {
      registerCommandTools(mockServer, mockSessionManager, mockBatchExecutor);

      expect(AICommandEnhancer).toHaveBeenCalledWith(mockCommandExecutor);
    });
  });

  describe('run_command tool', () => {
    let runCommandHandler: any;

    beforeEach(() => {
      registerCommandTools(mockServer, mockSessionManager, mockBatchExecutor);
      const tool = registeredTools.get('run_command');
      runCommandHandler = tool.handler;
    });

    it('should execute command successfully', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        env: { PATH: '/usr/bin' },
        cwd: '/home/user',
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);
      mockAIEnhancer.executeWithAI.mockResolvedValue({
        stdout: 'Command output',
        stderr: '',
        exitCode: 0,
        success: true,
        duration: 100,
        command: 'echo "test"',
        cached: false,
        cacheStrategy: 'none'
      });

      const result = await runCommandHandler({
        command: 'echo',
        args: ['test'],
        session: 'default',
        timeout: 5000,
        maxOutputLines: 100,
        maxErrorLines: 50
      });

      expect(mockSessionManager.getSession).toHaveBeenCalledWith('default');
      expect(mockAIEnhancer.executeWithAI).toHaveBeenCalledWith({
        command: 'echo',
        args: ['test'],
        cwd: '/home/user',
        env: { PATH: '/usr/bin' },
        timeout: 5000,
        sessionId: 'session-1',
        maxOutputLines: 100,
        maxErrorLines: 50
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.stdout).toBe('Command output');
      expect(response.success).toBe(true);
      expect(response.exitCode).toBe(0);
    });

    it('should handle session not found error', async () => {
      mockSessionManager.getSession.mockResolvedValue(undefined);

      const result = await runCommandHandler({
        command: 'ls',
        args: [],
        session: 'non-existent'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Session 'non-existent' not found");
    });

    it('should merge environment variables', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        env: { PATH: '/usr/bin', NODE_ENV: 'development' },
        cwd: '/home/user',
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);
      mockAIEnhancer.executeWithAI.mockResolvedValue({
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        success: true,
        duration: 50,
        command: 'npm test'
      });

      await runCommandHandler({
        command: 'npm',
        args: ['test'],
        env: { NODE_ENV: 'test', CUSTOM_VAR: 'value' }
      });

      expect(mockAIEnhancer.executeWithAI).toHaveBeenCalledWith(
        expect.objectContaining({
          env: {
            PATH: '/usr/bin',
            NODE_ENV: 'test',  // Overridden
            CUSTOM_VAR: 'value'  // Added
          }
        })
      );
    });

    it('should override working directory when provided', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        env: {},
        cwd: '/home/user',
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);
      mockAIEnhancer.executeWithAI.mockResolvedValue({
        stdout: 'Files listed',
        stderr: '',
        exitCode: 0,
        success: true,
        duration: 20,
        command: 'ls'
      });

      await runCommandHandler({
        command: 'ls',
        args: [],
        cwd: '/tmp'
      });

      expect(mockAIEnhancer.executeWithAI).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: '/tmp'  // Overridden
        })
      );
    });

    it('should handle command failure', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        env: {},
        cwd: '/home/user',
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);
      mockAIEnhancer.executeWithAI.mockResolvedValue({
        stdout: '',
        stderr: 'Command not found',
        exitCode: 127,
        success: false,
        duration: 10,
        command: 'invalid-command',
        error: 'Command execution failed'
      });

      const result = await runCommandHandler({
        command: 'invalid-command',
        args: []
      });

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(false);
      expect(response.exitCode).toBe(127);
      expect(response.error).toBe('Command execution failed');
    });

    it('should include optional fields when present', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        env: {},
        cwd: '/home/user',
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);
      mockAIEnhancer.executeWithAI.mockResolvedValue({
        stdout: 'Output',
        stderr: '',
        exitCode: 0,
        success: true,
        duration: 100,
        command: 'cat file.txt',
        cached: true,
        cacheStrategy: 'long-term',
        truncation: {
          stdout: { totalLines: 100, truncated: false, totalBytes: 1000, returnedLines: 100, returnedBytes: 1000 },
          stderr: { totalLines: 0, truncated: false, totalBytes: 0, returnedLines: 0, returnedBytes: 0 }
        },
        warnings: ['Large output detected']
      });

      const result = await runCommandHandler({
        command: 'cat',
        args: ['file.txt']
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.cached).toBe(true);
      expect(response.cacheStrategy).toBe('long-term');
      expect(response.truncation).toBeDefined();
      expect(response.warnings).toContain('Large output detected');
    });

    it('should use default values when not provided', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        env: {},
        cwd: '/home/user',
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);
      mockAIEnhancer.executeWithAI.mockResolvedValue({
        stdout: 'Output',
        stderr: '',
        exitCode: 0,
        success: true,
        duration: 50,
        command: 'ls'
      });

      await runCommandHandler({
        command: 'ls',
        args: [],
        timeout: 30000,
        maxOutputLines: 100,
        maxErrorLines: 50
      });

      expect(mockAIEnhancer.executeWithAI).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 30000,  // Default
          maxOutputLines: 100,  // Default
          maxErrorLines: 50  // Default
        })
      );
    });

    it('should handle undefined session (use default)', async () => {
      const mockSession = {
        id: 'default-session',
        name: 'default',
        env: {},
        cwd: '/home/user',
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);
      mockAIEnhancer.executeWithAI.mockResolvedValue({
        stdout: 'Output',
        stderr: '',
        exitCode: 0,
        success: true,
        duration: 30,
        command: 'pwd'
      });

      const result = await runCommandHandler({
        command: 'pwd',
        args: []
        // No session specified
      });

      expect(mockSessionManager.getSession).toHaveBeenCalledWith(undefined);
      expect(result.isError).toBeFalsy();
    });
  });
});
