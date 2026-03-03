import { jest } from '@jest/globals';
import {
  createErrorResponse,
  createSuccessResponse,
  validateSession,
  validateProcess,
  formatRuntime,
  formatProcessInfo,
  killProcess,
} from './process-helpers.js';
import { ProcessStatus } from '../../background-process.js';

// Mock logger
jest.mock('../../utils/logger.js', () => ({
  getLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

describe('process-helpers', () => {
  describe('createErrorResponse', () => {
    it('should return an error response with the given message', () => {
      const resp = createErrorResponse('something broke');
      expect(resp).toEqual({
        content: [{ type: 'text', text: 'something broke' }],
        isError: true,
      });
    });
  });

  describe('createSuccessResponse', () => {
    it('should return a success response with the given text', () => {
      const resp = createSuccessResponse('all good');
      expect(resp).toEqual({
        content: [{ type: 'text', text: 'all good' }],
      });
      expect(resp.isError).toBeUndefined();
    });
  });

  describe('validateSession', () => {
    it('should return session when found', async () => {
      const mockSession = { id: 'abc', name: 'test' };
      const sm = { getSession: jest.fn<any>().mockResolvedValue(mockSession) } as any;

      const result = await validateSession(sm, 'test');
      expect(result.session).toBe(mockSession);
      expect(result.error).toBeUndefined();
    });

    it('should return error when session not found', async () => {
      const sm = { getSession: jest.fn<any>().mockResolvedValue(null) } as any;

      const result = await validateSession(sm, 'missing');
      expect(result.session).toBeNull();
      expect(result.error).toBeDefined();
      expect(result.error!.isError).toBe(true);
      expect(result.error!.content[0].text).toContain('missing');
    });
  });

  describe('validateProcess', () => {
    it('should return process when found', () => {
      const mockProc = { id: 'p1', command: 'sleep' };
      const sm = { getBackgroundProcess: jest.fn().mockReturnValue(mockProc) } as any;

      const result = validateProcess(sm, 'p1');
      expect(result.process).toBe(mockProc);
      expect(result.error).toBeUndefined();
    });

    it('should return error when process not found', () => {
      const sm = { getBackgroundProcess: jest.fn().mockReturnValue(null) } as any;

      const result = validateProcess(sm, 'p999');
      expect(result.process).toBeNull();
      expect(result.error).toBeDefined();
      expect(result.error!.content[0].text).toContain('p999');
    });
  });

  describe('formatRuntime', () => {
    it('should calculate runtime from start to end', () => {
      const proc = {
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T00:00:10Z'),
      } as any;

      expect(formatRuntime(proc)).toBe(10.0);
    });

    it('should use current time when endTime is not set', () => {
      const now = Date.now();
      const proc = {
        startTime: new Date(now - 5000),
        endTime: undefined,
      } as any;

      const runtime = formatRuntime(proc);
      expect(runtime).toBeGreaterThanOrEqual(4.9);
      expect(runtime).toBeLessThanOrEqual(6.0);
    });
  });

  describe('formatProcessInfo', () => {
    it('should format basic process info', async () => {
      const proc = {
        id: 'p1',
        command: 'echo',
        args: ['hello'],
        status: ProcessStatus.RUNNING,
        pid: 1234,
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-01T00:00:05Z'),
        exitCode: undefined,
        sessionId: 'sess1',
        resources: undefined,
      };
      const sm = { getSession: jest.fn<any>().mockResolvedValue({ name: 'my-session' }) } as any;

      const info = await formatProcessInfo(proc as any, sm);
      expect(info.id).toBe('p1');
      expect(info.command).toBe('echo');
      expect(info.status).toBe(ProcessStatus.RUNNING);
      expect(info.pid).toBe(1234);
      expect(info.session).toBe('my-session');
      expect(info.exitCode).toBeNull();
    });

    it('should include resource data when available', async () => {
      const proc = {
        id: 'p2',
        command: 'sleep',
        args: [],
        status: ProcessStatus.RUNNING,
        pid: 5678,
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: undefined,
        exitCode: undefined,
        sessionId: 'sess1',
        resources: {
          cpu: 12.5,
          memory: 1024,
          memoryPercent: 0.5,
          lastSampled: new Date('2024-01-01T00:00:10Z'),
          sampleCount: 3,
        },
      };
      const sm = { getSession: jest.fn<any>().mockResolvedValue(null) } as any;

      const info = await formatProcessInfo(proc as any, sm);
      expect(info.resources).toBeDefined();
      expect(info.resources.cpu).toBe(12.5);
      expect(info.resources.memory).toBe(1024);
      expect(info.session).toBe('sess1'); // falls back to sessionId
    });

    it('should add warning for orphaned processes', async () => {
      const proc = {
        id: 'p3',
        command: 'stale',
        args: [],
        status: ProcessStatus.ORPHANED,
        pid: null,
        startTime: new Date(),
        endTime: undefined,
        exitCode: undefined,
        sessionId: 'old',
        resources: undefined,
      };
      const sm = { getSession: jest.fn<any>().mockResolvedValue(null) } as any;

      const info = await formatProcessInfo(proc as any, sm);
      expect(info.warning).toBe('Process from previous server session');
    });
  });

  describe('killProcess', () => {
    it('should kill a normal process via sessionManager', () => {
      const proc = { status: ProcessStatus.RUNNING } as any;
      const sm = { killBackgroundProcess: jest.fn().mockReturnValue(true) } as any;

      const result = killProcess('p1', proc, 'SIGTERM', sm);
      expect(result.success).toBe(true);
      expect(result.message).toContain('SIGTERM');
      expect(sm.killBackgroundProcess).toHaveBeenCalledWith('p1', 'SIGTERM');
    });

    it('should return failure when kill fails', () => {
      const proc = { status: ProcessStatus.RUNNING } as any;
      const sm = { killBackgroundProcess: jest.fn().mockReturnValue(false) } as any;

      const result = killProcess('p1', proc, 'SIGKILL', sm);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed');
    });

    it('should handle orphaned processes with pid', () => {
      const proc = { status: ProcessStatus.ORPHANED, pid: 9999 } as any;
      const mockKill = jest.spyOn(global.process, 'kill').mockImplementation(() => true);
      const sm = { updateBackgroundProcess: jest.fn() } as any;

      const result = killProcess('p1', proc, 'SIGTERM', sm);
      expect(result.success).toBe(true);
      expect(result.message).toContain('orphaned');
      expect(sm.updateBackgroundProcess).toHaveBeenCalledWith('p1', expect.objectContaining({
        status: ProcessStatus.KILLED,
      }));

      mockKill.mockRestore();
    });

    it('should handle errors killing orphaned processes', () => {
      const proc = { status: ProcessStatus.ORPHANED, pid: 9999 } as any;
      const mockKill = jest.spyOn(global.process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH');
      });
      const sm = {} as any;

      const result = killProcess('p1', proc, 'SIGTERM', sm);
      expect(result.success).toBe(false);
      expect(result.message).toContain('ESRCH');

      mockKill.mockRestore();
    });
  });
});
