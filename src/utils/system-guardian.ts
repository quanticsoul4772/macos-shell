/**
 * System Guardian
 * Monitors system resources and implements graceful degradation for AI operations
 */

import * as os from 'os';
import { EventEmitter } from 'events';
import { getLogger } from './logger.js';
import { commandPool } from './command-pool.js';
import { circuitBreakerRegistry } from './circuit-breaker.js';

const logger = getLogger('system-guardian');

export enum SystemLoad {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export interface SystemState {
  load: SystemLoad;
  cpuUsage: number;
  memoryUsage: number;
  activeProcesses: number;
  queuedCommands: number;
  recommendations: string[];
}

export interface DegradationPolicy {
  maxConcurrent: number;
  queueTimeout: number;
  commandTimeout: number;
  allowComplexCommands: boolean;
  allowBackgroundProcesses: boolean;
  cacheOnly: boolean;
}

export class SystemGuardian extends EventEmitter {
  private currentLoad = SystemLoad.NORMAL;
  private monitoringInterval?: NodeJS.Timeout;
  private readonly policies: Record<SystemLoad, DegradationPolicy> = {
    [SystemLoad.LOW]: {
      maxConcurrent: 20,
      queueTimeout: 60000,
      commandTimeout: 120000,
      allowComplexCommands: true,
      allowBackgroundProcesses: true,
      cacheOnly: false,
    },
    [SystemLoad.NORMAL]: {
      maxConcurrent: 10,
      queueTimeout: 30000,
      commandTimeout: 60000,
      allowComplexCommands: true,
      allowBackgroundProcesses: true,
      cacheOnly: false,
    },
    [SystemLoad.HIGH]: {
      maxConcurrent: 5,
      queueTimeout: 15000,
      commandTimeout: 30000,
      allowComplexCommands: false,
      allowBackgroundProcesses: false,
      cacheOnly: false,
    },
    [SystemLoad.CRITICAL]: {
      maxConcurrent: 2,
      queueTimeout: 5000,
      commandTimeout: 10000,
      allowComplexCommands: false,
      allowBackgroundProcesses: false,
      cacheOnly: true,
    },
  };

  constructor(
    private readonly checkInterval = 10000 // 10 seconds
  ) {
    super();
    this.startMonitoring();
  }

  /**
   * Start system monitoring
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.checkSystemState();
    }, this.checkInterval);

    logger.info({
      module: 'system-guardian',
      action: 'start-monitoring',
      interval: this.checkInterval,
    }, 'System monitoring started');
  }

  /**
   * Check current system state
   */
  private async checkSystemState(): Promise<void> {
    const state = await this.getSystemState();
    const newLoad = this.calculateLoad(state);

    if (newLoad !== this.currentLoad) {
      const oldLoad = this.currentLoad;
      this.currentLoad = newLoad;
      
      logger.info({
        module: 'system-guardian',
        action: 'load-change',
        oldLoad,
        newLoad,
        state,
      }, `System load changed from ${oldLoad} to ${newLoad}`);

      this.applyDegradationPolicy();
      this.emit('load-change', { oldLoad, newLoad, state });
    }

    // Emit periodic state update for AI decision making
    this.emit('state-update', state);
  }

  /**
   * Get current system state
   */
  async getSystemState(): Promise<SystemState> {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const loadAvg = os.loadavg()[0]; // 1-minute load average

    // Calculate CPU usage
    const cpuUsage = Math.min(100, (loadAvg / cpus.length) * 100);

    // Calculate memory usage
    const memoryUsage = ((totalMemory - freeMemory) / totalMemory) * 100;

    // Get pool stats
    const poolStats = commandPool.getStats();
    
    const recommendations = this.generateRecommendations(
      cpuUsage,
      memoryUsage,
      poolStats.active,
      poolStats.queued
    );

    return {
      load: this.currentLoad,
      cpuUsage,
      memoryUsage,
      activeProcesses: poolStats.active,
      queuedCommands: poolStats.queued,
      recommendations,
    };
  }

