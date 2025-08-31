/**
 * AI Metrics Collector
 * Collects and provides metrics optimized for AI decision making
 */

import { getLogger } from './logger.js';
import { commandPool } from './command-pool.js';
import { circuitBreakerRegistry } from './circuit-breaker.js';
import { resourceCache } from './resource-cache.js';
import { memoryManager } from './memory-manager.js';
import { systemGuardian } from './system-guardian.js';

const logger = getLogger('ai-metrics');

export interface AIMetrics {
  timestamp: Date;
  performance: {
    commandPoolUtilization: number;
    averageExecutionTime: number;
    averageWaitTime: number;
    cacheHitRate: number;
    deduplicationRate: number;
  };
  reliability: {
    successRate: number;
    circuitBreakerStates: Record<string, string>;
    errorRate: number;
    recoveryRate: number;
  };
  resources: {
    memoryUsagePercent: number;
    cpuLoad: number;
    systemLoad: string;
    queueDepth: number;
  };
  recommendations: string[];
}

export class AIMetricsCollector {
  private metricsHistory: AIMetrics[] = [];
  private readonly MAX_HISTORY = 100;

  /**
   * Collect current metrics snapshot
   */
  async collect(): Promise<AIMetrics> {
    const poolStats = commandPool.getStats();
    const cacheStats = resourceCache.getStats();
    const memoryStats = memoryManager.getStats();
    const systemState = await systemGuardian.getSystemState();
    const circuitStates = this.getCircuitBreakerStates();

    const metrics: AIMetrics = {
      timestamp: new Date(),
      performance: {
        commandPoolUtilization: poolStats.active / 10, // Assuming max 10
        averageExecutionTime: poolStats.averageExecutionTime,
        averageWaitTime: poolStats.averageWaitTime,
        cacheHitRate: cacheStats.hitRate,
        deduplicationRate: 0, // Would come from deduplicator
      },
      reliability: {
        successRate: this.calculateSuccessRate(poolStats),
        circuitBreakerStates: circuitStates,
        errorRate: this.calculateErrorRate(poolStats),
        recoveryRate: this.calculateRecoveryRate(),
      },
      resources: {
        memoryUsagePercent: memoryStats.heapUsedPercent * 100,
        cpuLoad: systemState.cpuUsage,
        systemLoad: systemState.load,
        queueDepth: poolStats.queued,
      },
      recommendations: this.generateRecommendations(
        poolStats,
        systemState,
        memoryStats
      ),
    };

    // Add to history
    this.metricsHistory.push(metrics);
    if (this.metricsHistory.length > this.MAX_HISTORY) {
      this.metricsHistory.shift();
    }

    logger.debug({
      module: 'ai-metrics',
      action: 'collect',
      metrics: {
        successRate: metrics.reliability.successRate,
        cacheHitRate: metrics.performance.cacheHitRate,
        systemLoad: metrics.resources.systemLoad,
      },
    }, 'Metrics collected');

    return metrics;
  }

  /**
   * Get circuit breaker states
   */
  private getCircuitBreakerStates(): Record<string, string> {
    const states: Record<string, string> = {};
    const breakers = circuitBreakerRegistry.getAllBreakers();
    
    for (const [name, breaker] of breakers) {
      states[name] = breaker.getState();
    }
    
    return states;
  }

  /**
   * Calculate success rate
   */
  private calculateSuccessRate(poolStats: any): number {
    const total = poolStats.completed + poolStats.failed;
    if (total === 0) return 1;
    return poolStats.completed / total;
  }

  /**
   * Calculate error rate
   */
  private calculateErrorRate(poolStats: any): number {
    const total = poolStats.completed + poolStats.failed;
    if (total === 0) return 0;
    return poolStats.failed / total;
  }

  /**
   * Calculate recovery rate from circuit breakers
   */
  private calculateRecoveryRate(): number {
    const metrics = circuitBreakerRegistry.getAllMetrics();
    let totalRecoveries = 0;
    let totalFailures = 0;

    for (const metric of Object.values(metrics)) {
      if (metric.state === 'CLOSED' && metric.failures > 0) {
        totalRecoveries++;
      }
      totalFailures += metric.failures;
    }

    if (totalFailures === 0) return 1;
    return totalRecoveries / Object.keys(metrics).length;
  }

