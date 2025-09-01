import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEnvironmentTools } from './environment-tools';
import { SessionManager } from '../../session-manager';

// Mock SessionManager
jest.mock('../../session-manager');

describe('Environment Tools', () => {
  let mockServer: jest.Mocked<McpServer>;
  let mockSessionManager: jest.Mocked<SessionManager>;
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
      updateSession: jest.fn()
    } as any;

    // Register the tools
    registerEnvironmentTools(mockServer, mockSessionManager);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Tool Registration', () => {
    it('should register set_env and get_env tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(2);
      expect(registeredTools.has('set_env')).toBe(true);
      expect(registeredTools.has('get_env')).toBe(true);
    });
  });

  describe('set_env tool', () => {
    let setEnvHandler: any;

    beforeEach(() => {
      const tool = registeredTools.get('set_env');
      setEnvHandler = tool.handler;
    });

    it('should set environment variable successfully', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        cwd: '/home/user',
        env: { PATH: '/usr/bin' },
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await setEnvHandler({
        name: 'NODE_ENV',
        value: 'production',
        session: 'session-1'
      });

      expect(mockSessionManager.updateSession).toHaveBeenCalledWith('session-1', {
        env: {
          PATH: '/usr/bin',
          NODE_ENV: 'production'
        }
      });
      expect(result.content[0].text).toBe('Environment variable set: NODE_ENV=production');
      expect(result.isError).toBeFalsy();
    });

    it('should overwrite existing environment variable', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        cwd: '/home/user',
        env: { NODE_ENV: 'development', PATH: '/usr/bin' },
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await setEnvHandler({
        name: 'NODE_ENV',
        value: 'production',
        session: 'session-1'
      });

      expect(mockSessionManager.updateSession).toHaveBeenCalledWith('session-1', {
        env: {
          PATH: '/usr/bin',
          NODE_ENV: 'production'
        }
      });
      expect(result.content[0].text).toBe('Environment variable set: NODE_ENV=production');
    });

    it('should handle session not found', async () => {
      mockSessionManager.getSession.mockResolvedValue(undefined);

      const result = await setEnvHandler({
        name: 'TEST_VAR',
        value: 'test',
        session: 'non-existent'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Session 'non-existent' not found");
    });

    it('should use default session when not specified', async () => {
      const mockSession = {
        id: 'default',
        name: 'default',
        cwd: '/home/user',
        env: {},
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      await setEnvHandler({
        name: 'TEST_VAR',
        value: 'test'
      });

      expect(mockSessionManager.getSession).toHaveBeenCalledWith(undefined);
    });
  });

  describe('get_env tool', () => {
    let getEnvHandler: any;

    beforeEach(() => {
      const tool = registeredTools.get('get_env');
      getEnvHandler = tool.handler;
    });

    it('should get specific environment variable', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        cwd: '/home/user',
        env: { 
          NODE_ENV: 'production',
          PATH: '/usr/bin',
          HOME: '/home/user'
        },
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await getEnvHandler({
        name: 'NODE_ENV',
        session: 'session-1'
      });

      expect(result.content[0].text).toBe('NODE_ENV=production');
      expect(result.isError).toBeFalsy();
    });

    it('should handle non-existent environment variable', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        cwd: '/home/user',
        env: { PATH: '/usr/bin' },
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await getEnvHandler({
        name: 'NON_EXISTENT',
        session: 'session-1'
      });

      expect(result.content[0].text).toBe("Environment variable 'NON_EXISTENT' not set");
      expect(result.isError).toBeFalsy();
    });

    it('should get all environment variables when name not specified', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        cwd: '/home/user',
        env: { 
          NODE_ENV: 'production',
          PATH: '/usr/bin',
          HOME: '/home/user'
        },
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await getEnvHandler({
        session: 'session-1'
      });

      expect(result.content[0].text).toContain('NODE_ENV=production');
      expect(result.content[0].text).toContain('PATH=/usr/bin');
      expect(result.content[0].text).toContain('HOME=/home/user');
    });

    it('should handle empty environment', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        cwd: '/home/user',
        env: {},
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await getEnvHandler({
        session: 'session-1'
      });

      expect(result.content[0].text).toBe('No environment variables set');
    });

    it('should handle session not found', async () => {
      mockSessionManager.getSession.mockResolvedValue(undefined);

      const result = await getEnvHandler({
        name: 'PATH',
        session: 'non-existent'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Session 'non-existent' not found");
    });

    it('should use default session when not specified', async () => {
      const mockSession = {
        id: 'default',
        name: 'default',
        cwd: '/home/user',
        env: { PATH: '/usr/bin' },
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      await getEnvHandler({
        name: 'PATH'
      });

      expect(mockSessionManager.getSession).toHaveBeenCalledWith(undefined);
    });
  });
});