/**
 * Memory Manager Module
 * Provides memory monitoring, cleanup, and optimization
 */

import { getLogger } from './logger.js';
import { EventEmitter } from 'events';

const logger = getLogger('memory-manager');

export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
  heapUsedPercent: number;
  timestamp: Date;
}

export interface CleanupTask {
  id: string;
  name: string;
  priority: number; // Lower number = higher priority
  execute: () => Promise<void>;
  estimatedFreedMemory?: number;
}

export class MemoryManager extends EventEmitter {
  private cleanupTasks = new Map<string, CleanupTask>();
  private memoryHistory: MemoryStats[] = [];
  private monitoringInterval?: NodeJS.Timeout;
  private cleanupInProgress = false;
  
  // Configuration
  private readonly HISTORY_SIZE = 100;
  private readonly MONITOR_INTERVAL = 30000; // 30 seconds
  private readonly HIGH_MEMORY_THRESHOLD = 0.85; // 85% heap usage
  private readonly CRITICAL_MEMORY_THRESHOLD = 0.95; // 95% heap usage
  private readonly CLEANUP_DEBOUNCE = 5000; // 5 seconds
  
  private lastCleanup = 0;

  constructor() {
    super();
    this.startMonitoring();
  }

  /**
   * Start memory monitoring
   */
  private startMonitoring(): void {
    if (this.monitoringInterval) return;

    this.monitoringInterval = setInterval(() => {
      const stats = this.collectMemoryStats();
      this.memoryHistory.push(stats);
      
      // Keep history size bounded
      if (this.memoryHistory.length > this.HISTORY_SIZE) {
        this.memoryHistory.shift();
      }

      // Check memory thresholds
      this.checkMemoryThresholds(stats);
    }, this.MONITOR_INTERVAL);

    logger.info({
      module: 'memory-manager',
      action: 'start-monitoring',
      interval: this.MONITOR_INTERVAL,
    }, 'Started memory monitoring');
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      
      logger.info({
        module: 'memory-manager',
        action: 'stop-monitoring',
      }, 'Stopped memory monitoring');
    }
  }

  /**
   * Collect current memory statistics
   */
  private collectMemoryStats(): MemoryStats {
    const memUsage = process.memoryUsage();
    const heapUsedPercent = memUsage.heapUsed / memUsage.heapTotal;

    return {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      arrayBuffers: memUsage.arrayBuffers || 0,
      heapUsedPercent,
      timestamp: new Date(),
    };
  }

  /**
   * Check memory thresholds and trigger cleanup if needed
   */
  private async checkMemoryThresholds(stats: MemoryStats): Promise<void> {
    if (stats.heapUsedPercent >= this.CRITICAL_MEMORY_THRESHOLD) {
      logger.error({
        module: 'memory-manager',
        action: 'critical-memory',
        heapUsedPercent: Math.round(stats.heapUsedPercent * 100),
        heapUsed: Math.round(stats.heapUsed / 1024 / 1024),
        heapTotal: Math.round(stats.heapTotal / 1024 / 1024),
      }, 'Critical memory usage detected');
      
      this.emit('critical-memory', stats);
      await this.performCleanup('critical');
    } else if (stats.heapUsedPercent >= this.HIGH_MEMORY_THRESHOLD) {
      logger.warn({
        module: 'memory-manager',
        action: 'high-memory',
        heapUsedPercent: Math.round(stats.heapUsedPercent * 100),
      }, 'High memory usage detected');
      
      this.emit('high-memory', stats);
      await this.performCleanup('high');
    }
  }

  /**
   * Register a cleanup task
   */
  registerCleanupTask(task: CleanupTask): void {
    this.cleanupTasks.set(task.id, task);
    
    logger.debug({
      module: 'memory-manager',
      action: 'register-task',
      taskId: task.id,
      taskName: task.name,
      priority: task.priority,
    }, `Registered cleanup task: ${task.name}`);
  }

  /**
   * Unregister a cleanup task
   */
  unregisterCleanupTask(taskId: string): void {
    if (this.cleanupTasks.delete(taskId)) {
      logger.debug({
        module: 'memory-manager',
        action: 'unregister-task',
        taskId,
      }, 'Unregistered cleanup task');
    }
  }

  /**
   * Perform memory cleanup
   */
  async performCleanup(severity: 'routine' | 'high' | 'critical' = 'routine'): Promise<void> {
    // Debounce cleanup calls
    const now = Date.now();
    if (now - this.lastCleanup < this.CLEANUP_DEBOUNCE) {
      return;
    }
    this.lastCleanup = now;

    if (this.cleanupInProgress) {
      logger.debug({
        module: 'memory-manager',
        action: 'cleanup-skipped',
        reason: 'already-in-progress',
      }, 'Cleanup already in progress');
      return;
    }

    this.cleanupInProgress = true;
    const startStats = this.collectMemoryStats();

    try {
      logger.info({
        module: 'memory-manager',
        action: 'cleanup-start',
        severity,
        heapUsedBefore: Math.round(startStats.heapUsed / 1024 / 1024),
      }, `Starting ${severity} cleanup`);

      // Sort tasks by priority
      const tasks = Array.from(this.cleanupTasks.values()).sort(
        (a, b) => a.priority - b.priority
      );

      // Execute tasks based on severity
      const tasksToRun = severity === 'critical' ? tasks :
                         severity === 'high' ? tasks.slice(0, Math.ceil(tasks.length * 0.7)) :
                         tasks.slice(0, Math.ceil(tasks.length * 0.3));

      for (const task of tasksToRun) {
        try {
          await task.execute();
          logger.debug({
            module: 'memory-manager',
            action: 'task-executed',
            taskName: task.name,
          }, `Executed cleanup task: ${task.name}`);
        } catch (error) {
          logger.error({
            module: 'memory-manager',
            action: 'task-failed',
            taskName: task.name,
            error,
          }, `Cleanup task failed: ${task.name}`);
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        logger.debug({
          module: 'memory-manager',
          action: 'gc-forced',
        }, 'Forced garbage collection');
      }

      // Collect stats after cleanup
      const endStats = this.collectMemoryStats();
      const freedMemory = startStats.heapUsed - endStats.heapUsed;

      logger.info({
        module: 'memory-manager',
        action: 'cleanup-complete',
        severity,
        heapUsedBefore: Math.round(startStats.heapUsed / 1024 / 1024),
        heapUsedAfter: Math.round(endStats.heapUsed / 1024 / 1024),
        freedMemory: Math.round(freedMemory / 1024 / 1024),
      }, `Cleanup complete. Freed ${Math.round(freedMemory / 1024 / 1024)}MB`);

      this.emit('cleanup-complete', {
        severity,
        freedMemory,
        startStats,
        endStats,
      });
    } finally {
      this.cleanupInProgress = false;
    }
  }

  /**
   * Get current memory statistics
   */
  getStats(): MemoryStats {
    return this.collectMemoryStats();
  }

  /**
   * Get memory history
   */
  getHistory(): MemoryStats[] {
    return [...this.memoryHistory];
  }

  /**
   * Get memory trend
   */
  getMemoryTrend(): 'increasing' | 'stable' | 'decreasing' {
    if (this.memoryHistory.length < 3) return 'stable';

    const recent = this.memoryHistory.slice(-3);
    const firstUsage = recent[0].heapUsedPercent;
    const lastUsage = recent[recent.length - 1].heapUsedPercent;
    const difference = lastUsage - firstUsage;

    if (difference > 0.05) return 'increasing';
    if (difference < -0.05) return 'decreasing';
    return 'stable';
  }

  /**
   * Create a memory snapshot for debugging
   */
  createSnapshot(): {
    stats: MemoryStats;
    tasks: string[];
    trend: string;
    history: MemoryStats[];
  } {
    return {
      stats: this.getStats(),
      tasks: Array.from(this.cleanupTasks.keys()),
      trend: this.getMemoryTrend(),
      history: this.getHistory(),
    };
  }

  /**
   * Cleanup and dispose
   */
  dispose(): void {
    this.stopMonitoring();
    this.cleanupTasks.clear();
    this.memoryHistory = [];
    this.removeAllListeners();
    
    logger.info({
      module: 'memory-manager',
      action: 'dispose',
    }, 'Memory manager disposed');
  }
}

// Singleton instance
export const memoryManager = new MemoryManager();

// Register default cleanup tasks
memoryManager.registerCleanupTask({
  id: 'clear-caches',
  name: 'Clear internal caches',
  priority: 1,
  execute: async () => {
    // This would clear various caches in the application
    // For now, just a placeholder
    logger.debug({
      module: 'memory-manager',
      action: 'clear-caches',
    }, 'Clearing internal caches');
  },
});

// Handle process exit
process.on('exit', () => {
  memoryManager.dispose();
});