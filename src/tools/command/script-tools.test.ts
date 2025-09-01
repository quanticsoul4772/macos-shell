// script-tools.test.ts
// Tests for script execution tools

import { jest } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'fs/promises';
import * as os from 'os';
import { execa } from 'execa';

// Mock execa
jest.mock('execa', () => ({
  execa: jest.fn(),
  ExecaError: class ExecaError extends Error {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    code?: string;
    constructor(message: string) {
      super(message);
    }
  }
}));

// Mock file system operations
jest.mock('fs/promises', () => ({
  mkdtemp: jest.fn(),
  writeFile: jest.fn(),
  chmod: jest.fn(),
  rm: jest.fn()
}));

const fsMock = fs as jest.Mocked<typeof fs>;

// Mock os
jest.mock('os', () => ({
  tmpdir: jest.fn(() => '/tmp'),
  homedir: jest.fn(() => '/home/user')
}));

// Mock logger
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  default: mockLogger,
  getLogger: jest.fn(() => mockLogger)
}));

// Mock script validator
jest.mock('../../utils/script-validator.js', () => ({
  ScriptValidator: {
    validate: jest.fn()
  }
}));

describe('Script Tools', () => {
  let server: McpServer;
  let sessionManager: any;
  let registeredTools: Map<string, any>;
  let mockExeca: jest.MockedFunction<any>;
  let mockScriptValidator: any;

  beforeEach(async () => {
    // Import modules after mocks are set up
    const { registerScriptTools } = await import('./script-tools.js');
    const { SessionManager } = await import('../../session-manager.js');
    // Import mocked modules
    const execaModule = await import('execa');
    const validatorModule = await import('../../utils/script-validator.js');
    
    mockExeca = execaModule.execa;
    mockScriptValidator = validatorModule.ScriptValidator;

    // Create a mock MCP server
    registeredTools = new Map();
    server = {
      tool: jest.fn((name: string, schema: any, handler: any) => {
        registeredTools.set(name, { schema, handler });
      })
    } as any;

    // Create session manager
    sessionManager = new (SessionManager as any)();
    jest.spyOn(sessionManager, 'addToHistory').mockImplementation(() => {});
    jest.spyOn(sessionManager, 'getSession').mockImplementation((sessionName: any) => {
      if (sessionName === 'non-existent') {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        id: sessionName || 'default',
        name: sessionName || 'default',
        cwd: process.cwd(),
        env: process.env,
        history: [],
        created: new Date(),
        lastUsed: new Date()
      });
    });
    jest.spyOn(sessionManager, 'createSession').mockImplementation((name: any, cwd: any) => {
      return name;
    });

    // Setup default mocks
    (fsMock.mkdtemp as jest.MockedFunction<typeof fs.mkdtemp>).mockResolvedValue('/tmp/shell-script-123456');
    (fsMock.writeFile as jest.MockedFunction<typeof fs.writeFile>).mockResolvedValue(undefined);
    (fsMock.chmod as jest.MockedFunction<typeof fs.chmod>).mockResolvedValue(undefined);
    (fsMock.rm as jest.MockedFunction<typeof fs.rm>).mockResolvedValue(undefined);

    (mockScriptValidator.validate as jest.Mock).mockReturnValue({
      isValid: true,
      errors: [],
      warnings: [],
      sanitizedScript: undefined
    });

    mockExeca.mockResolvedValue({
      stdout: 'Script output',
      stderr: '',
      exitCode: 0
    });

    // Register the tools
    registerScriptTools(server, sessionManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('run_script', () => {
    it('should register the run_script tool', () => {
      expect(server.tool).toHaveBeenCalledWith(
        'run_script',
        expect.objectContaining({
          script: expect.any(Object),
          session: expect.any(Object),
          timeout: expect.any(Object)
        }),
        expect.any(Function)
      );
      expect(registeredTools.has('run_script')).toBe(true);
    });

    it('should execute a valid script successfully', async () => {
      const tool = registeredTools.get('run_script');
      const script = 'echo "Hello World"\nls -la';

      const result = await tool.handler({
        script,
        timeout: 30000
      });

      expect(mockScriptValidator.validate).toHaveBeenCalledWith(script);
      expect(fsMock.mkdtemp).toHaveBeenCalled();
      expect(fsMock.writeFile).toHaveBeenCalledWith(
        '/tmp/shell-script-123456/script.sh',
        script,
        'utf8'
      );
      expect(fsMock.chmod).toHaveBeenCalledWith('/tmp/shell-script-123456/script.sh', 0o755);
      expect(mockExeca).toHaveBeenCalledWith(
        '/bin/zsh',
        ['/tmp/shell-script-123456/script.sh'],
        expect.objectContaining({
          timeout: 30000,
          reject: false
        })
      );

      const response = JSON.parse(result.content[0].text);
      expect(response.stdout).toBe('Script output');
      expect(response.stderr).toBe('');
      expect(response.exitCode).toBe(0);
      expect(response.success).toBe(true);
      expect(response.command).toBe('script [2 lines]');
    });

    it('should handle script validation errors', async () => {
      (mockScriptValidator.validate as jest.Mock).mockReturnValue({
        isValid: false,
        errors: ['Dangerous command detected: rm -rf /'],
        warnings: [],
        sanitizedScript: undefined
      });

      const tool = registeredTools.get('run_script');
      const result = await tool.handler({
        script: 'rm -rf /',
        timeout: 30000
      });

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBe('Script validation failed');
      expect(response.errors).toContain('Dangerous command detected: rm -rf /');
      expect(response.success).toBe(false);

      // Should not execute the script
      expect(mockExeca).not.toHaveBeenCalled();
    });

    it('should handle script validation warnings', async () => {
      (mockScriptValidator.validate as jest.Mock).mockReturnValue({
        isValid: true,
        errors: [],
        warnings: ['Using sudo requires elevated privileges'],
        sanitizedScript: 'echo "sanitized"'
      });

      const tool = registeredTools.get('run_script');
      await tool.handler({
        script: 'sudo echo "test"',
        timeout: 30000
      });

      // Should use sanitized script
      expect(fsMock.writeFile).toHaveBeenCalledWith(
        '/tmp/shell-script-123456/script.sh',
        'echo "sanitized"',
        'utf8'
      );
    });

    it('should handle script execution failure', async () => {
      const { ExecaError } = await import('execa');
      const error = Object.create(ExecaError.prototype);
      error.message = 'Command failed';
      error.exitCode = 1;
      error.stdout = 'Partial output';
      error.stderr = 'Error occurred';
      error.code = 'ENOENT';

      mockExeca.mockRejectedValue(error);

      const tool = registeredTools.get('run_script');
      const result = await tool.handler({
        script: 'failing-command',
        timeout: 30000
      });

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.stdout).toBe('Partial output');
      expect(response.stderr).toBe('Error occurred');
      expect(response.exitCode).toBe(1);
      expect(response.success).toBe(false);
      expect(response.error).toBe('ENOENT');
    });

    it('should handle session not found', async () => {
      const tool = registeredTools.get('run_script');
      const result = await tool.handler({
        script: 'echo "test"',
        session: 'non-existent',
        timeout: 30000
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe("Error: Session 'non-existent' not found");
    });

    it('should use session environment and working directory', async () => {
      const sessionId = 'test-session';
      jest.spyOn(sessionManager, 'getSession').mockImplementationOnce(() => {
        return Promise.resolve({
          id: sessionId,
          name: 'test-session',
          cwd: '/custom/dir',
          env: { CUSTOM_VAR: 'value' },
          history: [],
          created: new Date(),
          lastUsed: new Date()
        });
      });
      jest.spyOn(sessionManager, 'createSession').mockImplementationOnce(() => sessionId);

      const tool = registeredTools.get('run_script');
      await tool.handler({
        script: 'echo $CUSTOM_VAR',
        session: sessionId,
        timeout: 30000
      });

      expect(mockExeca).toHaveBeenCalledWith(
        '/bin/zsh',
        expect.any(Array),
        expect.objectContaining({
          cwd: '/custom/dir',
          env: expect.objectContaining({ CUSTOM_VAR: 'value' })
        })
      );
    });

    it('should clean up temporary files after execution', async () => {
      const tool = registeredTools.get('run_script');
      await tool.handler({
        script: 'echo "test"',
        timeout: 30000
      });

      expect(fsMock.rm).toHaveBeenCalledWith(
        '/tmp/shell-script-123456',
        { recursive: true, force: true }
      );
    });

    it('should clean up temporary files even on error', async () => {
      mockExeca.mockRejectedValue(new Error('Execution failed'));

      const tool = registeredTools.get('run_script');
      await tool.handler({
        script: 'failing-script',
        timeout: 30000
      });

      expect(fsMock.rm).toHaveBeenCalledWith(
        '/tmp/shell-script-123456',
        { recursive: true, force: true }
      );
    });

    it('should handle cleanup errors gracefully', async () => {
      (fsMock.rm as jest.MockedFunction<typeof fs.rm>).mockRejectedValue(new Error('Cannot remove directory'));

      const tool = registeredTools.get('run_script');
      const result = await tool.handler({
        script: 'echo "test"',
        timeout: 30000
      });

      // Should still return success despite cleanup failure
      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
    });

    it('should record script execution in history', async () => {
      const tool = registeredTools.get('run_script');
      await tool.handler({
        script: 'echo "test"\nls',
        timeout: 30000
      });

      expect(sessionManager.addToHistory).toHaveBeenCalledWith(
        'default',
        expect.objectContaining({
          command: 'script',
          args: ['[2 lines]'],
          exitCode: 0,
          stdout: 'Script output',
          stderr: ''
        })
      );
    });

    it('should handle timeout properly', async () => {
      const tool = registeredTools.get('run_script');
      await tool.handler({
        script: 'sleep 10',
        timeout: 5000
      });

      expect(mockExeca).toHaveBeenCalledWith(
        '/bin/zsh',
        expect.any(Array),
        expect.objectContaining({
          timeout: 5000
        })
      );
    });

    it('should include duration in response', async () => {
      const tool = registeredTools.get('run_script');
      const result = await tool.handler({
        script: 'echo "quick"',
        timeout: 30000
      });

      const response = JSON.parse(result.content[0].text);
      expect(response).toHaveProperty('duration');
      expect(typeof response.duration).toBe('number');
    });
  });
});
