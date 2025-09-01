import { registerPreflightTools } from './preflight-tools.js';
import { jest } from '@jest/globals';
import { execa } from 'execa';
import * as fs from 'fs/promises';
import * as net from 'net';

// Mock dependencies
jest.mock('execa');
jest.mock('fs/promises');
jest.mock('net');

const mockFs = fs as jest.Mocked<typeof fs>;

// Mock SessionManager
const mockSessionManager = {
  getSession: jest.fn()
};

// Mock McpServer
class MockMcpServer {
  tools = new Map();
  
  tool(name: string, schema: any, handler: any) {
    this.tools.set(name, { schema, handler });
  }
  
  async callTool(name: string, params: any) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return await tool.handler(params);
  }
}

describe('PreflightTools', () => {
  let server: MockMcpServer;
  
  beforeEach(() => {
    jest.clearAllMocks();
    server = new MockMcpServer();
    registerPreflightTools(server as any, mockSessionManager as any);
  });

  describe('preflight_check tool', () => {
    describe('command checks', () => {
      it('should check command existence using command -v', async () => {
        (execa as jest.MockedFunction<typeof execa>).mockResolvedValueOnce({
          stdout: '/usr/bin/git',
          stderr: '',
          exitCode: 0
        } as any);

        const result = await server.callTool('preflight_check', {
          commands: ['git']
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.commands.git.exists).toBe(true);
        expect(data.checks.commands.git.path).toBe('/usr/bin/git');
        expect(execa).toHaveBeenCalledWith('command', ['-v', 'git'], expect.any(Object));
      });

      it('should fallback to which when command -v fails', async () => {
        (execa as jest.MockedFunction<typeof execa>)
          .mockRejectedValueOnce(new Error('command not found'))
          .mockResolvedValueOnce({
            stdout: '/usr/local/bin/node',
            stderr: '',
            exitCode: 0
          } as any);

        const result = await server.callTool('preflight_check', {
          commands: ['node']
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.commands.node.exists).toBe(true);
        expect(data.checks.commands.node.path).toBe('/usr/local/bin/node');
        expect(execa).toHaveBeenCalledWith('which', ['node'], expect.any(Object));
      });

      it('should mark command as not found when both methods fail', async () => {
        (execa as jest.MockedFunction<typeof execa>)
          .mockRejectedValueOnce(new Error('command not found'))
          .mockRejectedValueOnce(new Error('not found'));

        const result = await server.callTool('preflight_check', {
          commands: ['nonexistent']
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.commands.nonexistent.exists).toBe(false);
        expect(data.checks.commands.nonexistent.path).toBeNull();
      });

      it('should check multiple commands', async () => {
        (execa as jest.MockedFunction<typeof execa>)
          .mockResolvedValueOnce({ stdout: '/usr/bin/git', stderr: '', exitCode: 0 } as any)
          .mockResolvedValueOnce({ stdout: '/usr/bin/npm', stderr: '', exitCode: 0 } as any);

        const result = await server.callTool('preflight_check', {
          commands: ['git', 'npm']
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.commands.git.exists).toBe(true);
        expect(data.checks.commands.npm.exists).toBe(true);
      });
    });

    describe('path checks', () => {
      it('should check file existence and type', async () => {
        const mockStats = {
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false
        };
        mockFs.stat.mockResolvedValue(mockStats as any);
        mockFs.access.mockResolvedValue(undefined as any);

        const result = await server.callTool('preflight_check', {
          paths: [{ path: '/test/file.txt', type: 'file' }]
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.paths['/test/file.txt'].exists).toBe(true);
        expect(data.checks.paths['/test/file.txt'].type).toBe('file');
        expect(data.checks.paths['/test/file.txt'].typeMatch).toBe(true);
      });

      it('should check directory existence and type', async () => {
        const mockStats = {
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false
        };
        mockFs.stat.mockResolvedValue(mockStats as any);

        const result = await server.callTool('preflight_check', {
          paths: [{ path: '/test/dir', type: 'directory' }]
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.paths['/test/dir'].exists).toBe(true);
        expect(data.checks.paths['/test/dir'].type).toBe('directory');
        expect(data.checks.paths['/test/dir'].typeMatch).toBe(true);
      });

      it('should check access permissions', async () => {
        const mockStats = {
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false
        };
        mockFs.stat.mockResolvedValue(mockStats as any);
        mockFs.access
          .mockResolvedValueOnce(undefined as any) // R_OK
          .mockRejectedValueOnce(new Error('No write')) // W_OK
          .mockResolvedValueOnce(undefined as any); // X_OK

        const result = await server.callTool('preflight_check', {
          paths: [{ path: '/test/script.sh', access: 'execute' }]
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.paths['/test/script.sh'].readable).toBe(true);
        expect(data.checks.paths['/test/script.sh'].writable).toBe(false);
        expect(data.checks.paths['/test/script.sh'].executable).toBe(true);
        expect(data.checks.paths['/test/script.sh'].accessMatch).toBe(true);
      });

      it('should handle non-existent paths', async () => {
        const error = new Error('ENOENT') as any;
        error.code = 'ENOENT';
        mockFs.stat.mockRejectedValue(error);

        const result = await server.callTool('preflight_check', {
          paths: [{ path: '/nonexistent' }]
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.paths['/nonexistent'].exists).toBe(false);
        expect(data.checks.paths['/nonexistent'].error).toBe('ENOENT');
      });
    });

    describe('port checks', () => {
      it('should detect available port', async () => {
        const mockServer = {
          once: jest.fn((event: string, callback: any) => {
            if (event === 'listening') {
              setTimeout(() => callback(), 0);
            }
          }),
          listen: jest.fn(),
          close: jest.fn()
        };
        (net.createServer as jest.Mock).mockReturnValue(mockServer);

        const result = await server.callTool('preflight_check', {
          ports: [3000]
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.ports[3000].available).toBe(true);
        expect(data.checks.ports[3000].inUse).toBe(false);
      });

      it('should detect port in use', async () => {
        const mockServer = {
          once: jest.fn((event: string, callback: any) => {
            if (event === 'error') {
              const err = new Error() as any;
              err.code = 'EADDRINUSE';
              setTimeout(() => callback(err), 0);
            }
          }),
          listen: jest.fn()
        };
        (net.createServer as jest.Mock).mockReturnValue(mockServer);

        const result = await server.callTool('preflight_check', {
          ports: [8080]
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.ports[8080].available).toBe(false);
        expect(data.checks.ports[8080].inUse).toBe(true);
      });
    });

    describe('environment variable checks', () => {
      it('should check environment variables', async () => {
        const originalEnv = process.env;
        process.env = {
          ...originalEnv,
          TEST_VAR: 'test_value'
        };

        const result = await server.callTool('preflight_check', {
          env_vars: ['TEST_VAR', 'MISSING_VAR']
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.env_vars.TEST_VAR.exists).toBe(true);
        expect(data.checks.env_vars.TEST_VAR.value).toBe('test_value');
        expect(data.checks.env_vars.MISSING_VAR.exists).toBe(false);
        expect(data.checks.env_vars.MISSING_VAR.value).toBeNull();

        process.env = originalEnv;
      });

      it('should use session environment when provided', async () => {
        (mockSessionManager.getSession as jest.MockedFunction<any>).mockResolvedValue({
          env: {
            SESSION_VAR: 'session_value'
          }
        });

        const result = await server.callTool('preflight_check', {
          env_vars: ['SESSION_VAR'],
          session: 'test-session'
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.checks.env_vars.SESSION_VAR.exists).toBe(true);
        expect(data.checks.env_vars.SESSION_VAR.value).toBe('session_value');
      });
    });

    describe('summary generation', () => {
      it('should generate correct summary for all passing checks', async () => {
        (execa as jest.MockedFunction<typeof execa>).mockResolvedValue({
          stdout: '/usr/bin/test',
          stderr: '',
          exitCode: 0
        } as any);

        const result = await server.callTool('preflight_check', {
          commands: ['test']
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.summary.all_commands_exist).toBe(true);
        expect(data.summary.all_checks_passed).toBe(true);
      });

      it('should generate correct summary for failing checks', async () => {
        (execa as jest.MockedFunction<typeof execa>)
          .mockRejectedValue(new Error('not found'));

        const result = await server.callTool('preflight_check', {
          commands: ['nonexistent']
        });

        const data = JSON.parse(result.content[0].text);
        expect(data.summary.all_commands_exist).toBe(false);
        expect(data.summary.all_checks_passed).toBe(false);
      });

      it('should handle empty checks', async () => {
        const result = await server.callTool('preflight_check', {});

        const data = JSON.parse(result.content[0].text);
        expect(data.summary.all_checks_passed).toBe(true);
      });
    });
  });

  describe('system_profile tool', () => {
    it('should get OS information', async () => {
      (execa as jest.MockedFunction<typeof execa>)
        .mockResolvedValueOnce({ stdout: '14.0', stderr: '', exitCode: 0 } as any)
        .mockResolvedValueOnce({ stdout: '23A344', stderr: '', exitCode: 0 } as any)
        .mockResolvedValueOnce({ stdout: 'arm64', stderr: '', exitCode: 0 } as any);

      const result = await server.callTool('system_profile', {
        include: ['os']
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.os.version).toBe('14.0');
      expect(data.os.build).toBe('23A344');
      expect(data.os.architecture).toBe('arm64');
    });

    it('should get shell information', async () => {
      (execa as jest.MockedFunction<typeof execa>)
        .mockResolvedValueOnce({ stdout: '/bin/zsh', stderr: '', exitCode: 0 } as any)
        .mockResolvedValueOnce({ stdout: 'zsh 5.9 (arm64-apple-darwin23.0)', stderr: '', exitCode: 0 } as any);

      const result = await server.callTool('system_profile', {
        include: ['shell']
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.shell.path).toBe('/bin/zsh');
      expect(data.shell.version).toBe('zsh 5.9 (arm64-apple-darwin23.0)');
    });

    it('should get Node.js information', async () => {
      (execa as jest.MockedFunction<typeof execa>)
        .mockResolvedValueOnce({ stdout: 'v18.17.0', stderr: '', exitCode: 0 } as any)
        .mockResolvedValueOnce({ stdout: '9.6.7', stderr: '', exitCode: 0 } as any);

      const result = await server.callTool('system_profile', {
        include: ['node']
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.node.version).toBe('v18.17.0');
      expect(data.node.npm).toBe('9.6.7');
    });

    it('should handle missing tools', async () => {
      (execa as jest.MockedFunction<typeof execa>)
        .mockRejectedValue(new Error('command not found'));

      const result = await server.callTool('system_profile', {
        include: ['docker']
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.docker.installed).toBe(false);
    });

    it('should check Python versions', async () => {
      (execa as jest.MockedFunction<typeof execa>)
        .mockResolvedValueOnce({ stdout: 'Python 3.11.5', stderr: '', exitCode: 0 } as any)
        .mockResolvedValueOnce({ stdout: 'pip 23.2.1 from /usr/local/lib', stderr: '', exitCode: 0 } as any);

      const result = await server.callTool('system_profile', {
        include: ['python']
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.python.python3).toBe('Python 3.11.5');
      expect(data.python.pip3).toBe('23.2.1');
    });

    it('should check Git version', async () => {
      (execa as jest.MockedFunction<typeof execa>)
        .mockResolvedValueOnce({ stdout: 'git version 2.42.0', stderr: '', exitCode: 0 } as any);

      const result = await server.callTool('system_profile', {
        include: ['git']
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.git.version).toBe('2.42.0');
    });

    it('should check Docker status', async () => {
      (execa as jest.MockedFunction<typeof execa>)
        .mockResolvedValueOnce({ stdout: 'Docker version 24.0.5', stderr: '', exitCode: 0 } as any)
        .mockResolvedValueOnce({ stdout: 'CONTAINER ID', stderr: '', exitCode: 0 } as any);

      const result = await server.callTool('system_profile', {
        include: ['docker']
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.docker.version).toBe('Docker version 24.0.5');
      expect(data.docker.running).toBe(true);
    });

    it('should check Homebrew version', async () => {
      (execa as jest.MockedFunction<typeof execa>)
        .mockResolvedValueOnce({ stdout: 'Homebrew 4.1.14', stderr: '', exitCode: 0 } as any);

      const result = await server.callTool('system_profile', {
        include: ['homebrew']
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.homebrew.version).toBe('4.1.14');
    });

    it('should check Xcode tools', async () => {
      (execa as jest.MockedFunction<typeof execa>)
        .mockResolvedValueOnce({ stdout: '/Applications/Xcode.app/Contents/Developer', stderr: '', exitCode: 0 } as any);

      const result = await server.callTool('system_profile', {
        include: ['xcode']
      });

      const data = JSON.parse(result.content[0].text);
      expect(data.xcode.path).toBe('/Applications/Xcode.app/Contents/Developer');
      expect(data.xcode.installed).toBe(true);
    });

    it('should get all items when include is empty', async () => {
      (execa as jest.MockedFunction<typeof execa>)
        .mockResolvedValue({ stdout: 'test', stderr: '', exitCode: 0 } as any);

      const result = await server.callTool('system_profile', {});

      const data = JSON.parse(result.content[0].text);
      expect(data.timestamp).toBeDefined();
      // Should attempt to get all system info
      expect(execa).toHaveBeenCalled();
    });
  });
});
