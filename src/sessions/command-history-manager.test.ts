import { CommandHistoryManager } from './command-history-manager';
import { ShellSession, CommandHistory } from './session-types';

describe('CommandHistoryManager', () => {
  let manager: CommandHistoryManager;
  let mockSession: ShellSession;

  beforeEach(() => {
    manager = new CommandHistoryManager();
    mockSession = {
      id: 'test-session',
      name: 'Test Session',
      cwd: '/tmp',
      env: {},
      history: [],
      created: new Date(),
      lastUsed: new Date()
    };
  });

  describe('addToHistory', () => {
    it('should add command to session history', () => {
      const history: CommandHistory = {
        command: 'echo',
        args: ['hello'],
        exitCode: 0,
        stdout: 'hello',
        stderr: '',
        startTime: new Date(),
        duration: 100
      };

      manager.addToHistory(mockSession, history);

      expect(mockSession.history).toHaveLength(1);
      expect(mockSession.history[0]).toEqual(history);
    });

    it('should update lastUsed timestamp', () => {
      const oldTimestamp = mockSession.lastUsed;
      const history: CommandHistory = {
        command: 'ls',
        args: [],
        exitCode: 0,
        stdout: '',
        stderr: '',
        startTime: new Date(),
        duration: 50
      };

      // Wait a bit to ensure timestamp difference
      jest.advanceTimersByTime(100);
      
      manager.addToHistory(mockSession, history);

      expect(mockSession.lastUsed.getTime()).toBeGreaterThan(oldTimestamp.getTime());
    });

    it('should limit history to configured maximum', () => {
      // Add many commands to exceed limit
      for (let i = 0; i < 1100; i++) {
        const history: CommandHistory = {
          command: `cmd${i}`,
          args: [],
          exitCode: 0,
          stdout: '',
          stderr: '',
          startTime: new Date(),
          duration: 10
        };
        manager.addToHistory(mockSession, history);
      }

      // Should keep only last 1000 (default limit)
      expect(mockSession.history.length).toBeLessThanOrEqual(1000);
      expect(mockSession.history[0].command).toBe('cmd100'); // First kept command
    });
  });

  describe('getRecentHistory', () => {
    beforeEach(() => {
      // Add some test history
      for (let i = 0; i < 20; i++) {
        mockSession.history.push({
          command: `cmd${i}`,
          args: [],
          exitCode: 0,
          stdout: '',
          stderr: '',
          startTime: new Date(),
          duration: 10
        });
      }
    });

    it('should return last 10 commands by default', () => {
      const recent = manager.getRecentHistory(mockSession);

      expect(recent).toHaveLength(10);
      expect(recent[0].command).toBe('cmd10');
      expect(recent[9].command).toBe('cmd19');
    });

    it('should return specified number of commands', () => {
      const recent = manager.getRecentHistory(mockSession, 5);

      expect(recent).toHaveLength(5);
      expect(recent[0].command).toBe('cmd15');
      expect(recent[4].command).toBe('cmd19');
    });

    it('should handle limit larger than history', () => {
      const recent = manager.getRecentHistory(mockSession, 100);

      expect(recent).toHaveLength(20);
    });

    it('should handle empty history', () => {
      mockSession.history = [];
      const recent = manager.getRecentHistory(mockSession);

      expect(recent).toHaveLength(0);
    });
  });

  describe('searchHistory', () => {
    beforeEach(() => {
      mockSession.history = [
        {
          command: 'git',
          args: ['status'],
          exitCode: 0,
          stdout: '',
          stderr: '',
          startTime: new Date(),
          duration: 10
        },
        {
          command: 'echo',
          args: ['hello', 'world'],
          exitCode: 0,
          stdout: '',
          stderr: '',
          startTime: new Date(),
          duration: 5
        },
        {
          command: 'git',
          args: ['commit', '-m', 'test'],
          exitCode: 0,
          stdout: '',
          stderr: '',
          startTime: new Date(),
          duration: 20
        },
        {
          command: 'ls',
          args: ['-la'],
          exitCode: 0,
          stdout: '',
          stderr: '',
          startTime: new Date(),
          duration: 15
        }
      ];
    });

    it('should find commands matching string pattern', () => {
      const results = manager.searchHistory(mockSession, 'git');

      expect(results).toHaveLength(2);
      expect(results[0].command).toBe('git');
      expect(results[1].command).toBe('git');
    });

    it('should find commands matching regex pattern', () => {
      const results = manager.searchHistory(mockSession, /^git/);

      expect(results).toHaveLength(2);
    });

    it('should search case-insensitively for strings', () => {
      const results = manager.searchHistory(mockSession, 'ECHO');

      expect(results).toHaveLength(1);
      expect(results[0].command).toBe('echo');
    });

    it('should search including arguments', () => {
      const results = manager.searchHistory(mockSession, 'hello world');

      expect(results).toHaveLength(1);
      expect(results[0].command).toBe('echo');
    });

    it('should return empty array for no matches', () => {
      const results = manager.searchHistory(mockSession, 'npm');

      expect(results).toHaveLength(0);
    });
  });

  describe('getHistoryStats', () => {
    beforeEach(() => {
      mockSession.history = [
        {
          command: 'git',
          args: ['status'],
          exitCode: 0,
          stdout: '',
          stderr: '',
          startTime: new Date(),
          duration: 100
        },
        {
          command: 'git',
          args: ['commit'],
          exitCode: 1,
          stdout: '',
          stderr: 'error',
          startTime: new Date(),
          duration: 200
        },
        {
          command: 'echo',
          args: ['test'],
          exitCode: 0,
          stdout: 'test',
          stderr: '',
          startTime: new Date(),
          duration: 50
        },
        {
          command: 'git',
          args: ['push'],
          exitCode: 0,
          stdout: '',
          stderr: '',
          startTime: new Date(),
          duration: 150
        }
      ];
    });

    it('should calculate correct statistics', () => {
      const stats = manager.getHistoryStats(mockSession);

      expect(stats.totalCommands).toBe(4);
      expect(stats.successfulCommands).toBe(3);
      expect(stats.failedCommands).toBe(1);
      expect(stats.averageDuration).toBe(125); // (100+200+50+150)/4
    });

    it('should identify most used commands', () => {
      const stats = manager.getHistoryStats(mockSession);

      expect(stats.mostUsedCommands).toBeDefined();
      expect(stats.mostUsedCommands[0]).toEqual({ command: 'git', count: 3 });
      expect(stats.mostUsedCommands[1]).toEqual({ command: 'echo', count: 1 });
    });

    it('should handle empty history', () => {
      mockSession.history = [];
      const stats = manager.getHistoryStats(mockSession);

      expect(stats.totalCommands).toBe(0);
      expect(stats.successfulCommands).toBe(0);
      expect(stats.failedCommands).toBe(0);
      expect(stats.averageDuration).toBe(0);
      expect(stats.mostUsedCommands).toHaveLength(0);
    });
  });

  describe('clearHistory', () => {
    it('should clear all history from session', () => {
      mockSession.history = [
        {
          command: 'test',
          args: [],
          exitCode: 0,
          stdout: '',
          stderr: '',
          startTime: new Date(),
          duration: 10
        }
      ];

      manager.clearHistory(mockSession);

      expect(mockSession.history).toHaveLength(0);
    });
  });
});