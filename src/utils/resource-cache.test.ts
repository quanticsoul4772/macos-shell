import { resourceCache } from './resource-cache.js';

describe('ResourceCache', () => {
  beforeEach(() => {
    resourceCache.clear();
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
});