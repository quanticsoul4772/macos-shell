import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerProcessTools } from './process-tools.js';
import { SessionManager } from '../session-manager.js';

// Mock all handler modules
jest.mock('./helpers/process-handlers', () => ({
  handleRunBackground: jest.fn(),
  handleListProcesses: jest.fn(),
  handleGetProcessOutput: jest.fn(),
  handleStreamProcessOutput: jest.fn(),
  handleKillProcess: jest.fn(),
  handleSaveProcessOutput: jest.fn()
}));

jest.mock('./helpers/orphan-handlers', () => ({
  handleCleanupOrphans: jest.fn(),
  handleKillAllMatching: jest.fn()
}));

import {
  handleRunBackground,
  handleListProcesses,
  handleGetProcessOutput,
  handleStreamProcessOutput,
  handleKillProcess,
  handleSaveProcessOutput
} from './helpers/process-handlers.js';
import {
  handleCleanupOrphans,
  handleKillAllMatching
} from './helpers/orphan-handlers.js';

describe('Process Tools', () => {
  let mockServer: jest.Mocked<McpServer>;
  let mockSessionManager: jest.Mocked<SessionManager>;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    jest.clearAllMocks();
    registeredTools = new Map();

    mockServer = {
      tool: jest.fn((name: string, schema: any, handler: any) => {
        registeredTools.set(name, { schema, handler });
      })
    } as any;

    mockSessionManager = {
      getSession: jest.fn(),
      createSession: jest.fn()
    } as any;

    // Set up mock return values
    (handleRunBackground as jest.Mock).mockImplementation(() => Promise.resolve({ content: [{ text: 'background' }] }));
    (handleListProcesses as jest.Mock).mockImplementation(() => Promise.resolve({ content: [{ text: 'list' }] }));
    (handleGetProcessOutput as jest.Mock).mockImplementation(() => Promise.resolve({ content: [{ text: 'output' }] }));
    (handleStreamProcessOutput as jest.Mock).mockImplementation(() => Promise.resolve({ content: [{ text: 'stream' }] }));
    (handleKillProcess as jest.Mock).mockImplementation(() => Promise.resolve({ content: [{ text: 'killed' }] }));
    (handleSaveProcessOutput as jest.Mock).mockImplementation(() => Promise.resolve({ content: [{ text: 'saved' }] }));
    (handleCleanupOrphans as jest.Mock).mockImplementation(() => Promise.resolve({ content: [{ text: 'cleanup' }] }));
    (handleKillAllMatching as jest.Mock).mockImplementation(() => Promise.resolve({ content: [{ text: 'kill-all' }] }));

    registerProcessTools(mockServer, mockSessionManager);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Tool Registration', () => {
    it('should register all process management tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(8);
      expect(registeredTools.has('run_background')).toBe(true);
      expect(registeredTools.has('list_processes')).toBe(true);
      expect(registeredTools.has('get_process_output')).toBe(true);
      expect(registeredTools.has('stream_process_output')).toBe(true);
      expect(registeredTools.has('kill_process')).toBe(true);
      expect(registeredTools.has('cleanup_orphans')).toBe(true);
      expect(registeredTools.has('kill_all_matching')).toBe(true);
      expect(registeredTools.has('save_process_output')).toBe(true);
    });
  });

  describe('run_background', () => {
    it('should call handler with correct parameters', async () => {
      const tool = registeredTools.get('run_background');
      const params = {
        command: 'npm test',
        args: ['--watch'],
        session: 'test-session',
        name: 'test-runner'
      };

      const result = await tool.handler(params);

      expect(handleRunBackground).toHaveBeenCalledWith(params, mockSessionManager);
      expect(result.content[0].text).toBe('background');
    });

    it('should handle minimal parameters', async () => {
      const tool = registeredTools.get('run_background');
      const params = { command: 'ls', args: [] };

      await tool.handler(params);

      expect(handleRunBackground).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'ls', args: [] }),
        mockSessionManager
      );
    });
  });

  describe('list_processes', () => {
    it('should call handler with default values', async () => {
      const tool = registeredTools.get('list_processes');
      const result = await tool.handler({ limit: 20, offset: 0, includeOrphaned: true });

      expect(handleListProcesses).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 20,
          offset: 0,
          includeOrphaned: true
        }),
        mockSessionManager
      );
      expect(result.content[0].text).toBe('list');
    });

    it('should pass custom parameters', async () => {
      const tool = registeredTools.get('list_processes');
      const params = {
        session: 'custom-session',
        limit: 50,
        offset: 10,
        includeOrphaned: false
      };

      await tool.handler(params);

      expect(handleListProcesses).toHaveBeenCalledWith(params, mockSessionManager);
    });
  });

  describe('get_process_output', () => {
    it('should call handler with search parameters', async () => {
      const tool = registeredTools.get('get_process_output');
      const params = {
        process_id: 'proc-123',
        lines: 200,
        from_line: 10,
        search: 'error',
        search_type: 'regex' as const,
        case_sensitive: true,
        invert_match: false,
        show_context: 2
      };

      const result = await tool.handler(params);

      expect(handleGetProcessOutput).toHaveBeenCalledWith(params, mockSessionManager);
      expect(result.content[0].text).toBe('output');
    });

    it('should use default values', async () => {
      const tool = registeredTools.get('get_process_output');
      const params = { 
        process_id: 'proc-456',
        lines: 100,
        search_type: 'text' as const,
        case_sensitive: false,
        invert_match: false,
        show_context: 0
      };

      await tool.handler(params);

      expect(handleGetProcessOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          process_id: 'proc-456',
          lines: 100,
          search_type: 'text',
          case_sensitive: false,
          invert_match: false,
          show_context: 0
        }),
        mockSessionManager
      );
    });
  });

  describe('stream_process_output', () => {
    it('should call handler with streaming parameters', async () => {
      const tool = registeredTools.get('stream_process_output');
      const params = {
        process_id: 'proc-789',
        after_line: 50,
        timeout: 60000,
        max_lines: 200
      };

      const result = await tool.handler(params);

      expect(handleStreamProcessOutput).toHaveBeenCalledWith(params, mockSessionManager);
      expect(result.content[0].text).toBe('stream');
    });

    it('should use default timeout and max_lines', async () => {
      const tool = registeredTools.get('stream_process_output');
      const params = { process_id: 'proc-999', timeout: 30000, max_lines: 100 };

      await tool.handler(params);

      expect(handleStreamProcessOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          process_id: 'proc-999',
          timeout: 30000,
          max_lines: 100
        }),
        mockSessionManager
      );
    });
  });

  describe('kill_process', () => {
    it('should kill process with SIGTERM by default', async () => {
      const tool = registeredTools.get('kill_process');
      const params = { process_id: 'proc-kill-1', signal: 'SIGTERM' as const };

      const result = await tool.handler(params);

      expect(handleKillProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          process_id: 'proc-kill-1',
          signal: 'SIGTERM'
        }),
        mockSessionManager
      );
      expect(result.content[0].text).toBe('killed');
    });

    it('should kill process with SIGKILL when specified', async () => {
      const tool = registeredTools.get('kill_process');
      const params = {
        process_id: 'proc-kill-2',
        signal: 'SIGKILL' as const
      };

      await tool.handler(params);

      expect(handleKillProcess).toHaveBeenCalledWith(params, mockSessionManager);
    });
  });

  describe('cleanup_orphans', () => {
    it('should use interactive mode by default', async () => {
      const tool = registeredTools.get('cleanup_orphans');
      const result = await tool.handler({ mode: 'interactive' as const, force: false });

      expect(handleCleanupOrphans).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'interactive',
          force: false
        }),
        mockSessionManager
      );
      expect(result.content[0].text).toBe('cleanup');
    });

    it('should handle kill mode with force', async () => {
      const tool = registeredTools.get('cleanup_orphans');
      const params = {
        mode: 'kill' as const,
        force: true
      };

      await tool.handler(params);

      expect(handleCleanupOrphans).toHaveBeenCalledWith(params, mockSessionManager);
    });

    it('should handle list mode', async () => {
      const tool = registeredTools.get('cleanup_orphans');
      const params = { mode: 'list' as const, force: false };

      await tool.handler(params);

      expect(handleCleanupOrphans).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'list',
          force: false
        }),
        mockSessionManager
      );
    });
  });

  describe('kill_all_matching', () => {
    it('should kill matching processes with text pattern', async () => {
      const tool = registeredTools.get('kill_all_matching');
      const params = {
        pattern: 'node',
        pattern_type: 'text' as const,
        signal: 'SIGTERM' as const,
        dry_run: false
      };

      const result = await tool.handler(params);

      expect(handleKillAllMatching).toHaveBeenCalledWith(params, mockSessionManager);
      expect(result.content[0].text).toBe('kill-all');
    });

    it('should handle regex pattern with dry run', async () => {
      const tool = registeredTools.get('kill_all_matching');
      const params = {
        pattern: 'npm.*test',
        pattern_type: 'regex' as const,
        signal: 'SIGTERM' as const,
        dry_run: true
      };

      await tool.handler(params);

      expect(handleKillAllMatching).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'npm.*test',
          pattern_type: 'regex',
          signal: 'SIGTERM',
          dry_run: true
        }),
        mockSessionManager
      );
    });

    it('should use default values', async () => {
      const tool = registeredTools.get('kill_all_matching');
      const params = { 
        pattern: 'python',
        pattern_type: 'text' as const,
        signal: 'SIGTERM' as const,
        dry_run: false
      };

      await tool.handler(params);

      expect(handleKillAllMatching).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'python',
          pattern_type: 'text',
          signal: 'SIGTERM',
          dry_run: false
        }),
        mockSessionManager
      );
    });
  });

  describe('save_process_output', () => {
    it('should save process output as text', async () => {
      const tool = registeredTools.get('save_process_output');
      const params = {
        process_id: 'proc-save-1',
        file_path: '/tmp/output.txt',
        format: 'text' as const,
        include_metadata: false
      };

      const result = await tool.handler(params);

      expect(handleSaveProcessOutput).toHaveBeenCalledWith(params, mockSessionManager);
      expect(result.content[0].text).toBe('saved');
    });

    it('should save as JSON with metadata', async () => {
      const tool = registeredTools.get('save_process_output');
      const params = {
        process_id: 'proc-save-2',
        file_path: '/tmp/output.json',
        format: 'json' as const,
        include_metadata: true
      };

      await tool.handler(params);

      expect(handleSaveProcessOutput).toHaveBeenCalledWith(params, mockSessionManager);
    });

    it('should use default format and metadata settings', async () => {
      const tool = registeredTools.get('save_process_output');
      const params = {
        process_id: 'proc-save-3',
        file_path: '/tmp/default.txt',
        format: 'text' as const,
        include_metadata: false
      };

      await tool.handler(params);

      expect(handleSaveProcessOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          process_id: 'proc-save-3',
          file_path: '/tmp/default.txt',
          format: 'text',
          include_metadata: false
        }),
        mockSessionManager
      );
    });
  });
});