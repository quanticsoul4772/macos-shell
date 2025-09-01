import { RequestDeduplicator, CommandDeduplicator, FileOperationDeduplicator } from './request-deduplicator';

describe('RequestDeduplicator', () => {
  let deduplicator: RequestDeduplicator;
  
  beforeEach(() => {
    jest.useFakeTimers();
    deduplicator = new RequestDeduplicator({
      ttl: 1000,
      maxSize: 3,
    });
  });
  
  afterEach(() => {
    deduplicator.dispose();
    jest.useRealTimers();
  });
  
  describe('Basic Functionality', () => {
    it('should execute function and return result', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      
      const result = await deduplicator.execute(fn, 'key1');
      
      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });
    
    it('should deduplicate concurrent identical requests', async () => {
      const fn = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('result'), 100))
      );
      
      // Start two identical requests concurrently
      const promise1 = deduplicator.execute(fn, 'key1');
      const promise2 = deduplicator.execute(fn, 'key1');
      
      // Fast-forward timers
      jest.advanceTimersByTime(100);
      
      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      expect(result1).toBe('result');
      expect(result2).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1); // Should only execute once
    });
    
    it('should execute different requests separately', async () => {
      const fn = jest.fn().mockImplementation((key: string) => 
        Promise.resolve(`result-${key}`)
      );
      
      const result1 = await deduplicator.execute(() => fn('1'), 'key1');
      const result2 = await deduplicator.execute(() => fn('2'), 'key2');
      
      expect(result1).toBe('result-1');
      expect(result2).toBe('result-2');
      expect(fn).toHaveBeenCalledTimes(2);
    });
    
    it('should handle errors properly', async () => {
      const error = new Error('Test error');
      const fn = jest.fn().mockRejectedValue(error);
      
      await expect(deduplicator.execute(fn, 'key1')).rejects.toThrow('Test error');
      expect(fn).toHaveBeenCalledTimes(1);
    });
    
    it('should deduplicate errors when includeErrors is true', async () => {
      const errorDedup = new RequestDeduplicator({
        ttl: 1000,
        includeErrors: true,
      });
      
      const error = new Error('Test error');
      const fn = jest.fn().mockImplementation(() =>
        new Promise((_, reject) => setTimeout(() => reject(error), 100))
      );
      
      // Start two identical requests that will fail
      const promise1 = errorDedup.execute(fn, 'key1');
      const promise2 = errorDedup.execute(fn, 'key1');
      
      jest.advanceTimersByTime(100);
      
      await expect(promise1).rejects.toThrow('Test error');
      await expect(promise2).rejects.toThrow('Test error');
      expect(fn).toHaveBeenCalledTimes(1); // Should only execute once
      
      errorDedup.dispose();
    });
  });
  
  describe('Cache Management', () => {
    it('should respect TTL for cached entries', async () => {
      const fn = jest.fn()
        .mockResolvedValueOnce('result1')
        .mockResolvedValueOnce('result2');
      
      // First execution
      const result1 = await deduplicator.execute(fn, 'key1');
      expect(result1).toBe('result1');
      expect(fn).toHaveBeenCalledTimes(1);
      
      // Within TTL - should return cached
      const result2 = await deduplicator.execute(fn, 'key1');
      expect(result2).toBe('result1');
      expect(fn).toHaveBeenCalledTimes(1);
      
      // Advance past TTL
      jest.advanceTimersByTime(1100);
      
      // After TTL - should execute again
      const result3 = await deduplicator.execute(fn, 'key1');
      expect(result3).toBe('result2');
      expect(fn).toHaveBeenCalledTimes(2);
    });
    
    it('should evict oldest entry when max size reached', async () => {
      const fn = jest.fn().mockImplementation((key: string) => 
        Promise.resolve(`result-${key}`)
      );
      
      // Fill cache to max size
      await deduplicator.execute(() => fn('1'), 'key1');
      // Add small delays to ensure different timestamps
      jest.advanceTimersByTime(10);
      await deduplicator.execute(() => fn('2'), 'key2');
      jest.advanceTimersByTime(10);
      await deduplicator.execute(() => fn('3'), 'key3');
      
      expect(deduplicator.size()).toBe(3);
      
      // Add one more - should evict oldest
      jest.advanceTimersByTime(10);
      await deduplicator.execute(() => fn('4'), 'key4');
      
      expect(deduplicator.size()).toBe(3);
      expect(deduplicator.has('key1')).toBe(false); // Oldest should be evicted
      expect(deduplicator.has('key2')).toBe(true);
      expect(deduplicator.has('key3')).toBe(true);
      expect(deduplicator.has('key4')).toBe(true);
    });
    
    it('should clean up expired entries periodically', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      
      // Add some entries
      await deduplicator.execute(fn, 'key1');
      await deduplicator.execute(fn, 'key2');
      
      expect(deduplicator.size()).toBe(2);
      
      // Advance past TTL to trigger cleanup
      jest.advanceTimersByTime(2000);
      
      expect(deduplicator.size()).toBe(0);
    });
    
    it('should clear cache on demand', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      
      await deduplicator.execute(fn, 'key1');
      await deduplicator.execute(fn, 'key2');
      
      expect(deduplicator.size()).toBe(2);
      
      deduplicator.clear();
      
      expect(deduplicator.size()).toBe(0);
      expect(deduplicator.has('key1')).toBe(false);
      expect(deduplicator.has('key2')).toBe(false);
    });
  });
  
  describe('Statistics', () => {
    it('should track hits and misses', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      
      // First execution - miss
      await deduplicator.execute(fn, 'key1');
      
      let stats = deduplicator.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
      expect(stats.totalRequests).toBe(1);
      expect(stats.totalExecutions).toBe(1);
      
      // Second execution same key - hit
      await deduplicator.execute(fn, 'key1');
      
      stats = deduplicator.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.totalRequests).toBe(2);
      expect(stats.totalExecutions).toBe(1);
      
      // Third execution different key - miss
      await deduplicator.execute(fn, 'key2');
      
      stats = deduplicator.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(2);
      expect(stats.totalRequests).toBe(3);
      expect(stats.totalExecutions).toBe(2);
    });
    
    it('should calculate deduplication rate', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      
      // Execute same key multiple times
      await deduplicator.execute(fn, 'key1');
      await deduplicator.execute(fn, 'key1');
      await deduplicator.execute(fn, 'key1');
      await deduplicator.execute(fn, 'key1');
      
      const stats = deduplicator.getStats();
      expect(stats.deduplicationRate).toBeCloseTo(0.75); // 3 hits out of 4 requests
    });
  });
  
  describe('Event Emissions', () => {
    it('should emit hit event on cache hit', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const hitListener = jest.fn();
      
      deduplicator.on('hit', hitListener);
      
      await deduplicator.execute(fn, 'key1');
      await deduplicator.execute(fn, 'key1'); // Cache hit
      
      expect(hitListener).toHaveBeenCalledWith({
        key: expect.any(String),
        requestCount: 2,
      });
    });
    
    it('should emit miss event on cache miss', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const missListener = jest.fn();
      
      deduplicator.on('miss', missListener);
      
      await deduplicator.execute(fn, 'key1');
      
      expect(missListener).toHaveBeenCalledWith({
        key: expect.any(String),
      });
    });
    
    it('should emit complete event on successful completion', async () => {
      const fn = jest.fn().mockResolvedValue('result');
      const completeListener = jest.fn();
      
      deduplicator.on('complete', completeListener);
      
      await deduplicator.execute(fn, 'key1');
      
      expect(completeListener).toHaveBeenCalledWith({
        key: expect.any(String),
        duration: expect.any(Number),
        requestCount: 1,
      });
    });
    
    it('should emit error event on failure', async () => {
      const error = new Error('Test error');
      const fn = jest.fn().mockRejectedValue(error);
      const errorListener = jest.fn();
      
      deduplicator.on('error', errorListener);
      
      try {
        await deduplicator.execute(fn, 'key1');
      } catch {
        // Expected to throw
      }
      
      expect(errorListener).toHaveBeenCalledWith({
        key: expect.any(String),
        error,
        duration: expect.any(Number),
        requestCount: 1,
      });
    });
  });
  
  describe('Custom Key Generator', () => {
    it('should use custom key generator when provided', async () => {
      const customDedup = new RequestDeduplicator({
        keyGenerator: (a: string, b: number) => `${a}-${b}`,
      });
      
      const fn = jest.fn().mockResolvedValue('result');
      
      await customDedup.execute(fn, 'test', 123);
      await customDedup.execute(fn, 'test', 123); // Same key
      await customDedup.execute(fn, 'test', 456); // Different key
      
      expect(fn).toHaveBeenCalledTimes(2);
      
      customDedup.dispose();
    });
  });
});

