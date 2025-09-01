import { AICommandDedup } from './ai-dedup.js';

describe('AICommandDedup', () => {
  let dedup: AICommandDedup;
  
  beforeEach(() => {
    jest.useFakeTimers();
    dedup = new AICommandDedup();
  });
  
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  
  describe('Basic Deduplication', () => {
    it('should execute command once for duplicate requests', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      const promise1 = dedup.execute('ls -la', '/home', executor);
      const promise2 = dedup.execute('ls -la', '/home', executor);
      
      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(executor).toHaveBeenCalledTimes(1);
    });
    
    it('should execute different commands separately', async () => {
      const executor1 = jest.fn().mockResolvedValue('result1');
      const executor2 = jest.fn().mockResolvedValue('result2');
      
      const result1 = await dedup.execute('ls', '/home', executor1);
      const result2 = await dedup.execute('pwd', '/home', executor2);
      
      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(executor1).toHaveBeenCalledTimes(1);
      expect(executor2).toHaveBeenCalledTimes(1);
    });
    
    it('should execute same command in different directories', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      await dedup.execute('ls', '/home', executor);
      await dedup.execute('ls', '/tmp', executor);
      
      expect(executor).toHaveBeenCalledTimes(2);
    });
    
    it('should deduplicate within time window', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      await dedup.execute('ls', '/home', executor);
      
      // Within 10 second window
      jest.advanceTimersByTime(5000);
      await dedup.execute('ls', '/home', executor);
      
      expect(executor).toHaveBeenCalledTimes(1);
    });
    
    it('should not deduplicate after time window expires', async () => {
      const executor = jest.fn()
        .mockResolvedValueOnce('result1')
        .mockResolvedValueOnce('result2');
      
      await dedup.execute('ls', '/home', executor);
      
      // Advance past dedup window
      jest.advanceTimersByTime(11000);
      
      await dedup.execute('ls', '/home', executor);
      
      expect(executor).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('Command Normalization', () => {
    it('should normalize ls command variations', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      await dedup.execute('ls -la', '/home', executor);
      await dedup.execute('ls -al', '/home', executor); // Different order
      await dedup.execute('ls  -la', '/home', executor); // Extra space
      
      expect(executor).toHaveBeenCalledTimes(1);
    });
    
    it('should normalize git log variations', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      await dedup.execute('git log --oneline -5', '/repo', executor);
      await dedup.execute('git log --oneline -10', '/repo', executor);
      
      expect(executor).toHaveBeenCalledTimes(1);
    });
    
    it('should trim and normalize whitespace', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      await dedup.execute('  ls   -la  ', '/home', executor);
      await dedup.execute('ls -la', '/home', executor);
      
      expect(executor).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('Batching for High-Dedup Commands', () => {
    it('should batch high-dedup commands', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      // Start multiple ls commands concurrently
      const promises = [
        dedup.execute('ls', '/home', executor),
        dedup.execute('ls', '/home', executor),
        dedup.execute('ls', '/home', executor),
      ];
      
      // Advance timer to trigger batch wait
      jest.advanceTimersByTime(100);
      
      const results = await Promise.all(promises);
      
      expect(results).toEqual(['result', 'result', 'result']);
      expect(executor).toHaveBeenCalledTimes(1);
    });
    
    it('should not batch non-high-dedup commands', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      const promise1 = dedup.execute('custom-command', '/home', executor);
      const promise2 = dedup.execute('custom-command', '/home', executor);
      
      await Promise.all([promise1, promise2]);
      
      // Should still deduplicate but without batching delay
      expect(executor).toHaveBeenCalledTimes(1);
    });
    
    it('should recognize high-dedup commands', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      const highDedupCommands = [
        'ls', 'pwd', 'git status', 'git branch', 'npm list',
        'cat package.json', 'cat README.md', 'whoami', 'date'
      ];
      
      for (const cmd of highDedupCommands) {
        await dedup.execute(cmd, '/test', executor);
      }
      
      // Each should be executed once
      expect(executor).toHaveBeenCalledTimes(highDedupCommands.length);
    });
  });
  
  describe('Statistics', () => {
    it('should track deduplication statistics', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      // Execute same command 3 times
      await dedup.execute('ls', '/home', executor);
      await dedup.execute('ls', '/home', executor);
      await dedup.execute('ls', '/home', executor);
      
      // Execute different command
      await dedup.execute('pwd', '/home', executor);
      
      const stats = dedup.getStats();
      
      expect(stats.totalCommands).toBe(4);
      expect(stats.dedupedCommands).toBe(2);
      expect(stats.savedExecutions).toBe(2);
      expect(stats.dedupRate).toBeCloseTo(50);
    });
    
    it('should reset statistics', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      await dedup.execute('ls', '/home', executor);
      await dedup.execute('ls', '/home', executor);
      
      dedup.resetStats();
      
      const stats = dedup.getStats();
      expect(stats.totalCommands).toBe(0);
      expect(stats.dedupedCommands).toBe(0);
      expect(stats.savedExecutions).toBe(0);
    });
    
    it('should track current pending commands', async () => {
      const executor = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('result'), 1000))
      );
      
      const promise1 = dedup.execute('ls', '/home', executor);
      const promise2 = dedup.execute('pwd', '/tmp', executor);
      
      let stats = dedup.getStats();
      expect(stats.currentPending).toBe(2);
      
      jest.advanceTimersByTime(1000);
      await Promise.all([promise1, promise2]);
      
      // Still in dedup window
      stats = dedup.getStats();
      expect(stats.currentPending).toBe(2);
      
      // Clear after window expires
      jest.advanceTimersByTime(10000);
      stats = dedup.getStats();
      expect(stats.currentPending).toBe(0);
    });
  });
  
  describe('Event Emissions', () => {
    it('should emit dedup:hit event', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      const hitListener = jest.fn();
      
      dedup.on('dedup:hit', hitListener);
      
      await dedup.execute('ls', '/home', executor);
      await dedup.execute('ls', '/home', executor);
      
      expect(hitListener).toHaveBeenCalledWith({
        command: 'ls',
        cwd: '/home',
        waitingCount: 1,
        timeSaved: expect.any(Number),
      });
    });
    
    it('should track waiting count correctly', async () => {
      const executor = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('result'), 1000))
      );
      const hitListener = jest.fn();
      
      dedup.on('dedup:hit', hitListener);
      
      const promise1 = dedup.execute('ls', '/home', executor);
      const promise2 = dedup.execute('ls', '/home', executor);
      const promise3 = dedup.execute('ls', '/home', executor);
      
      jest.advanceTimersByTime(1000);
      await Promise.all([promise1, promise2, promise3]);
      
      expect(hitListener).toHaveBeenCalledTimes(2);
      expect(hitListener).toHaveBeenNthCalledWith(1, expect.objectContaining({
        waitingCount: 1,
      }));
      expect(hitListener).toHaveBeenNthCalledWith(2, expect.objectContaining({
        waitingCount: 2,
      }));
    });
  });
  
  describe('Command Coalescing', () => {
    it('should coalesce multiple similar commands', async () => {
      const executor = jest.fn().mockResolvedValue(['result1', 'result2', 'result3']);
      
      const commands = [
        { command: 'ls -la', cwd: '/home' },
        { command: 'ls', cwd: '/tmp' },
        { command: 'ls -l', cwd: '/var' },
      ];
      
      const results = await dedup.coalesceCommands(commands, executor);
      
      expect(results).toHaveLength(3);
      expect(executor).toHaveBeenCalledTimes(1);
      expect(executor).toHaveBeenCalledWith(['ls -la', 'ls', 'ls -l']);
    });
    
    it('should emit coalesce:batch event', async () => {
      const executor = jest.fn().mockResolvedValue(['result1', 'result2']);
      const batchListener = jest.fn();
      
      dedup.on('coalesce:batch', batchListener);
      
      const commands = [
        { command: 'cat file1.txt', cwd: '/home' },
        { command: 'cat file2.txt', cwd: '/home' },
      ];
      
      await dedup.coalesceCommands(commands, executor);
      
      expect(batchListener).toHaveBeenCalledWith({
        base: 'cat',
        count: 2,
      });
    });
    
    it('should not coalesce non-coalesceable commands', async () => {
      const executor = jest.fn().mockImplementation((cmds) => 
        cmds.map((c: string) => `result-${c}`)
      );
      
      const commands = [
        { command: 'npm install', cwd: '/home' },
        { command: 'npm test', cwd: '/home' },
      ];
      
      const results = await dedup.coalesceCommands(commands, executor);
      
      expect(results).toHaveLength(2);
      // Should execute individually, not as batch
      expect(executor).toHaveBeenCalledTimes(2);
    });
    
    it('should handle mixed coalesceable and non-coalesceable commands', async () => {
      const executor = jest.fn().mockImplementation((cmds) => 
        cmds.map((c: string) => `result-${c}`)
      );
      
      const commands = [
        { command: 'ls -la', cwd: '/home' },
        { command: 'ls', cwd: '/tmp' },
        { command: 'npm install', cwd: '/home' },
        { command: 'cat file.txt', cwd: '/home' },
      ];
      
      const results = await dedup.coalesceCommands(commands, executor);
      
      expect(results).toHaveLength(4);
      // ls commands batched, npm executed alone, cat executed alone
      expect(executor).toHaveBeenCalledTimes(3);
    });
    
    it('should update saved executions for coalesced commands', async () => {
      const executor = jest.fn().mockResolvedValue(['result1', 'result2', 'result3']);
      
      const commands = [
        { command: 'ls -la', cwd: '/home' },
        { command: 'ls', cwd: '/tmp' },
        { command: 'ls -l', cwd: '/var' },
      ];
      
      await dedup.coalesceCommands(commands, executor);
      
      const stats = dedup.getStats();
      expect(stats.savedExecutions).toBe(2); // Saved 2 executions by batching 3 commands
    });
  });
  
  describe('Cleanup', () => {
    it('should clean up old pending commands periodically', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      await dedup.execute('ls', '/home', executor);
      
      let stats = dedup.getStats();
      expect(stats.currentPending).toBe(1);
      
      // Advance past cleanup interval (30 seconds) and dedup window
      jest.advanceTimersByTime(31000);
      
      stats = dedup.getStats();
      expect(stats.currentPending).toBe(0);
    });
    
    it('should remove commands after dedup window expires', async () => {
      const executor = jest.fn()
        .mockResolvedValueOnce('result1')
        .mockResolvedValueOnce('result2');
      
      await dedup.execute('ls', '/home', executor);
      
      // Still in window
      jest.advanceTimersByTime(9000);
      await dedup.execute('ls', '/home', executor);
      expect(executor).toHaveBeenCalledTimes(1);
      
      // After window expires
      jest.advanceTimersByTime(2000); // Total 11 seconds
      await dedup.execute('ls', '/home', executor);
      expect(executor).toHaveBeenCalledTimes(2);
    });
  });
});
