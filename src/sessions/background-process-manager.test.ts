import { BackgroundProcessManager } from './background-process-manager';
import { ResourceMonitor } from '../resource-monitor';
import { SessionPersistence } from './session-persistence';
import { ShellSession, ProcessStatus, BackgroundProcess } from './session-types';
import { execa } from 'execa';
import { v4 as uuidv4 } from 'uuid';

jest.mock('execa');
jest.mock('uuid');
jest.mock('../resource-monitor');
jest.mock('./session-persistence');
jest.mock('../utils/logger', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  }))
}));

describe('BackgroundProcessManager', () => {
  let manager: BackgroundProcessManager;
  let mockResourceMonitor: jest.Mocked<ResourceMonitor>;
  let mockPersistence: jest.Mocked<SessionPersistence>;
  let mockSession: ShellSession;
  let mockExeca: jest.MockedFunction<typeof execa>;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Create mock instances
    mockResourceMonitor = {
      startMonitoring: jest.fn(),
      stopMonitoring: jest.fn(),
      stopAll: jest.fn(),
      getResources: jest.fn(),
      updateResources: jest.fn(),
      sampleProcesses: jest.fn().mockResolvedValue(new Map())
    } as any;

    mockPersistence = {
      saveProcess: jest.fn().mockResolvedValue(undefined),
      deleteProcessFile: jest.fn().mockResolvedValue(undefined),
      loadProcesses: jest.fn().mockResolvedValue(new Map())
    } as any;

    mockSession = {
      id: 'session-123',
      name: 'test-session',
      cwd: '/tmp',
      env: { TEST: 'true' },
      history: [],
      created: new Date(),
      lastUsed: new Date()
    };

    mockExeca = execa as jest.MockedFunction<typeof execa>;
    (uuidv4 as jest.MockedFunction<typeof uuidv4>).mockReturnValue('process-123' as any);

    manager = new BackgroundProcessManager(mockResourceMonitor, mockPersistence);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('startProcess', () => {
    it('should start a new background process', () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      const processId = manager.startProcess(mockSession, 'echo', ['hello'], { name: 'test-echo' });

      expect(processId).toBe('process-123');
      expect(mockExeca).toHaveBeenCalledWith('echo', ['hello'], expect.objectContaining({
        cwd: '/tmp',
        env: { TEST: 'true' },
        detached: true
      }));
      expect(mockResourceMonitor.startMonitoring).toHaveBeenCalledWith('process-123', 12345);
    });

    it('should handle process without PID', () => {
      const mockChildProcess = {
        pid: undefined,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      const processId = manager.startProcess(mockSession, 'echo', ['test']);

      expect(processId).toBe('process-123');
      expect(mockResourceMonitor.startMonitoring).not.toHaveBeenCalled();
    });

    it('should enforce session process limit', () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      // Create maximum allowed processes (50)
      for (let i = 0; i < 50; i++) {
        (uuidv4 as jest.MockedFunction<typeof uuidv4>).mockReturnValue(`process-${i}` as any);
        manager.startProcess(mockSession, 'echo', [`${i}`]);
      }

      // Should throw on exceeding limit
      expect(() => {
        manager.startProcess(mockSession, 'echo', ['too-many']);
      }).toThrow('Session has reached maximum process limit');
    });

    it('should handle process spawn failure', () => {
      mockExeca.mockImplementation(() => {
        throw new Error('Command not found');
      });

      const processId = manager.startProcess(mockSession, 'bad-command', []);
      const process = manager.getProcess(processId);

      expect(process?.status).toBe(ProcessStatus.FAILED);
    });
  });

  describe('getProcess', () => {
    it('should retrieve a process by ID', () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      const processId = manager.startProcess(mockSession, 'echo', ['test']);
      const process = manager.getProcess(processId);

      expect(process).toBeDefined();
      expect(process?.id).toBe(processId);
      expect(process?.command).toBe('echo');
    });

    it('should return undefined for non-existent process', () => {
      const process = manager.getProcess('non-existent');
      expect(process).toBeUndefined();
    });
  });

  describe('listProcesses', () => {
    it('should list all processes', () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      (uuidv4 as jest.MockedFunction<typeof uuidv4>).mockReturnValue('process-1' as any);
      manager.startProcess(mockSession, 'echo', ['1']);

      (uuidv4 as jest.MockedFunction<typeof uuidv4>).mockReturnValue('process-2' as any);
      manager.startProcess(mockSession, 'echo', ['2']);

      const processes = manager.listProcesses();
      expect(processes).toHaveLength(2);
    });

    it('should filter processes by session', () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      (uuidv4 as jest.MockedFunction<typeof uuidv4>).mockReturnValue('process-1' as any);
      manager.startProcess(mockSession, 'echo', ['1']);

      (uuidv4 as jest.MockedFunction<typeof uuidv4>).mockReturnValue('process-2' as any);
      manager.startProcess({ ...mockSession, id: 'session-456' }, 'echo', ['2']);

      const processes = manager.listProcesses('session-123');
      expect(processes).toHaveLength(1);
      expect(processes[0].sessionId).toBe('session-123');
    });
  });

  describe('killProcess', () => {
    it('should kill a running process', () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn().mockReturnValue(true),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      const processId = manager.startProcess(mockSession, 'echo', ['test']);
      const result = manager.killProcess(processId);

      expect(result).toBe(true);
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('should support SIGKILL', () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn().mockReturnValue(true),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      const processId = manager.startProcess(mockSession, 'echo', ['test']);
      const result = manager.killProcess(processId, 'SIGKILL');

      expect(result).toBe(true);
      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should return false for non-existent process', () => {
      const result = manager.killProcess('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('killSessionProcesses', () => {
    it('should kill all processes for a session', () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn().mockReturnValue(true),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      (uuidv4 as jest.MockedFunction<typeof uuidv4>).mockReturnValue('process-1' as any);
      manager.startProcess(mockSession, 'echo', ['1']);

      (uuidv4 as jest.MockedFunction<typeof uuidv4>).mockReturnValue('process-2' as any);
      manager.startProcess(mockSession, 'echo', ['2']);

      (uuidv4 as jest.MockedFunction<typeof uuidv4>).mockReturnValue('process-3' as any);
      manager.startProcess({ ...mockSession, id: 'other-session' }, 'echo', ['3']);

      manager.killSessionProcesses('session-123');

      expect(mockChildProcess.kill).toHaveBeenCalledTimes(2); // Only session-123 processes
    });
  });

  describe('resource monitoring', () => {
    it('should sample resources for running processes', async () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      manager.startProcess(mockSession, 'echo', ['1']);

      const mockSamples = new Map([
        [12345, { pid: 12345, cpu: 10, memory: 100, memoryPercent: 1.5 }]
      ]);
      mockResourceMonitor.sampleProcesses.mockResolvedValue(mockSamples);
      mockResourceMonitor.updateResources.mockReturnValue({
        cpu: 10,
        memory: 100,
        memoryPercent: 1.5,
        lastSampled: new Date(),
        sampleCount: 1
      });

      // Trigger resource sampling
      jest.advanceTimersByTime(5000);
      await Promise.resolve();

      expect(mockResourceMonitor.sampleProcesses).toHaveBeenCalledWith([12345]);
    });
  });

  describe('cleanup', () => {
    it('should cleanup all resources on shutdown', async () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      manager.startProcess(mockSession, 'echo', ['test']);

      await manager.cleanup();

      expect(mockChildProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockResourceMonitor.stopAll).toHaveBeenCalled();
    });
  });

  describe('getProcessesWithResources', () => {
    it('should return processes with resource information', () => {
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        kill: jest.fn(),
        catch: jest.fn()
      };

      mockExeca.mockReturnValue(mockChildProcess as any);

      manager.startProcess(mockSession, 'echo', ['test']);

      mockResourceMonitor.getResources.mockReturnValue({
        cpu: 5,
        memory: 50,
        memoryPercent: 0.5,
        lastSampled: new Date(),
        sampleCount: 1
      });

      const processes = manager.getProcessesWithResources();

      expect(processes).toHaveLength(1);
      expect(processes[0].resources).toBeDefined();
      expect(processes[0].resourcesSampled).toBe(true);
    });
  });

  describe('loadProcesses', () => {
    it('should load processes from persistence', async () => {
      const mockProcess: BackgroundProcess = {
        id: 'loaded-process',
        sessionId: 'session-123',
        command: 'echo',
        args: ['loaded'],
        pid: null,
        status: ProcessStatus.STOPPED,
        startTime: new Date(),
        outputBuffer: {} as any,
        metadata: {
          cwd: '/tmp',
          env: {}
        },
        endTime: new Date(),
        exitCode: 0
      };

      const loadedProcesses = new Map([['loaded-process', mockProcess]]);
      mockPersistence.loadProcesses.mockResolvedValue(loadedProcesses);

      await manager.loadProcesses();

      const process = manager.getProcess('loaded-process');
      expect(process).toBeDefined();
      expect(process?.command).toBe('echo');
    });
  });
});