import { resourceCache } from './resource-cache.js';

describe('ResourceCache', () => {
  beforeEach(() => {
    resourceCache.clear();
    resourceCache.resetStats();
  });
  
  it('should set and get resource data', () => {
    const data = { pid: 123, cpu: 10, memory: 100, memoryPercent: 5 };
    resourceCache.set(123, data);
    
    const retrieved = resourceCache.get(123);
    expect(retrieved).toMatchObject(data);
    expect(retrieved).toHaveProperty('timestamp');
  });
  
  it('should return null for missing keys', () => {
    const result = resourceCache.get(999);
    expect(result).toBeNull();
  });
  
  it('should set multiple resources', () => {
    const dataMap = new Map([
      [1, { pid: 1, cpu: 5, memory: 50, memoryPercent: 2 }],
      [2, { pid: 2, cpu: 10, memory: 100, memoryPercent: 4 }]
    ]);
    
    resourceCache.setMultiple(dataMap);
    
    expect(resourceCache.get(1)).toBeDefined();
    expect(resourceCache.get(2)).toBeDefined();
  });
  
  it('should get multiple resources', () => {
    resourceCache.set(1, { pid: 1, cpu: 5, memory: 50, memoryPercent: 2 });
    resourceCache.set(2, { pid: 2, cpu: 10, memory: 100, memoryPercent: 4 });
    
    const results = resourceCache.getMultiple([1, 2, 3]);
    
    expect(results.size).toBe(2);
    expect(results.has(1)).toBe(true);
    expect(results.has(2)).toBe(true);
    expect(results.has(3)).toBe(false);
  });
  
  it('should clear cache', () => {
    resourceCache.set(1, { pid: 1, cpu: 5, memory: 50, memoryPercent: 2 });
    resourceCache.clear();
    
    const result = resourceCache.get(1);
    expect(result).toBeNull();
  });
  
  it('should get cache stats', () => {
    resourceCache.set(1, { pid: 1, cpu: 5, memory: 50, memoryPercent: 2 });

    const stats = resourceCache.getStats();
    expect(stats).toHaveProperty('size');
    expect(stats).toHaveProperty('hits');
    expect(stats).toHaveProperty('misses');
    expect(stats).toHaveProperty('hitRate');
  });

  it('should not return expired cache entries', async () => {
    // Set a cache entry
    resourceCache.set(123, { pid: 123, cpu: 10, memory: 100, memoryPercent: 5 });

    // Wait for cache to expire (default TTL is 5000ms)
    await new Promise(resolve => setTimeout(resolve, 5100));

    const result = resourceCache.get(123);
    expect(result).toBeNull();
  });

  it('should invalidate specific cache entry', () => {
    resourceCache.set(1, { pid: 1, cpu: 5, memory: 50, memoryPercent: 2 });
    resourceCache.set(2, { pid: 2, cpu: 10, memory: 100, memoryPercent: 4 });

    resourceCache.invalidate(1);

    expect(resourceCache.get(1)).toBeNull();
    expect(resourceCache.get(2)).toBeDefined();
  });

  it('should handle invalidating non-existent entries', () => {
    // Should not throw
    expect(() => resourceCache.invalidate(999)).not.toThrow();
  });

  it('should reset cache statistics', () => {
    // Generate some cache activity
    resourceCache.set(1, { pid: 1, cpu: 5, memory: 50, memoryPercent: 2 });
    resourceCache.get(1); // hit
    resourceCache.get(999); // miss

    let stats = resourceCache.getStats();
    expect(stats.hits).toBeGreaterThan(0);
    expect(stats.misses).toBeGreaterThan(0);

    resourceCache.resetStats();

    stats = resourceCache.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  it('should check if batching is needed', () => {
    const shouldBatch = (resourceCache as any).shouldBatch(15);
    expect(typeof shouldBatch).toBe('boolean');

    // Should batch for large numbers
    expect((resourceCache as any).shouldBatch(100)).toBe(true);

    // Should not batch for small numbers
    expect((resourceCache as any).shouldBatch(5)).toBe(false);
  });

  it('should get cache configuration', () => {
    const config = resourceCache.getConfig();

    expect(config).toHaveProperty('maxAge');
    expect(config).toHaveProperty('maxEntries');
    expect(config).toHaveProperty('batchThreshold');
    expect(config.maxAge).toBe(5000);
    expect(config.maxEntries).toBe(1000);
    expect(config.batchThreshold).toBe(10);
  });

  it('should handle batch operations with many PIDs', () => {
    // Create a map with many PIDs to trigger batch logging
    const dataMap = new Map();
    for (let i = 0; i < 15; i++) {
      dataMap.set(i, { pid: i, cpu: 5, memory: 50, memoryPercent: 2 });
    }

    resourceCache.setMultiple(dataMap);

    // Verify all entries were set
    const results = resourceCache.getMultiple(Array.from(dataMap.keys()));
    expect(results.size).toBe(15);
  });

  it('should handle getMultiple with many PIDs', () => {
    // Set many cache entries
    for (let i = 0; i < 15; i++) {
      resourceCache.set(i, { pid: i, cpu: 5, memory: 50, memoryPercent: 2 });
    }

    // Request many PIDs to trigger batch logging
    const pids = Array.from({ length: 15 }, (_, i) => i);
    const results = resourceCache.getMultiple(pids);

    expect(results.size).toBe(15);
  });

  it('should prune expired entries from cache', async () => {
    // Set entries
    resourceCache.set(1, { pid: 1, cpu: 5, memory: 50, memoryPercent: 2 });
    resourceCache.set(2, { pid: 2, cpu: 10, memory: 100, memoryPercent: 4 });

    let stats = resourceCache.getStats();
    expect(stats.size).toBe(2);

    // Wait for entries to expire
    await new Promise(resolve => setTimeout(resolve, 5100));

    // Accessing expired entries will remove them
    const result1 = resourceCache.get(1);
    expect(result1).toBeNull();

    const result2 = resourceCache.get(2);
    expect(result2).toBeNull();

    // Both expired entries should be removed
    stats = resourceCache.getStats();
    expect(stats.size).toBe(0);
  });

  it('should track hit rate correctly', () => {
    resourceCache.set(1, { pid: 1, cpu: 5, memory: 50, memoryPercent: 2 });

    // 2 hits, 1 miss
    resourceCache.get(1);
    resourceCache.get(1);
    resourceCache.get(999);

    const stats = resourceCache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.6667, 2);
  });
});