  /**
   * Calculate system load level
   */
  private calculateLoad(state: SystemState): SystemLoad {
    const { cpuUsage, memoryUsage, activeProcesses, queuedCommands } = state;

    // Critical if any metric is very high
    if (cpuUsage > 90 || memoryUsage > 95 || queuedCommands > 50) {
      return SystemLoad.CRITICAL;
    }

    // High if multiple metrics are elevated
    if (cpuUsage > 70 || memoryUsage > 85 || queuedCommands > 20) {
      return SystemLoad.HIGH;
    }

    // Low if system is barely used
    if (cpuUsage < 20 && memoryUsage < 40 && activeProcesses < 2) {
      return SystemLoad.LOW;
    }

    return SystemLoad.NORMAL;
  }

  /**
   * Generate AI-friendly recommendations
   */
  private generateRecommendations(
    cpu: number,
    memory: number,
    active: number,
    queued: number
  ): string[] {
    const recommendations: string[] = [];

    if (cpu > 80) {
      recommendations.push('Reduce CPU-intensive operations');
      recommendations.push('Consider deferring non-critical tasks');
    }

    if (memory > 90) {
      recommendations.push('Memory critical - avoid large data operations');
      recommendations.push('Consider clearing caches');
    }

    if (queued > 10) {
      recommendations.push('Command queue building up - reduce submission rate');
    }

    if (active > 8) {
      recommendations.push('Many concurrent operations - consider serialization');
    }

    return recommendations;
  }

  /**
   * Apply degradation policy based on current load
   */
  private applyDegradationPolicy(): void {
    const policy = this.policies[this.currentLoad];

    // This would integrate with commandPool to adjust limits
    // For now, just log the policy change
    logger.info({
      module: 'system-guardian',
      action: 'apply-policy',
      load: this.currentLoad,
      policy,
    }, `Applied degradation policy for ${this.currentLoad} load`);

    // Open circuit breakers if critical
    if (this.currentLoad === SystemLoad.CRITICAL) {
      const breakers = circuitBreakerRegistry.getAllBreakers();
      for (const [name, breaker] of breakers) {
        if (breaker.getState() !== 'OPEN') {
          breaker.open();
          logger.warn({
            module: 'system-guardian',
            action: 'open-circuit',
            circuit: name,
          }, `Opened circuit breaker '${name}' due to critical load`);
        }
      }
    }
  }

  /**
   * Check if operation is allowed under current policy
   */
  isOperationAllowed(operation: {
    type: 'command' | 'background' | 'complex';
    priority?: number;
  }): boolean {
    const policy = this.policies[this.currentLoad];

    switch (operation.type) {
      case 'background':
        return policy.allowBackgroundProcesses;
      case 'complex':
        return policy.allowComplexCommands;
      case 'command':
        // High priority commands always allowed except in cache-only mode
        if (operation.priority && operation.priority <= 2) {
          return !policy.cacheOnly;
        }
        return !policy.cacheOnly;
      default:
        return true;
    }
  }

  /**
   * Get current policy
   */
  getCurrentPolicy(): DegradationPolicy {
    return this.policies[this.currentLoad];
  }

  /**
   * Get AI-optimized status report
   */
  getAIStatus(): {
    canExecute: boolean;
    load: SystemLoad;
    policy: DegradationPolicy;
    recommendations: string[];
  } {
    const state = this.getSystemState();
    const policy = this.getCurrentPolicy();

    return {
      canExecute: this.currentLoad !== SystemLoad.CRITICAL,
      load: this.currentLoad,
      policy,
      recommendations: (state as any).recommendations || [],
    };
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    logger.info({
      module: 'system-guardian',
      action: 'stop-monitoring',
    }, 'System monitoring stopped');
  }

  /**
   * Dispose
   */
  dispose(): void {
    this.stopMonitoring();
    this.removeAllListeners();
  }
}

// Export singleton
export const systemGuardian = new SystemGuardian();