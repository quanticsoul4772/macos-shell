import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerNavigationTools } from './navigation-tools.js';
import { SessionManager } from '../../session-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fs module
jest.mock('fs/promises');
const fsMock = fs as jest.Mocked<typeof fs>;

// Mock SessionManager
jest.mock('../../session-manager');

describe('Navigation Tools', () => {
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
    registerNavigationTools(mockServer, mockSessionManager);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Tool Registration', () => {
    it('should register cd and pwd tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(3); // cd, pwd, history
      expect(registeredTools.has('cd')).toBe(true);
      expect(registeredTools.has('pwd')).toBe(true);
      expect(registeredTools.has('history')).toBe(true);
    });
  });

  describe('cd tool', () => {
    let cdHandler: any;

    beforeEach(() => {
      const tool = registeredTools.get('cd');
      cdHandler = tool.handler;
    });

    it('should change directory successfully', async () => {
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
      fsMock.stat.mockResolvedValue({ isDirectory: () => true } as any);

      const result = await cdHandler({
        path: 'projects',
        session: 'session-1'
      });

      expect(fsMock.stat).toHaveBeenCalledWith('/home/user/projects');
      expect(mockSessionManager.updateSession).toHaveBeenCalledWith('session-1', {
        cwd: '/home/user/projects'
      });
      expect(result.content[0].text).toContain('Changed directory to: /home/user/projects');
      expect(result.isError).toBeFalsy();
    });

    it('should handle absolute paths', async () => {
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
      fsMock.stat.mockResolvedValue({ isDirectory: () => true } as any);

      const result = await cdHandler({
        path: '/var/log',
        session: 'session-1'
      });

      expect(fsMock.stat).toHaveBeenCalledWith('/var/log');
      expect(mockSessionManager.updateSession).toHaveBeenCalledWith('session-1', {
        cwd: '/var/log'
      });
      expect(result.content[0].text).toContain('Changed directory to: /var/log');
    });

    it('should handle session not found', async () => {
      mockSessionManager.getSession.mockResolvedValue(undefined);

      const result = await cdHandler({
        path: '/tmp',
        session: 'non-existent'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Session 'non-existent' not found");
    });

    it('should handle non-directory paths', async () => {
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
      fsMock.stat.mockResolvedValue({ isDirectory: () => false } as any);

      const result = await cdHandler({
        path: 'file.txt',
        session: 'session-1'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('is not a directory');
    });

    it('should handle non-existent paths', async () => {
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
      fsMock.stat.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      const result = await cdHandler({
        path: 'non-existent',
        session: 'session-1'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Error changing directory');
    });
  });

  describe('pwd tool', () => {
    let pwdHandler: any;

    beforeEach(() => {
      const tool = registeredTools.get('pwd');
      pwdHandler = tool.handler;
    });

    it('should return current working directory', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        cwd: '/home/user/projects',
        env: {},
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await pwdHandler({
        session: 'session-1'
      });

      expect(result.content[0].text).toBe('/home/user/projects');
      expect(result.isError).toBeFalsy();
    });

    it('should use default session when not specified', async () => {
      const mockSession = {
        id: 'default',
        name: 'default',
        cwd: '/tmp',
        env: {},
        history: [],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await pwdHandler({});

      expect(mockSessionManager.getSession).toHaveBeenCalledWith(undefined);
      expect(result.content[0].text).toBe('/tmp');
    });

    it('should handle session not found', async () => {
      mockSessionManager.getSession.mockResolvedValue(undefined);

      const result = await pwdHandler({
        session: 'non-existent'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Session 'non-existent' not found");
    });
  });

  describe('history tool', () => {
    let historyHandler: any;

    beforeEach(() => {
      const tool = registeredTools.get('history');
      historyHandler = tool.handler;
    });

    it('should return command history', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        cwd: '/home/user',
        env: {},
        history: [
          { command: 'ls -la', args: ['-la'], exitCode: 0, stdout: '', stderr: '', startTime: new Date('2025-01-01T10:00:00'), duration: 10 },
          { command: 'cd projects', args: ['projects'], exitCode: 0, stdout: '', stderr: '', startTime: new Date('2025-01-01T10:01:00'), duration: 5 },
          { command: 'npm install', args: ['install'], exitCode: 0, stdout: '', stderr: '', startTime: new Date('2025-01-01T10:02:00'), duration: 1000 }
        ],
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await historyHandler({
        session: 'session-1',
        limit: 2
      });

      expect(result.content[0].text).toContain("Recent command history");
      expect(result.content[0].text).toContain('cd projects');
      expect(result.content[0].text).toContain('npm install');
      expect(result.content[0].text).not.toContain('ls -la'); // Limited to 2
    });

    it('should use default limit', async () => {
      const mockSession = {
        id: 'session-1',
        name: 'default',
        cwd: '/home/user',
        env: {},
        history: Array(15).fill(null).map((_, i) => ({
          command: `command ${i}`,
          args: [],
          exitCode: 0,
          stdout: '',
          stderr: '',
          startTime: new Date(),
          duration: 10
        })),
        created: new Date(),
        lastUsed: new Date()
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await historyHandler({
        session: 'session-1'
      });

      expect(result.content[0].text).toContain("Recent command history");
      // Should show last 10 commands (default limit) - commands 5-14
      expect(result.content[0].text).toContain('command 14');
      expect(result.content[0].text).toContain('command 5');
      // Check for actual commands that shouldn't be there (0-4 shouldn't appear)
      expect(result.content[0].text).not.toContain('1. command'); // Command at position 1
    });

    it('should handle empty history', async () => {
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

      const result = await historyHandler({
        session: 'session-1'
      });

      expect(result.content[0].text).toContain("Recent command history");
      expect(result.content[0].text).not.toContain('Exit code'); // No commands to show
    });

    it('should handle session not found', async () => {
      mockSessionManager.getSession.mockResolvedValue(undefined);

      const result = await historyHandler({
        session: 'non-existent'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Session 'non-existent' not found");
    });
  });
});