// Session Manager Test Suite
// Tests session management, history, and background process orchestration

import { SessionManager } from './session-manager.js';
import { SessionPersistence } from './sessions/session-persistence.js';
import { BackgroundProcessManager } from './sessions/background-process-manager.js';
import { CommandHistoryManager } from './sessions/command-history-manager.js';
import { ResourceMonitor } from './resource-monitor.js';
import { Debouncer } from './utils/debouncer.js';
import { ProcessStatus } from './background-process.js';
import { v4 as uuidv4 } from 'uuid';

// Mock all dependencies
jest.mock('./sessions/session-persistence');
jest.mock('./sessions/background-process-manager');
jest.mock('./sessions/command-history-manager');
jest.mock('./resource-monitor');
jest.mock('./utils/debouncer');
jest.mock('uuid');
jest.mock('./utils/logger', () => ({
  getLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }))
}));

describe('SessionManager', () => {
  let manager: SessionManager;
  let mockPersistence: jest.Mocked<SessionPersistence>;
  let mockProcessManager: jest.Mocked<BackgroundProcessManager>;
  let mockHistoryManager: jest.Mocked<CommandHistoryManager>;
  let mockResourceMonitor: jest.Mocked<ResourceMonitor>;
  let mockDebouncer: jest.Mocked<Debouncer<any>>;
  
  const mockUuidv4 = uuidv4 as jest.MockedFunction<typeof uuidv4>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Setup UUID mock to return predictable IDs
    let uuidCounter = 0;
    (mockUuidv4 as jest.Mock).mockImplementation(() => {
      return `test-id-${++uuidCounter}`;
    });
    
    // Setup persistence mock
    mockPersistence = {
      initialize: jest.fn().mockResolvedValue(undefined),
      loadSessions: jest.fn().mockResolvedValue([]),
      saveSession: jest.fn().mockResolvedValue(undefined),
      deleteSessionFile: jest.fn().mockResolvedValue(undefined)
    } as any;
    (SessionPersistence as jest.MockedClass<typeof SessionPersistence>).mockImplementation(() => mockPersistence);
    
    // Setup process manager mock
    mockProcessManager = {
      loadProcesses: jest.fn().mockResolvedValue(undefined),
      killSessionProcesses: jest.fn(),
      startProcess: jest.fn(),
      getProcess: jest.fn(),
      listProcesses: jest.fn().mockReturnValue([]),
      updateProcess: jest.fn(),
      killProcess: jest.fn(),
      getSessionProcessCount: jest.fn().mockReturnValue(0),
      getProcessesWithResources: jest.fn().mockReturnValue([]),
      cleanup: jest.fn().mockResolvedValue(undefined)
    } as any;
    (BackgroundProcessManager as jest.MockedClass<typeof BackgroundProcessManager>).mockImplementation(() => mockProcessManager);
    
    // Setup history manager mock
    mockHistoryManager = {
      addToHistory: jest.fn(),
      getRecentHistory: jest.fn().mockReturnValue([]),
      searchHistory: jest.fn().mockReturnValue([])
    } as any;
    (CommandHistoryManager as jest.MockedClass<typeof CommandHistoryManager>).mockImplementation(() => mockHistoryManager);
    
    // Setup resource monitor mock
    mockResourceMonitor = {} as any;
    (ResourceMonitor as jest.MockedClass<typeof ResourceMonitor>).mockImplementation(() => mockResourceMonitor);
    
    // Setup debouncer mock
    mockDebouncer = {
      schedule: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined)
    } as any;
    (Debouncer as jest.MockedClass<typeof Debouncer>).mockImplementation(() => mockDebouncer);
    
    // Create manager instance
    manager = new SessionManager();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with default session', async () => {
      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Verify initialization was called
      expect(mockPersistence.initialize).toHaveBeenCalledTimes(1);
      expect(mockPersistence.loadSessions).toHaveBeenCalledTimes(1);
      expect(mockProcessManager.loadProcesses).toHaveBeenCalledTimes(1);
      
      // Should have created a default session
      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].name).toBe('default');
    });

    it('should load existing sessions on initialization', async () => {
      // Setup mock to return existing sessions
      const existingSessions = [
        {
          id: 'existing-1',
          name: 'default',
          cwd: '/home/user',
          env: {},
          history: [],
          created: new Date(),
          lastUsed: new Date()
        },
        {
          id: 'existing-2',
          name: 'project',
          cwd: '/home/user/project',
          env: {},
          history: [],
          created: new Date(),
          lastUsed: new Date()
        }
      ];
      mockPersistence.loadSessions.mockResolvedValueOnce(existingSessions);
      
      // Create new manager
      const newManager = new SessionManager();
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should have loaded the sessions
      const sessions = newManager.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions.find(s => s.name === 'default')).toBeDefined();
      expect(sessions.find(s => s.name === 'project')).toBeDefined();
    });

    it('should handle initialization errors gracefully', async () => {
      // Setup mock to throw error
      mockPersistence.initialize.mockRejectedValueOnce(new Error('Init failed'));
      
      // Create new manager
      const newManager = new SessionManager();
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should still create default session on error
      const sessions = newManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].name).toBe('default');
    });
  });

  describe('Session Management', () => {
    beforeEach(async () => {
      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should create a new session', () => {
      // Act
      const sessionId = manager.createSession('test-session', '/test/path');
      
      // Assert
      expect(sessionId).toBe('test-id-2'); // First ID is for default session
      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(2);
      
      const newSession = sessions.find(s => s.name === 'test-session');
      expect(newSession).toBeDefined();
      expect(newSession?.cwd).toBe('/test/path');
      
      // Should schedule save
      expect(mockDebouncer.schedule).toHaveBeenCalled();
    });

    it('should get session by ID', async () => {
      // Arrange
      const sessionId = manager.createSession('test-session');
      
      // Act
      const session = await manager.getSession(sessionId);
      
      // Assert
      expect(session).toBeDefined();
      expect(session?.name).toBe('test-session');
    });

    it('should get session by name', async () => {
      // Arrange
      manager.createSession('named-session');
      
      // Act
      const session = await manager.getSession('named-session');
      
      // Assert
      expect(session).toBeDefined();
      expect(session?.name).toBe('named-session');
    });

    it('should return default session when no ID provided', async () => {
      // Act
      const session = await manager.getSession();
      
      // Assert
      expect(session).toBeDefined();
      expect(session?.name).toBe('default');
    });

    it('should update a session', () => {
      // Arrange
      const sessionId = manager.createSession('update-test');
      
      // Act
      manager.updateSession(sessionId, {
        cwd: '/new/path',
        env: { TEST: 'value' }
      });
      
      // Assert
      const sessions = manager.listSessions();
      const updated = sessions.find(s => s.id === sessionId);
      expect(updated?.cwd).toBe('/new/path');
      expect(updated?.env.TEST).toBe('value');
      expect(mockDebouncer.schedule).toHaveBeenCalled();
    });

    it('should delete a session', async () => {
      // Arrange
      const sessionId = manager.createSession('to-delete');
      
      // Act
      const deleted = await manager.deleteSession(sessionId);
      
      // Assert
      expect(deleted).toBe(true);
      expect(mockProcessManager.killSessionProcesses).toHaveBeenCalledWith(sessionId);
      expect(mockPersistence.deleteSessionFile).toHaveBeenCalledWith(sessionId);
      
      const sessions = manager.listSessions();
      expect(sessions.find(s => s.id === sessionId)).toBeUndefined();
    });

    it('should not delete default session', async () => {
      // Act
      const deleted = await manager.deleteSession('default');
      
      // Assert
      expect(deleted).toBe(false);
      expect(mockPersistence.deleteSessionFile).not.toHaveBeenCalled();
      
      // Default session should still exist
      const session = await manager.getSession('default');
      expect(session).toBeDefined();
    });

    it('should list all sessions', () => {
      // Arrange
      manager.createSession('session-1');
      manager.createSession('session-2');
      manager.createSession('session-3');
      
      // Act
      const sessions = manager.listSessions();
      
      // Assert
      expect(sessions).toHaveLength(4); // 3 + default
      expect(sessions.map(s => s.name)).toContain('default');
      expect(sessions.map(s => s.name)).toContain('session-1');
      expect(sessions.map(s => s.name)).toContain('session-2');
      expect(sessions.map(s => s.name)).toContain('session-3');
    });
  });

  describe('History Management', () => {
    let sessionId: string;
    
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      sessionId = manager.createSession('history-test');
    });

    it('should add command to history', () => {
      // Arrange
      const historyEntry = {
        command: 'ls',
        args: ['-la'],
        exitCode: 0,
        stdout: 'output',
        stderr: '',
        duration: 100,
        startTime: new Date()
      };
      
      // Act
      manager.addToHistory(sessionId, historyEntry);
      
      // Assert
      expect(mockHistoryManager.addToHistory).toHaveBeenCalledWith(
        expect.objectContaining({ id: sessionId }),
        historyEntry
      );
      expect(mockDebouncer.schedule).toHaveBeenCalled();
    });

    it('should get recent history', () => {
      // Arrange
      const mockHistory = [
        { command: 'ls', exitCode: 0 },
        { command: 'pwd', exitCode: 0 }
      ];
      mockHistoryManager.getRecentHistory.mockReturnValueOnce(mockHistory as any);
      
      // Act
      const history = manager.getHistory(sessionId, 10);
      
      // Assert
      expect(mockHistoryManager.getRecentHistory).toHaveBeenCalledWith(
        expect.objectContaining({ id: sessionId }),
        10
      );
      expect(history).toEqual(mockHistory);
    });

    it('should search history by pattern', () => {
      // Arrange
      const mockResults = [
        { command: 'git status', exitCode: 0 },
        { command: 'git commit', exitCode: 0 }
      ];
      mockHistoryManager.searchHistory.mockReturnValueOnce(mockResults as any);
      
      // Act
      const results = manager.searchHistory(sessionId, 'git');
      
      // Assert
      expect(mockHistoryManager.searchHistory).toHaveBeenCalledWith(
        expect.objectContaining({ id: sessionId }),
        'git'
      );
      expect(results).toEqual(mockResults);
    });

    it('should return empty array for non-existent session', () => {
      // Act
      const history = manager.getHistory('non-existent', 10);
      const searchResults = manager.searchHistory('non-existent', 'test');
      
      // Assert
      expect(history).toEqual([]);
      expect(searchResults).toEqual([]);
    });
  });

  describe('Background Process Management', () => {
    let sessionId: string;
    
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      sessionId = manager.createSession('process-test');
    });

    it('should start a background process', () => {
      // Arrange
      mockProcessManager.startProcess.mockReturnValueOnce('process-123');
      
      // Act
      const processId = manager.startBackgroundProcess(
        sessionId,
        'npm',
        ['run', 'watch'],
        { name: 'watcher' }
      );
      
      // Assert
      expect(processId).toBe('process-123');
      expect(mockProcessManager.startProcess).toHaveBeenCalledWith(
        expect.objectContaining({ id: sessionId }),
        'npm',
        ['run', 'watch'],
        { name: 'watcher' }
      );
    });

    it('should return null for non-existent session', () => {
      // Act
      const processId = manager.startBackgroundProcess(
        'non-existent',
        'npm',
        ['run', 'watch']
      );
      
      // Assert
      expect(processId).toBeNull();
      expect(mockProcessManager.startProcess).not.toHaveBeenCalled();
    });

    it('should get a background process', () => {
      // Arrange
      const mockProcess = { id: 'process-123', command: 'npm' };
      mockProcessManager.getProcess.mockReturnValueOnce(mockProcess as any);
      
      // Act
      const process = manager.getBackgroundProcess('process-123');
      
      // Assert
      expect(process).toEqual(mockProcess);
      expect(mockProcessManager.getProcess).toHaveBeenCalledWith('process-123');
    });

    it('should list background processes', () => {
      // Arrange
      const mockProcesses = [
        { id: 'p1', command: 'npm' },
        { id: 'p2', command: 'node' }
      ];
      mockProcessManager.listProcesses.mockReturnValueOnce(mockProcesses as any);
      
      // Act
      const processes = manager.listBackgroundProcesses(sessionId);
      
      // Assert
      expect(processes).toEqual(mockProcesses);
      expect(mockProcessManager.listProcesses).toHaveBeenCalledWith(sessionId);
    });

    it('should update a background process', () => {
      // Act
      manager.updateBackgroundProcess('process-123', { status: ProcessStatus.RUNNING });
      
      // Assert
      expect(mockProcessManager.updateProcess).toHaveBeenCalledWith(
        'process-123',
        { status: ProcessStatus.RUNNING }
      );
    });

    it('should kill a background process', () => {
      // Arrange
      mockProcessManager.killProcess.mockReturnValueOnce(true);
      
      // Act
      const killed = manager.killBackgroundProcess('process-123', 'SIGKILL');
      
      // Assert
      expect(killed).toBe(true);
      expect(mockProcessManager.killProcess).toHaveBeenCalledWith('process-123', 'SIGKILL');
    });

    it('should get session process count', () => {
      // Arrange
      mockProcessManager.getSessionProcessCount.mockReturnValueOnce(5);
      
      // Act
      const count = manager.getSessionProcessCount(sessionId);
      
      // Assert
      expect(count).toBe(5);
      expect(mockProcessManager.getSessionProcessCount).toHaveBeenCalledWith(sessionId);
    });

    it('should get processes with resources', () => {
      // Arrange
      const mockProcessesWithResources = [
        { id: 'p1', resourcesSampled: true, samplingInterval: 1000 }
      ];
      mockProcessManager.getProcessesWithResources.mockReturnValueOnce(mockProcessesWithResources as any);
      
      // Act
      const processes = manager.getBackgroundProcessesWithResources();
      
      // Assert
      expect(processes).toEqual(mockProcessesWithResources);
    });
  });

  describe('Cleanup Operations', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should flush pending saves', async () => {
      // Act
      await manager.flushPendingSaves();
      
      // Assert
      expect(mockDebouncer.flush).toHaveBeenCalled();
    });

    it('should cleanup on shutdown', async () => {
      // Act
      await manager.cleanup();
      
      // Assert
      expect(mockProcessManager.cleanup).toHaveBeenCalled();
      expect(mockDebouncer.flush).toHaveBeenCalled();
    });
  });

  describe('Backward Compatibility', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should provide runningProcesses map', () => {
      // Arrange
      const mockProcesses = [
        { id: 'p1', process: { pid: 123 } },
        { id: 'p2', process: { pid: 456 } }
      ];
      mockProcessManager.listProcesses.mockReturnValueOnce(mockProcesses as any);
      
      // Act
      const runningProcesses = manager.runningProcesses;
      
      // Assert
      expect(runningProcesses).toBeInstanceOf(Map);
      expect(runningProcesses.size).toBe(2);
      expect(runningProcesses.get('p1')).toEqual({ pid: 123 });
      expect(runningProcesses.get('p2')).toEqual({ pid: 456 });
    });

    it('should provide backgroundProcesses map', () => {
      // Arrange
      const mockProcesses = [
        { id: 'p1', command: 'npm' },
        { id: 'p2', command: 'node' }
      ];
      mockProcessManager.listProcesses.mockReturnValueOnce(mockProcesses as any);
      
      // Act
      const backgroundProcesses = manager.backgroundProcesses;
      
      // Assert
      expect(backgroundProcesses).toBeInstanceOf(Map);
      expect(backgroundProcesses.size).toBe(2);
      expect(backgroundProcesses.get('p1')).toEqual({ id: 'p1', command: 'npm' });
      expect(backgroundProcesses.get('p2')).toEqual({ id: 'p2', command: 'node' });
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should handle process start errors', () => {
      // Arrange
      const sessionId = manager.createSession('error-test');
      mockProcessManager.startProcess.mockImplementation(() => {
        throw new Error('Failed to start');
      });
      
      // Act & Assert
      expect(() => {
        manager.startBackgroundProcess(sessionId, 'bad-command', []);
      }).toThrow('Failed to start');
    });

    it('should handle missing session in addToHistory', () => {
      // Act - Should not throw
      expect(() => {
        manager.addToHistory('non-existent', { command: 'test' } as any);
      }).not.toThrow();
      
      // Assert - History manager should not be called
      expect(mockHistoryManager.addToHistory).not.toHaveBeenCalled();
    });

    it('should handle missing session in updateSession', () => {
      // Clear any previous calls
      jest.clearAllMocks();
      
      // Act - Should not throw
      expect(() => {
        manager.updateSession('non-existent', { cwd: '/new/path' });
      }).not.toThrow();
      
      // Assert - Debouncer should not be called for non-existent session
      expect(mockDebouncer.schedule).not.toHaveBeenCalled();
    });
  });
});
