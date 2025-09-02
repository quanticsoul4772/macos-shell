import { AICommandDedup } from './ai-dedup.js';

describe('AICommandDedup', () => {
  let dedup: AICommandDedup;
  
  beforeEach(() => {
    jest.useFakeTimers();
    dedup = new AICommandDedup();
  });
  
  afterEach(() => {
    dedup.dispose();
    jest.clearAllTimers();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  
  describe('Basic Deduplication', () => {
    it('should execute command once for duplicate requests', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      const promise1 = dedup.execute('ls -la', '/home', executor);
      const promise2 = dedup.execute('ls -la', '/home', executor);
      
      // ls -la is a high-dedup command, advance timers for batch wait
      jest.advanceTimersByTime(100);
      
      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(executor).toHaveBeenCalledTimes(1);
      
      // Clean up pending timers
      jest.clearAllTimers();
    });
    
    it('should execute different commands separately', async () => {
      const executor1 = jest.fn().mockResolvedValue('result1');
      const executor2 = jest.fn().mockResolvedValue('result2');
      
      // Both ls and pwd are high-dedup commands, so they trigger batching
      const promise1 = dedup.execute('ls', '/home', executor1);
      jest.advanceTimersByTime(100); // Advance past batch wait
      const result1 = await promise1;
      
      const promise2 = dedup.execute('pwd', '/home', executor2);
      jest.advanceTimersByTime(100); // Advance past batch wait
      const result2 = await promise2;
      
      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(executor1).toHaveBeenCalledTimes(1);
      expect(executor2).toHaveBeenCalledTimes(1);
      
      jest.clearAllTimers();
    });
    
    it('should execute same command in different directories', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      // ls is a high-dedup command, so it triggers batching
      const promise1 = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100); // Advance past batch wait
      await promise1;
      
      const promise2 = dedup.execute('ls', '/tmp', executor);
      jest.advanceTimersByTime(100); // Advance past batch wait
      await promise2;
      
      expect(executor).toHaveBeenCalledTimes(2);
      jest.clearAllTimers();
    });
    
    it('should deduplicate within time window', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      // First execution
      const promise1 = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100); // Advance past batch wait
      await promise1;
      
      // Within 10 second window
      jest.advanceTimersByTime(5000);
      
      // Second execution should be deduped
      const promise2 = dedup.execute('ls', '/home', executor);
      await promise2;
      
      expect(executor).toHaveBeenCalledTimes(1);
      jest.clearAllTimers();
    });
    
    it('should not deduplicate after time window expires', async () => {
      const executor = jest.fn()
        .mockResolvedValueOnce('result1')
        .mockResolvedValueOnce('result2');
      
      // First execution
      const promise1 = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100); // Advance past batch wait
      await promise1;
      
      // Advance past dedup window (10 seconds)
      jest.advanceTimersByTime(11000);
      
      // Second execution should not be deduped
      const promise2 = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100); // Advance past batch wait
      await promise2;
      
      expect(executor).toHaveBeenCalledTimes(2);
      jest.clearAllTimers();
    });
  });
  
  describe('Command Normalization', () => {
    it('should normalize ls command variations', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      // First execution
      const promise1 = dedup.execute('ls -la', '/home', executor);
      jest.advanceTimersByTime(100);
      await promise1;
      
      // These should all be deduped to the first one
      const promise2 = dedup.execute('ls -al', '/home', executor); // Different order
      const promise3 = dedup.execute('ls  -la', '/home', executor); // Extra space
      
      await Promise.all([promise2, promise3]);
      
      expect(executor).toHaveBeenCalledTimes(1);
      jest.clearAllTimers();
    });
    
    it('should normalize git log variations', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      // git log is not a high-dedup command, so no batch wait needed
      await dedup.execute('git log --oneline -5', '/repo', executor);
      await dedup.execute('git log --oneline -10', '/repo', executor);
      
      expect(executor).toHaveBeenCalledTimes(1);
      jest.clearAllTimers();
    });
    
    it('should trim and normalize whitespace', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      // First execution with extra whitespace
      const promise1 = dedup.execute('  ls   -la  ', '/home', executor);
      jest.advanceTimersByTime(100);
      await promise1;
      
      // Should be deduped
      const promise2 = dedup.execute('ls -la', '/home', executor);
      await promise2;
      
      expect(executor).toHaveBeenCalledTimes(1);
      jest.clearAllTimers();
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
      jest.clearAllTimers();
    });
    
    it('should not batch non-high-dedup commands', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      const promise1 = dedup.execute('custom-command', '/home', executor);
      const promise2 = dedup.execute('custom-command', '/home', executor);
      
      await Promise.all([promise1, promise2]);
      
      // Should still deduplicate but without batching delay
      expect(executor).toHaveBeenCalledTimes(1);
      jest.clearAllTimers();
    });
    
    it('should recognize high-dedup commands', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      const highDedupCommands = [
        'ls', 'pwd', 'git status', 'git branch', 'npm list',
        'cat package.json', 'cat README.md', 'whoami', 'date'
      ];
      
      for (const cmd of highDedupCommands) {
        const promise = dedup.execute(cmd, '/test', executor);
        jest.advanceTimersByTime(100); // Advance past batch wait for each
        await promise;
        jest.advanceTimersByTime(11000); // Move past dedup window for next command
      }
      
      // Each should be executed once
      expect(executor).toHaveBeenCalledTimes(highDedupCommands.length);
      jest.clearAllTimers();
    });
  });
  
  describe('Statistics', () => {
    it('should track deduplication statistics', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      // Execute same command 3 times
      const promise1 = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100);
      await promise1;
      
      await dedup.execute('ls', '/home', executor);
      await dedup.execute('ls', '/home', executor);
      
      // Execute different command
      const promise2 = dedup.execute('pwd', '/home', executor);
      jest.advanceTimersByTime(100);
      await promise2;
      
      const stats = dedup.getStats();
      
      expect(stats.totalCommands).toBe(4);
      expect(stats.dedupedCommands).toBe(2);
      expect(stats.savedExecutions).toBe(2);
      expect(stats.dedupRate).toBeCloseTo(50);
      jest.clearAllTimers();
    });
    
    it('should reset statistics', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      const promise1 = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100);
      await promise1;
      
      await dedup.execute('ls', '/home', executor);
      
      dedup.resetStats();
      
      const stats = dedup.getStats();
      expect(stats.totalCommands).toBe(0);
      expect(stats.dedupedCommands).toBe(0);
      expect(stats.savedExecutions).toBe(0);
      jest.clearAllTimers();
    });
    
    it('should track current pending commands', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      
      // Execute command and let it complete
      const promise1 = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100); // Advance past batch wait
      await promise1;
      
      // Should have 1 pending command in the dedup window
      let stats = dedup.getStats();
      expect(stats.currentPending).toBe(1);
      
      // Execute another command
      const promise2 = dedup.execute('pwd', '/tmp', executor);
      jest.advanceTimersByTime(100); // Advance past batch wait
      await promise2;
      
      // Should have 2 pending commands in the dedup window
      stats = dedup.getStats();
      expect(stats.currentPending).toBe(2);
      
      // Clear after window expires (10 seconds)
      jest.advanceTimersByTime(10000);
      stats = dedup.getStats();
      expect(stats.currentPending).toBe(0);
      
      jest.clearAllTimers();
    });
  });
  
  describe('Event Emissions', () => {
    it('should emit dedup:hit event', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      const hitListener = jest.fn();
      
      dedup.on('dedup:hit', hitListener);
      
      const promise1 = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100);
      await promise1;
      
      const promise2 = dedup.execute('ls', '/home', executor);
      await promise2;
      
      expect(hitListener).toHaveBeenCalledWith({
        command: 'ls',
        cwd: '/home',
        waitingCount: 1,
        timeSaved: expect.any(Number),
      });
      jest.clearAllTimers();
    });
    
    it('should track waiting count correctly', async () => {
      const executor = jest.fn().mockResolvedValue('result');
      const hitListener = jest.fn();
      
      dedup.on('dedup:hit', hitListener);
      
      // Start first command
      const promise1 = dedup.execute('ls', '/home', executor);
      
      // ls is a high-dedup command, wait for batch
      jest.advanceTimersByTime(100);
      await promise1;
      
      // Now execute duplicates within the dedup window
      const promise2 = dedup.execute('ls', '/home', executor);
      const promise3 = dedup.execute('ls', '/home', executor);
      
      await Promise.all([promise2, promise3]);
      
      // Should have 2 hits (promise2 and promise3 hit the cache from promise1)
      expect(hitListener).toHaveBeenCalledTimes(2);
      
      // Verify the hit events have proper data
      expect(hitListener).toHaveBeenCalledWith(expect.objectContaining({
        command: 'ls',
        cwd: '/home'
      }));
      
      jest.clearAllTimers();
    }, 30000); // Increase timeout significantly
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
        Promise.resolve(cmds.map((c: string) => `result-${c}`))
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
        Promise.resolve(cmds.map((c: string) => `result-${c}`))
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
      
      const promise = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100); // Advance past batch wait
      await promise;
      
      let stats = dedup.getStats();
      expect(stats.currentPending).toBe(1);
      
      // Advance past cleanup interval (30 seconds) and dedup window
      jest.advanceTimersByTime(31000);
      
      stats = dedup.getStats();
      expect(stats.currentPending).toBe(0);
    }, 15000);
    
    it('should remove commands after dedup window expires', async () => {
      const executor = jest.fn()
        .mockResolvedValueOnce('result1')
        .mockResolvedValueOnce('result2');
      
      const promise1 = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100);
      await promise1;
      
      // Still in window
      jest.advanceTimersByTime(9000);
      const promise2 = dedup.execute('ls', '/home', executor);
      await promise2;
      expect(executor).toHaveBeenCalledTimes(1);
      
      // After window expires
      jest.advanceTimersByTime(2000); // Total 11 seconds
      const promise3 = dedup.execute('ls', '/home', executor);
      jest.advanceTimersByTime(100);
      await promise3;
      expect(executor).toHaveBeenCalledTimes(2);
    });
  });
});
