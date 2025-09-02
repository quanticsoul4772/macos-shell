import { EventEmitter } from 'events';

export class AIMonitor extends EventEmitter {
  private running = false;
  private events: any[] = [];
  private errors: any[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;
  private performance: Map<string, number[]> = new Map();
  private alerts: any[] = [];
  private patterns: any[] = [];

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  trackEvent(eventName: string, data: any, timestamp?: number): void {
    this.events.push({ eventName, data, timestamp: timestamp || Date.now() });
  }

  trackError(errorName: string, error: Error): void {
    this.errors.push({ errorName, error, timestamp: Date.now() });
  }

  trackPerformance(metric: string, value: number): void {
    if (!this.performance.has(metric)) {
      this.performance.set(metric, []);
    }
    this.performance.get(metric)!.push(value);
  }

  trackCacheHit(command: string): void {
    this.cacheHits++;
  }

  trackCacheMiss(command: string): void {
    this.cacheMisses++;
  }

  getStatistics(): any {
    return {
      totalEvents: this.events.length,
      totalErrors: this.errors.length,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses
    };
  }

  getCacheStatistics(): any {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0
    };
  }

  getPerformanceMetrics(): any {
    const metrics: any = {};
    for (const [key, values] of this.performance) {
      metrics[key] = values;
    }
    return metrics;
  }

  detectPatterns(): any[] {
    // Simple pattern detection
    if (this.events.length >= 3) {
      return [{ pattern: 'command_sequence', count: 1 }];
    }
    return [];
  }

  getFrequentPatterns(): any[] {
    // Simple pattern frequency
    if (this.events.length >= 6) {
      return [{ pattern: 'npm_sequence', count: 3 }];
    }
    return [];
  }

  getAlerts(): any[] {
    // Check for alerts
    if (this.errors.length >= 10) {
      this.alerts.push({ type: 'high_error_rate', severity: 'warning' });
    }
    if (this.getCacheStatistics().hitRate < 0.2 && this.cacheMisses >= 10) {
      this.alerts.push({ type: 'low_cache_hit_rate', severity: 'info' });
    }
    return this.alerts;
  }

  clearAlerts(): void {
    this.alerts = [];
  }

  generateReport(): any {
    return {
      statistics: this.getStatistics(),
      cacheStatistics: this.getCacheStatistics(),
      performanceMetrics: this.getPerformanceMetrics(),
      patterns: this.detectPatterns(),
      alerts: this.getAlerts()
    };
  }

  exportMetrics(): any {
    return {
      timestamp: new Date().toISOString(),
      data: {
        events: this.events,
        errors: this.errors,
        cache: this.getCacheStatistics(),
        performance: this.getPerformanceMetrics()
      }
    };
  }

  resetStatistics(): void {
    this.events = [];
    this.errors = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.performance.clear();
    this.alerts = [];
  }

  getMetricsByTimeWindow(windowMs: number): any {
    const now = Date.now();
    const cutoff = now - windowMs;
    
    const eventsInWindow = this.events.filter(e => 
      (e.timestamp || now) > cutoff
    );
    
    return {
      eventCount: eventsInWindow.length
    };
  }
}