describe('CommandDeduplicator', () => {
  let deduplicator: CommandDeduplicator;
  
  beforeEach(() => {
    jest.useFakeTimers();
    deduplicator = new CommandDeduplicator();
  });
  
  afterEach(() => {
    deduplicator.dispose();
    jest.useRealTimers();
  });
  
  it('should deduplicate identical commands', async () => {
    const fn = jest.fn().mockResolvedValue('result');
    
    const result1 = await deduplicator.execute(fn, 'ls', ['-la'], '/home');
    const result2 = await deduplicator.execute(fn, 'ls', ['-la'], '/home');
    
    expect(result1).toBe('result');
    expect(result2).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  
  it('should not deduplicate different commands', async () => {
    const fn = jest.fn().mockResolvedValue('result');
    
    await deduplicator.execute(fn, 'ls', ['-la'], '/home');
    await deduplicator.execute(fn, 'ls', ['-l'], '/home'); // Different args
    await deduplicator.execute(fn, 'ls', ['-la'], '/tmp'); // Different cwd
    
    expect(fn).toHaveBeenCalledTimes(3);
  });
  
  it('should have appropriate TTL for commands', async () => {
    const fn = jest.fn()
      .mockResolvedValueOnce('result1')
      .mockResolvedValueOnce('result2');
    
    await deduplicator.execute(fn, 'ls', [], '/');
    
    // Within 5 seconds - should be cached
    jest.advanceTimersByTime(4000);
    await deduplicator.execute(fn, 'ls', [], '/');
    expect(fn).toHaveBeenCalledTimes(1);
    
    // After 5 seconds - should execute again
    jest.advanceTimersByTime(2000);
    await deduplicator.execute(fn, 'ls', [], '/');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('FileOperationDeduplicator', () => {
  let deduplicator: FileOperationDeduplicator;
  
  beforeEach(() => {
    jest.useFakeTimers();
    deduplicator = new FileOperationDeduplicator();
  });
  
  afterEach(() => {
    deduplicator.dispose();
    jest.useRealTimers();
  });
  
  it('should deduplicate identical file operations', async () => {
    const fn = jest.fn().mockResolvedValue('result');
    
    const result1 = await deduplicator.execute(fn, 'read', '/file.txt');
    const result2 = await deduplicator.execute(fn, 'read', '/file.txt');
    
    expect(result1).toBe('result');
    expect(result2).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });
  
  it('should cache errors for file operations', async () => {
    const error = new Error('File not found');
    const fn = jest.fn().mockRejectedValue(error);
    
    const promise1 = deduplicator.execute(fn, 'read', '/missing.txt');
    const promise2 = deduplicator.execute(fn, 'read', '/missing.txt');
    
    await expect(promise1).rejects.toThrow('File not found');
    await expect(promise2).rejects.toThrow('File not found');
    
    // Should only try once since errors are cached
    expect(fn).toHaveBeenCalledTimes(1);
  });
  
  it('should have appropriate TTL for file operations', async () => {
    const fn = jest.fn()
      .mockResolvedValueOnce('result1')
      .mockResolvedValueOnce('result2');
    
    await deduplicator.execute(fn, 'read', '/file.txt');
    
    // Within 2 seconds - should be cached
    jest.advanceTimersByTime(1500);
    await deduplicator.execute(fn, 'read', '/file.txt');
    expect(fn).toHaveBeenCalledTimes(1);
    
    // After 2 seconds - should execute again
    jest.advanceTimersByTime(1000);
    await deduplicator.execute(fn, 'read', '/file.txt');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
