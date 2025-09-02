import { AIMetricsCollector } from './ai-metrics.js';
import { commandPool } from './command-pool.js';
import { circuitBreakerRegistry } from './circuit-breaker.js';
import { resourceCache } from './resource-cache.js';
import { memoryManager } from './memory-manager.js';
import { systemGuardian } from './system-guardian.js';

// Mock dependencies
jest.mock('./logger.js', () => ({
  getLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

jest.mock('./command-pool.js', () => ({
  commandPool: {
    getStats: jest.fn()
  }
}));

jest.mock('./circuit-breaker.js', () => ({
  circuitBreakerRegistry: {
    getAllBreakers: jest.fn(),
    getAllMetrics: jest.fn()
  }
}));

jest.mock('./resource-cache.js', () => ({
  resourceCache: {
    getStats: jest.fn()
  }
}));

jest.mock('./memory-manager.js', () => ({
  memoryManager: {
    getStats: jest.fn()
  }
}));

jest.mock('./system-guardian.js', () => ({
  systemGuardian: {
    getSystemState: jest.fn(),
    getCurrentPolicy: jest.fn(),
    isOperationAllowed: jest.fn()
  }
}));

describe('AIMetricsCollector', () => {
  let metrics: AIMetricsCollector;

  beforeEach(() => {
    metrics = new AIMetricsCollector();
    jest.clearAllMocks();

    // Setup default mocks
    (commandPool.getStats as jest.Mock).mockReturnValue({
      active: 3,
      queued: 2,
      completed: 100,
      failed: 10,
      averageExecutionTime: 250,
      averageWaitTime: 50,
      rejectedDueToRateLimit: 0
    });

    (resourceCache.getStats as jest.Mock).mockReturnValue({
      hitRate: 0.75
    });

    (memoryManager.getStats as jest.Mock).mockReturnValue({
      heapUsedPercent: 0.65
    });

    (systemGuardian.getSystemState as jest.Mock).mockResolvedValue({
      cpuUsage: 45,
      load: 'NORMAL'
    });

    (systemGuardian.getCurrentPolicy as jest.Mock).mockReturnValue({
      cacheOnly: false,
      maxConcurrent: 5,
      commandTimeout: 30000
    });

    (systemGuardian.isOperationAllowed as jest.Mock).mockReturnValue(true);

    (circuitBreakerRegistry.getAllBreakers as jest.Mock).mockReturnValue(
      new Map([
        ['command', { getState: () => 'CLOSED' }],
        ['network', { getState: () => 'OPEN' }]
      ])
    );

    (circuitBreakerRegistry.getAllMetrics as jest.Mock).mockReturnValue({
      command: { state: 'CLOSED', failures: 2 },
      network: { state: 'OPEN', failures: 5 }
    });
  });

  describe('collect', () => {
    it('should collect metrics from all sources', async () => {
      const result = await metrics.collect();

      expect(result).toMatchObject({
        timestamp: expect.any(Date),
        performance: {
          commandPoolUtilization: 0.3,
          averageExecutionTime: 250,
          averageWaitTime: 50,
          cacheHitRate: 0.75,
          deduplicationRate: 0
        },
        reliability: {
          successRate: expect.any(Number),
          circuitBreakerStates: {
            command: 'CLOSED',
            network: 'OPEN'
          },
          errorRate: expect.any(Number),
          recoveryRate: expect.any(Number)
        },
        resources: {
          memoryUsagePercent: 65,
          cpuLoad: 45,
          systemLoad: 'NORMAL',
          queueDepth: 2
        },
        recommendations: expect.any(Array)
      });

      expect(commandPool.getStats).toHaveBeenCalled();
      expect(resourceCache.getStats).toHaveBeenCalled();
      expect(memoryManager.getStats).toHaveBeenCalled();
      expect(systemGuardian.getSystemState).toHaveBeenCalled();
    });

    it('should calculate success rate correctly', async () => {
      const result = await metrics.collect();
      
      // 100 completed / (100 completed + 10 failed) = 0.909
      expect(result.reliability.successRate).toBeCloseTo(0.909, 2);
    });

    it('should calculate error rate correctly', async () => {
      const result = await metrics.collect();
      
      // 10 failed / (100 completed + 10 failed) = 0.091
      expect(result.reliability.errorRate).toBeCloseTo(0.091, 2);
    });

    it('should handle zero total commands', async () => {
      (commandPool.getStats as jest.Mock).mockReturnValue({
        active: 0,
        queued: 0,
        completed: 0,
        failed: 0,
        averageExecutionTime: 0,
        averageWaitTime: 0,
        rejectedDueToRateLimit: 0
      });

      const result = await metrics.collect();
      
      expect(result.reliability.successRate).toBe(1);
      expect(result.reliability.errorRate).toBe(0);
    });

    it('should generate recommendations for high wait times', async () => {
      (commandPool.getStats as jest.Mock).mockReturnValue({
        active: 5,
        queued: 10,
        completed: 100,
        failed: 5,
        averageExecutionTime: 500,
        averageWaitTime: 6000,
        rejectedDueToRateLimit: 0
      });

      const result = await metrics.collect();
      
      expect(result.recommendations).toContain('High command wait times - consider reducing request rate');
    });

    it('should generate recommendations for rate limiting', async () => {
      (commandPool.getStats as jest.Mock).mockReturnValue({
        active: 3,
        queued: 2,
        completed: 100,
        failed: 5,
        averageExecutionTime: 250,
        averageWaitTime: 50,
        rejectedDueToRateLimit: 5
      });

      const result = await metrics.collect();
      
      expect(result.recommendations).toContain('Rate limiting active - space out requests');
    });

    it('should generate recommendations for high memory usage', async () => {
      (memoryManager.getStats as jest.Mock).mockReturnValue({
        heapUsedPercent: 0.85
      });

      const result = await metrics.collect();
      
      expect(result.recommendations).toContain('High memory usage - avoid memory-intensive operations');
    });

    it('should generate recommendations for critical system load', async () => {
      (systemGuardian.getSystemState as jest.Mock).mockResolvedValue({
        cpuUsage: 95,
        load: 'CRITICAL'
      });

      const result = await metrics.collect();
      
      expect(result.recommendations).toContain('System under critical load - defer non-essential operations');
    });

    it('should generate recommendations for open circuit breakers', async () => {
      const result = await metrics.collect();
      
      expect(result.recommendations).toContain('Circuit breakers open: network - avoid these operations');
    });

    it('should maintain metrics history', async () => {
      await metrics.collect();
      await metrics.collect();
      await metrics.collect();

      const trends = metrics.getTrends();
      
      expect(trends).toEqual({
        performanceTrend: 'stable',
        reliabilityTrend: 'stable',
        resourceTrend: 'stable'
      });
    });

    it('should limit metrics history size', async () => {
      // Collect more than MAX_HISTORY (100) metrics
      for (let i = 0; i < 105; i++) {
        await metrics.collect();
      }

      // Should only keep last 100
      const trends = metrics.getTrends();
      expect(trends).toBeDefined();
    });
  });

  describe('getTrends', () => {
    it('should return stable trends with insufficient history', () => {
      const trends = metrics.getTrends();
      
      expect(trends).toEqual({
        performanceTrend: 'stable',
        reliabilityTrend: 'stable',
        resourceTrend: 'stable'
      });
    });

    it('should detect improving performance trend', async () => {
      // Collect metrics with degrading performance first
      for (let i = 0; i < 5; i++) {
        (commandPool.getStats as jest.Mock).mockReturnValue({
          active: 3,
          queued: 2,
          completed: 100,
          failed: 10,
          averageExecutionTime: 500, // Slow
          averageWaitTime: 50,
          rejectedDueToRateLimit: 0
        });
        await metrics.collect();
      }

      // Then collect metrics with improving performance
      for (let i = 0; i < 5; i++) {
        (commandPool.getStats as jest.Mock).mockReturnValue({
          active: 3,
          queued: 2,
          completed: 100,
          failed: 10,
          averageExecutionTime: 200, // Faster
          averageWaitTime: 50,
          rejectedDueToRateLimit: 0
        });
        await metrics.collect();
      }

      const trends = metrics.getTrends();
      expect(trends.performanceTrend).toBe('improving');
    });

    it('should detect degrading reliability trend', async () => {
      // Collect metrics with good reliability first
      for (let i = 0; i < 5; i++) {
        (commandPool.getStats as jest.Mock).mockReturnValue({
          active: 3,
          queued: 2,
          completed: 100,
          failed: 5, // Low failure rate
          averageExecutionTime: 250,
          averageWaitTime: 50,
          rejectedDueToRateLimit: 0
        });
        await metrics.collect();
      }

      // Then collect metrics with degrading reliability
      for (let i = 0; i < 5; i++) {
        (commandPool.getStats as jest.Mock).mockReturnValue({
          active: 3,
          queued: 2,
          completed: 100,
          failed: 30, // High failure rate
          averageExecutionTime: 250,
          averageWaitTime: 50,
          rejectedDueToRateLimit: 0
        });
        await metrics.collect();
      }

      const trends = metrics.getTrends();
      expect(trends.reliabilityTrend).toBe('degrading');
    });

    it('should detect improving resource trend', async () => {
      // Collect metrics with high resource usage first
      for (let i = 0; i < 5; i++) {
        (memoryManager.getStats as jest.Mock).mockReturnValue({
          heapUsedPercent: 0.85 // High memory
        });
        await metrics.collect();
      }

      // Then collect metrics with lower resource usage
      for (let i = 0; i < 5; i++) {
        (memoryManager.getStats as jest.Mock).mockReturnValue({
          heapUsedPercent: 0.45 // Lower memory
        });
        await metrics.collect();
      }

      const trends = metrics.getTrends();
      expect(trends.resourceTrend).toBe('improving');
    });

    it('should handle stable trends within threshold', async () => {
      // Collect metrics with small variations
      for (let i = 0; i < 10; i++) {
        (commandPool.getStats as jest.Mock).mockReturnValue({
          active: 3,
          queued: 2,
          completed: 100,
          failed: 10 + (i % 2), // Small variation
          averageExecutionTime: 250 + (i % 2) * 10, // Small variation
          averageWaitTime: 50,
          rejectedDueToRateLimit: 0
        });
        await metrics.collect();
      }

      const trends = metrics.getTrends();
      expect(trends.performanceTrend).toBe('stable');
      expect(trends.reliabilityTrend).toBe('stable');
    });
  });

  describe('getDecisionSupport', () => {
    it('should provide decision support based on current metrics', async () => {
      await metrics.collect();
      
      const support = metrics.getDecisionSupport();
      
      expect(support).toEqual({
        canExecuteCommand: true,
        shouldUseCache: false,
        shouldDefer: false,
        maxConcurrent: 5,
        timeout: 30000
      });

      expect(systemGuardian.isOperationAllowed).toHaveBeenCalledWith({ type: 'command' });
      expect(systemGuardian.getCurrentPolicy).toHaveBeenCalled();
    });

    it('should recommend cache when memory is high', async () => {
      (memoryManager.getStats as jest.Mock).mockReturnValue({
        heapUsedPercent: 0.85
      });

      await metrics.collect();
      
      const support = metrics.getDecisionSupport();
      
      expect(support.shouldUseCache).toBe(true);
    });

    it('should recommend cache when policy is cache-only', async () => {
      (systemGuardian.getCurrentPolicy as jest.Mock).mockReturnValue({
        cacheOnly: true,
        maxConcurrent: 5,
        commandTimeout: 30000
      });

      await metrics.collect();
      
      const support = metrics.getDecisionSupport();
      
      expect(support.shouldUseCache).toBe(true);
    });

    it('should recommend defer when system load is critical', async () => {
      (systemGuardian.getSystemState as jest.Mock).mockResolvedValue({
        cpuUsage: 95,
        load: 'CRITICAL'
      });

      await metrics.collect();
      
      const support = metrics.getDecisionSupport();
      
      expect(support.shouldDefer).toBe(true);
    });

    it('should respect operation allowed from guardian', async () => {
      (systemGuardian.isOperationAllowed as jest.Mock).mockReturnValue(false);

      await metrics.collect();
      
      const support = metrics.getDecisionSupport();
      
      expect(support.canExecuteCommand).toBe(false);
    });

    it('should handle no metrics history', () => {
      const support = metrics.getDecisionSupport();
      
      expect(support).toBeDefined();
      expect(support.canExecuteCommand).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear metrics history', async () => {
      // Add some metrics
      await metrics.collect();
      await metrics.collect();
      
      // Clear
      metrics.clear();
      
      // Should return stable trends (no history)
      const trends = metrics.getTrends();
      expect(trends).toEqual({
        performanceTrend: 'stable',
        reliabilityTrend: 'stable',
        resourceTrend: 'stable'
      });
    });
  });

  describe('recovery rate calculation', () => {
    it('should calculate recovery rate correctly', async () => {
      (circuitBreakerRegistry.getAllMetrics as jest.Mock).mockReturnValue({
        command: { state: 'CLOSED', failures: 5 },
        network: { state: 'OPEN', failures: 10 },
        database: { state: 'CLOSED', failures: 3 }
      });

      const result = await metrics.collect();
      
      // 2 closed with failures / 3 total = 0.667
      expect(result.reliability.recoveryRate).toBeCloseTo(0.667, 2);
    });

    it('should handle no failures', async () => {
      (circuitBreakerRegistry.getAllMetrics as jest.Mock).mockReturnValue({
        command: { state: 'CLOSED', failures: 0 },
        network: { state: 'CLOSED', failures: 0 }
      });

      const result = await metrics.collect();
      
      expect(result.reliability.recoveryRate).toBe(1);
    });
  });
});
