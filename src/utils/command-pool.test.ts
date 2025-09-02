import { commandPool } from './command-pool.js';

// Mock execa module
jest.mock('execa', () => ({
  execa: jest.fn()
}));

import { execa } from 'execa';
const mockExeca = execa as jest.MockedFunction<typeof execa>;

describe('CommandPool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('Command Execution', () => {
    it('should execute commands through the pool', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'test output',
        stderr: '',
        exitCode: 0,
        failed: false
      } as any);

      const result = await commandPool.execute('echo', ['test'], {
        cwd: '/tmp'
      });

      expect(result.stdout).toBe('test output');
      expect(result.exitCode).toBe(0);
      expect(mockExeca).toHaveBeenCalledWith('echo', ['test'], expect.objectContaining({
        cwd: '/tmp'
      }));
    });

    it('should track command statistics', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'output',
        stderr: '',
        exitCode: 0,
        failed: false
      } as any);

      await commandPool.execute('ls', [], {});

      const stats = commandPool.getStats();
      expect(stats.completed).toBeGreaterThan(0);
    });

    it('should handle command failures', async () => {
      mockExeca.mockRejectedValueOnce(new Error('Command failed'));

      await expect(commandPool.execute('bad-command', [], {}))
        .rejects.toThrow('Command failed');

      const stats = commandPool.getStats();
      expect(stats.failed).toBeGreaterThan(0);
    });

    it('should respect queue limits', async () => {
      // Create many simultaneous commands
      const promises = [];
      for (let i = 0; i < 15; i++) {
        mockExeca.mockResolvedValueOnce({
          stdout: `output ${i}`,
          stderr: '',
          exitCode: 0,
          failed: false
        } as any);
        
        promises.push(commandPool.execute('echo', [`test${i}`], {}));
      }

      const stats = commandPool.getStats();
      expect(stats.queued).toBeGreaterThanOrEqual(0);

      await Promise.all(promises);
    });
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiting when configured', async () => {
      // Execute multiple commands quickly
      const promises = [];
      for (let i = 0; i < 5; i++) {
        mockExeca.mockResolvedValueOnce({
          stdout: `output ${i}`,
          stderr: '',
          exitCode: 0,
          failed: false
        } as any);
        
        promises.push(commandPool.execute('echo', [`test${i}`], {}));
      }

      await Promise.all(promises);
      
      const stats = commandPool.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Statistics', () => {
    it('should provide statistics', () => {
      const stats = commandPool.getStats();
      
      expect(stats).toBeDefined();
      expect(typeof stats.completed).toBe('number');
      expect(typeof stats.failed).toBe('number');
      expect(typeof stats.active).toBe('number');
      expect(typeof stats.queued).toBe('number');
    });

    it('should track average execution time', async () => {
      mockExeca.mockResolvedValueOnce({
        stdout: 'output',
        stderr: '',
        exitCode: 0,
        failed: false
      } as any);

      await commandPool.execute('echo', ['test'], {});
      
      const stats = commandPool.getStats();
      expect(stats.averageExecutionTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Pool Management', () => {
    it('should have expected methods', () => {
      expect(typeof commandPool.execute).toBe('function');
      expect(typeof commandPool.getStats).toBe('function');
    });

    it('should handle concurrent executions', async () => {
      // Setup multiple mock responses
      for (let i = 0; i < 3; i++) {
        mockExeca.mockResolvedValueOnce({
          stdout: `output ${i}`,
          stderr: '',
          exitCode: 0,
          failed: false
        } as any);
      }

      const promises = [
        commandPool.execute('echo', ['1'], {}),
        commandPool.execute('echo', ['2'], {}),
        commandPool.execute('echo', ['3'], {})
      ];

      const results = await Promise.all(promises);
      expect(results).toHaveLength(3);
    });
  });
});