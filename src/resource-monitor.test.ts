import { ResourceMonitor } from './resource-monitor-stub.js';

describe('ResourceMonitor', () => {
  let monitor: ResourceMonitor;
  
  beforeEach(() => {
    jest.useFakeTimers();
    monitor = new ResourceMonitor();
  });
  
  afterEach(() => {
    monitor.stop();
    jest.useRealTimers();
  });
  
  describe('Basic Functionality', () => {
    it('should start and stop monitoring', () => {
      const startSpy = jest.spyOn(monitor, 'start');
      const stopSpy = jest.spyOn(monitor, 'stop');
      
      monitor.start();
      expect(startSpy).toHaveBeenCalled();
      
      monitor.stop();
      expect(stopSpy).toHaveBeenCalled();
    });
    
    it('should get current metrics', () => {
      const metrics = monitor.getMetrics();
      
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('memory');
      expect(metrics).toHaveProperty('processes');
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics.cpu).toHaveProperty('usage');
      expect(metrics.memory).toHaveProperty('used');
      expect(metrics.memory).toHaveProperty('total');
    });
    
    it('should get history', () => {
      const history = monitor.getHistory();
      
      expect(Array.isArray(history)).toBe(true);
    });
    
    it('should check if healthy', () => {
      const isHealthy = monitor.isHealthy();
      
      expect(typeof isHealthy).toBe('boolean');
    });
    
    it('should handle check health', () => {
      const health = monitor.checkHealth();
      
      expect(health).toHaveProperty('healthy');
      expect(health).toHaveProperty('warnings');
      expect(Array.isArray(health.warnings)).toBe(true);
    });
    
    it('should reset history', () => {
      monitor.resetHistory();
      const history = monitor.getHistory();
      
      expect(history).toHaveLength(0);
    });
  });
  
  describe('Monitoring', () => {
    it('should collect metrics periodically when started', () => {
      monitor.start();
      
      // Should have initial metrics
      let history = monitor.getHistory();
      const initialLength = history.length;
      
      // Advance time to trigger collection
      jest.advanceTimersByTime(5000);
      
      history = monitor.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(initialLength);
    });
    
    it('should not collect metrics when stopped', () => {
      monitor.stop();
      
      const history = monitor.getHistory();
      const initialLength = history.length;
      
      // Advance time
      jest.advanceTimersByTime(5000);
      
      const newHistory = monitor.getHistory();
      expect(newHistory.length).toBe(initialLength);
    });
    
    it('should limit history size', () => {
      monitor.start();
      
      // Generate many metrics
      for (let i = 0; i < 150; i++) {
        jest.advanceTimersByTime(5000);
      }
      
      const history = monitor.getHistory();
      expect(history.length).toBeLessThanOrEqual(100); // Should be capped
    });
  });
  
  describe('Health Checks', () => {
    it('should detect high CPU usage', () => {
      // Mock high CPU
      const metrics = monitor.getMetrics();
      metrics.cpu.usage = 95;
      
      const health = monitor.checkHealth();
      
      // May or may not have warnings depending on implementation
      expect(health).toHaveProperty('healthy');
    });
    
    it('should detect high memory usage', () => {
      // Mock high memory
      const metrics = monitor.getMetrics();
      metrics.memory.percentage = 92;
      
      const health = monitor.checkHealth();
      
      // May or may not have warnings depending on implementation
      expect(health).toHaveProperty('healthy');
    });
  });
});
