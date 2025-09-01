// session-tools.test.ts
// Tests for session management tools

import { jest } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSessionTools } from './session-tools.js';
import { SessionManager } from '../session-manager.js';

describe('Session Tools', () => {
  let server: McpServer;
  let sessionManager: SessionManager;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    // Reset modules to ensure clean state
    jest.resetModules();
    
    // Create a mock MCP server
    registeredTools = new Map();
    server = {
      tool: jest.fn((name: string, schema: any, handler: any) => {
        registeredTools.set(name, { schema, handler });
      })
    } as any;

    // Create a fresh session manager for each test
    sessionManager = new SessionManager();

    // Register the tools
    registerSessionTools(server, sessionManager);
  });

  afterEach(async () => {
    // Clean up session manager to ensure test isolation
    await sessionManager.cleanup();
    jest.restoreAllMocks();
  });

  describe('create_shell_session', () => {
    it('should register the create_shell_session tool', () => {
      expect(server.tool).toHaveBeenCalledWith(
        'create_shell_session',
        expect.objectContaining({
          name: expect.any(Object),
          cwd: expect.any(Object),
          env: expect.any(Object)
        }),
        expect.any(Function)
      );
      expect(registeredTools.has('create_shell_session')).toBe(true);
    });

    it('should create a new session', async () => {
      const tool = registeredTools.get('create_shell_session');
      const result = await tool.handler({
        name: 'session-tools-test-1',
        cwd: '/home/user/project',
        env: { NODE_ENV: 'test' }
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Created session \'session-tools-test-1\'');
      expect(result.content[0].text).toContain('Working directory: /home/user/project');
      expect(result.isError).toBeUndefined();
    });

    it('should handle session without optional parameters', async () => {
      const tool = registeredTools.get('create_shell_session');
      const result = await tool.handler({
        name: 'minimal-session'
      });

      expect(result.content[0].text).toContain('Created session \'minimal-session\'');
      expect(result.isError).toBeUndefined();
    });

    it('should error when session name already exists', async () => {
      const tool = registeredTools.get('create_shell_session');
      
      // Create first session
      await tool.handler({ name: 'duplicate-session' });
      
      // Try to create duplicate
      const result = await tool.handler({ name: 'duplicate-session' });

      expect(result.content[0].text).toContain('Error: Session \'duplicate-session\' already exists');
      expect(result.isError).toBe(true);
    });

    it('should set environment variables when provided', async () => {
      const tool = registeredTools.get('create_shell_session');
      const env = {
        NODE_ENV: 'production',
        API_KEY: 'secret123',
        DEBUG: 'true'
      };

      const result = await tool.handler({
        name: 'env-session',
        env
      });

      const session = await sessionManager.getSession('env-session');
      expect(session?.env).toMatchObject(env);
    });
  });

  describe('list_shell_sessions', () => {
    it('should register the list_shell_sessions tool', () => {
      expect(server.tool).toHaveBeenCalledWith(
        'list_shell_sessions',
        {},
        expect.any(Function)
      );
      expect(registeredTools.has('list_shell_sessions')).toBe(true);
    });

    it('should list all active sessions', async () => {
      // Create some sessions
      sessionManager.createSession('session1', '/home/user/proj1');
      sessionManager.createSession('session2', '/home/user/proj2');

      const tool = registeredTools.get('list_shell_sessions');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Active sessions:');
      expect(result.content[0].text).toContain('session1');
      expect(result.content[0].text).toContain('session2');
      // Note: Default session creation is async, so we don't check for it in unit tests
      expect(result.content[0].text).toContain('Commands run:');
      expect(result.content[0].text).toContain('Background processes:');
    });

    it('should show session details correctly', async () => {
      const sessionId = sessionManager.createSession('detailed-session', '/test/path');
      const session = await sessionManager.getSession(sessionId);
      
      // Add some history
      if (session) {
        session.history.push({
          command: 'ls -la',
          args: [],
          exitCode: 0,
          stdout: 'output',
          stderr: '',
          startTime: new Date(),
          duration: 100
        });
      }

      const tool = registeredTools.get('list_shell_sessions');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('detailed-session');
      expect(result.content[0].text).toContain('CWD: /test/path');
      expect(result.content[0].text).toContain('Commands run: 1');
    });

    it('should handle empty session list', async () => {
      // Mock empty sessions (except default)
      jest.spyOn(sessionManager, 'listSessions').mockReturnValue([]);

      const tool = registeredTools.get('list_shell_sessions');
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Active sessions:');
    });
  });

  describe('close_session', () => {
    it('should register the close_session tool', () => {
      expect(server.tool).toHaveBeenCalledWith(
        'close_session',
        expect.objectContaining({
          session: expect.any(Object)
        }),
        expect.any(Function)
      );
      expect(registeredTools.has('close_session')).toBe(true);
    });

    it('should close a session by name', async () => {
      sessionManager.createSession('to-close', '/tmp');

      const tool = registeredTools.get('close_session');
      const result = await tool.handler({ session: 'to-close' });

      expect(result.content[0].text).toBe('Session \'to-close\' closed');
      expect(result.isError).toBeUndefined();

      // Verify session is deleted
      const session = await sessionManager.getSession('to-close');
      expect(session).toBeUndefined();
    });

    it('should close a session by ID', async () => {
      const sessionId = sessionManager.createSession('by-id', '/tmp');

      const tool = registeredTools.get('close_session');
      const result = await tool.handler({ session: sessionId });

      expect(result.content[0].text).toBe(`Session '${sessionId}' closed`);
      expect(result.isError).toBeUndefined();
    });

    it('should not allow closing the default session', async () => {
      const tool = registeredTools.get('close_session');
      const result = await tool.handler({ session: 'default' });

      expect(result.content[0].text).toBe('Error: Cannot close the default session');
      expect(result.isError).toBe(true);
    });

    it('should error when session not found', async () => {
      const tool = registeredTools.get('close_session');
      const result = await tool.handler({ session: 'non-existent' });

      expect(result.content[0].text).toBe('Error: Session \'non-existent\' not found');
      expect(result.isError).toBe(true);
    });

    it('should handle closing session with background processes', async () => {
      const sessionId = sessionManager.createSession('with-processes', '/tmp');
      
      // Mock that this session has processes
      jest.spyOn(sessionManager, 'getSessionProcessCount').mockReturnValue(2);

      const tool = registeredTools.get('close_session');
      const result = await tool.handler({ session: sessionId });

      // Should still close successfully
      expect(result.content[0].text).toBe(`Session '${sessionId}' closed`);
      expect(result.isError).toBeUndefined();
    });
  });
});
