// system-tools.test.ts
// Tests for system health monitoring tools

import { jest } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSystemTools } from './system-tools.js';
import { SessionManager } from '../session-manager.js';
import { ProcessStatus } from '../background-process.js';

describe('System Tools', () => {
  let server: McpServer;
  let sessionManager: SessionManager;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    // Create a mock MCP server
    registeredTools = new Map();
    server = {
      tool: jest.fn((name: string, schema: any, handler: any) => {
        registeredTools.set(name, { schema, handler });
      })
    } as any;

    // Create session manager
    sessionManager = new SessionManager();

    // Mock process properties
    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 100 * 1024 * 1024,
      heapTotal: 80 * 1024 * 1024,
      heapUsed: 60 * 1024 * 1024,
      external: 10 * 1024 * 1024,
      arrayBuffers: 5 * 1024 * 1024
    });
    jest.spyOn(process, 'uptime').mockReturnValue(3600);
    Object.defineProperty(process, 'version', { value: 'v18.0.0', writable: true });
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });
    Object.defineProperty(process, 'pid', { value: 12345, writable: true });

    // Mock sessionManager methods
    jest.spyOn(sessionManager, 'listBackgroundProcesses').mockReturnValue([
      { 
        id: 'proc1', 
        command: 'npm run dev',
        args: [],
        sessionId: 'default',
        status: ProcessStatus.RUNNING,
        pid: 12345,
        startTime: new Date(),
        outputBuffer: {} as any,
        metadata: {
          cwd: '/home/user',
          env: {}
        }
      }
    ]);
    
    jest.spyOn(sessionManager, 'listSessions').mockReturnValue([
      {
        id: 'default',
        name: 'default',
        cwd: '/home/user',
        env: {},
        history: [],
        created: new Date(),
        lastUsed: new Date()
      },
      {
        id: 'session2',
        name: 'test-session',
        cwd: '/home/user/project',
        env: {},
        history: [],
        created: new Date(),
        lastUsed: new Date()
      }
    ]);

    // Register the tools
    registerSystemTools(server, sessionManager);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('get_system_health', () => {
    it('should register the get_system_health tool', () => {
      expect(server.tool).toHaveBeenCalledWith(
        'get_system_health',
        {},
        expect.any(Function)
      );
      expect(registeredTools.has('get_system_health')).toBe(true);
    });

    it('should return system health information', async () => {
      const tool = registeredTools.get('get_system_health');
      const result = await tool.handler({});

      expect(result).toHaveProperty('content');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const health = JSON.parse(result.content[0].text);
      
      // Check memory usage
      expect(health.memoryUsage).toEqual({
        heapUsed: 60,  // 60MB
        heapTotal: 80, // 80MB
        external: 10,  // 10MB
        rss: 100       // 100MB
      });

      // Check process and session info
      expect(health.activeProcesses).toBe(1);
      expect(health.sessionCount).toBe(2);
      expect(health.uptime).toBe(3600);
      expect(health.nodeVersion).toBe('v18.0.0');
      expect(health.platform).toBe('darwin');
      expect(health.pid).toBe(12345);
    });

    it('should handle empty sessions and processes', async () => {
      // Mock empty lists
      (sessionManager.listBackgroundProcesses as jest.Mock).mockReturnValue([]);
      (sessionManager.listSessions as jest.Mock).mockReturnValue([]);

      const tool = registeredTools.get('get_system_health');
      const result = await tool.handler({});

      const health = JSON.parse(result.content[0].text);
      expect(health.activeProcesses).toBe(0);
      expect(health.sessionCount).toBe(0);
    });

    it('should format memory values correctly', async () => {
      // Mock different memory values
      (process.memoryUsage as jest.MockedFunction<typeof process.memoryUsage>).mockReturnValue({
        rss: 1500 * 1024 * 1024,      // 1.5GB
        heapTotal: 512 * 1024 * 1024,  // 512MB
        heapUsed: 256 * 1024 * 1024,   // 256MB
        external: 50 * 1024 * 1024,    // 50MB
        arrayBuffers: 0
      });

      const tool = registeredTools.get('get_system_health');
      const result = await tool.handler({});

      const health = JSON.parse(result.content[0].text);
      
      expect(health.memoryUsage).toEqual({
        heapUsed: 256,   // 256MB
        heapTotal: 512,  // 512MB
        external: 50,    // 50MB
        rss: 1500        // 1500MB
      });
    });

    it('should include all required fields in response', async () => {
      const tool = registeredTools.get('get_system_health');
      const result = await tool.handler({});

      const health = JSON.parse(result.content[0].text);
      
      // Check all required fields are present
      expect(health).toHaveProperty('memoryUsage');
      expect(health).toHaveProperty('activeProcesses');
      expect(health).toHaveProperty('sessionCount');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('nodeVersion');
      expect(health).toHaveProperty('platform');
      expect(health).toHaveProperty('pid');
    });
  });
});
