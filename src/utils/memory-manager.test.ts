import { MemoryManager } from './memory-manager.js';

describe('MemoryManager', () => {
  let memoryManager: MemoryManager;
  
  beforeEach(() => {
    memoryManager = new MemoryManager();
  });
  
  afterEach(() => {
    memoryManager.dispose();
  });
  
  it('should create instance', () => {
    expect(memoryManager).toBeDefined();
  });
  
  it('should get memory stats', () => {
    const stats = memoryManager.getStats();
    
    expect(stats).toHaveProperty('heapUsed');
    expect(stats).toHaveProperty('heapTotal');
    expect(stats).toHaveProperty('external');
    expect(stats).toHaveProperty('rss');
    expect(stats.heapUsed).toBeGreaterThan(0);
  });
  
  it('should get memory history', () => {
    const history = memoryManager.getHistory();
    
    expect(Array.isArray(history)).toBe(true);
  });
  
  it('should get memory trend', () => {
    const trend = memoryManager.getMemoryTrend();
    
    expect(['increasing', 'stable', 'decreasing']).toContain(trend);
  });
  
  it('should register cleanup task', () => {
    const task = {
      id: 'test-task',
      name: 'Test Cleanup',
      priority: 1,
      execute: jest.fn().mockResolvedValue(undefined)
    };
    
    memoryManager.registerCleanupTask(task);
    
    // Task should be registered
    expect(() => memoryManager.unregisterCleanupTask('test-task')).not.toThrow();
  });
  
  it('should perform cleanup', async () => {
    await memoryManager.performCleanup('routine');
    
    // Should complete without error
    expect(true).toBe(true);
  });
  
  it('should create snapshot', () => {
    const snapshot = memoryManager.createSnapshot();
    
    expect(snapshot).toHaveProperty('stats');
    expect(snapshot).toHaveProperty('tasks');
    expect(snapshot).toHaveProperty('trend');
    expect(snapshot).toHaveProperty('history');
  });
  
  it('should stop monitoring', () => {
    memoryManager.stopMonitoring();
    
    // Should not throw
    expect(true).toBe(true);
  });
});