  /**
   * Generate AI-friendly recommendations
   */
  private generateRecommendations(
    poolStats: any,
    systemState: any,
    memoryStats: any
  ): string[] {
    const recommendations: string[] = [];

    // Performance recommendations
    if (poolStats.averageWaitTime > 5000) {
      recommendations.push('High command wait times - consider reducing request rate');
    }

    if (poolStats.rejectedDueToRateLimit > 0) {
      recommendations.push('Rate limiting active - space out requests');
    }

    // Resource recommendations
    if (memoryStats.heapUsedPercent > 0.8) {
      recommendations.push('High memory usage - avoid memory-intensive operations');
    }

    if (systemState.load === 'CRITICAL') {
      recommendations.push('System under critical load - defer non-essential operations');
    }

    // Reliability recommendations
    const circuitStates = this.getCircuitBreakerStates();
    const openCircuits = Object.entries(circuitStates)
      .filter(([_, state]) => state === 'OPEN')
      .map(([name]) => name);

    if (openCircuits.length > 0) {
      recommendations.push(`Circuit breakers open: ${openCircuits.join(', ')} - avoid these operations`);
    }

    return recommendations;
  }

  /**
   * Get trend analysis for AI
   */
  getTrends(): {
    performanceTrend: 'improving' | 'stable' | 'degrading';
    reliabilityTrend: 'improving' | 'stable' | 'degrading';
    resourceTrend: 'improving' | 'stable' | 'degrading';
  } {
    if (this.metricsHistory.length < 5) {
      return {
        performanceTrend: 'stable',
        reliabilityTrend: 'stable',
        resourceTrend: 'stable',
      };
    }

    const recent = this.metricsHistory.slice(-5);
    const older = this.metricsHistory.slice(-10, -5);

    // Compare averages
    const recentPerf = this.averagePerformance(recent);
    const olderPerf = this.averagePerformance(older);

    return {
      performanceTrend: this.compareTrend(recentPerf.executionTime, olderPerf.executionTime, true),
      reliabilityTrend: this.compareTrend(recentPerf.successRate, olderPerf.successRate, false),
      resourceTrend: this.compareTrend(recentPerf.memoryUsage, olderPerf.memoryUsage, true),
    };
  }

  /**
   * Calculate average performance metrics
   */
  private averagePerformance(metrics: AIMetrics[]): {
    executionTime: number;
    successRate: number;
    memoryUsage: number;
  } {
    const sum = metrics.reduce((acc, m) => ({
      executionTime: acc.executionTime + m.performance.averageExecutionTime,
      successRate: acc.successRate + m.reliability.successRate,
      memoryUsage: acc.memoryUsage + m.resources.memoryUsagePercent,
    }), { executionTime: 0, successRate: 0, memoryUsage: 0 });

    return {
      executionTime: sum.executionTime / metrics.length,
      successRate: sum.successRate / metrics.length,
      memoryUsage: sum.memoryUsage / metrics.length,
    };
  }

  /**
   * Compare trend (lower is better for some metrics)
   */
  private compareTrend(
    recent: number,
    older: number,
    lowerIsBetter: boolean
  ): 'improving' | 'stable' | 'degrading' {
    const threshold = 0.1; // 10% change threshold
    const change = (recent - older) / older;

    if (Math.abs(change) < threshold) return 'stable';
    
    if (lowerIsBetter) {
      return change < 0 ? 'improving' : 'degrading';
    } else {
      return change > 0 ? 'improving' : 'degrading';
    }
  }

  /**
   * Get AI decision support data
   */
  getDecisionSupport(): {
    canExecuteCommand: boolean;
    shouldUseCache: boolean;
    shouldDefer: boolean;
    maxConcurrent: number;
    timeout: number;
  } {
    const latest = this.metricsHistory[this.metricsHistory.length - 1];
    const systemPolicy = systemGuardian.getCurrentPolicy();

    return {
      canExecuteCommand: systemGuardian.isOperationAllowed({ type: 'command' }),
      shouldUseCache: systemPolicy.cacheOnly || latest?.resources.memoryUsagePercent > 80,
      shouldDefer: latest?.resources.systemLoad === 'CRITICAL',
      maxConcurrent: systemPolicy.maxConcurrent,
      timeout: systemPolicy.commandTimeout,
    };
  }

  /**
   * Clear metrics history
   */
  clear(): void {
    this.metricsHistory = [];
    logger.info({
      module: 'ai-metrics',
      action: 'clear',
    }, 'Metrics history cleared');
  }
}

// Export singleton
export const aiMetrics = new AIMetricsCollector();