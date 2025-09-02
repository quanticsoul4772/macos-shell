export class ResourceMonitor {
  private running = false;
  private metrics: any = {
    cpu: { usage: 0 },
    memory: { used: 1000, total: 8000, percentage: 12.5 },
    processes: 0,
    timestamp: Date.now()
  };
  private history: any[] = [];
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    this.running = true;
    // Collect initial metrics
    this.collectMetrics();
    
    // Start periodic collection
    this.timer = setInterval(() => {
      this.collectMetrics();
    }, 5000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private collectMetrics(): void {
    if (!this.running) return;
    
    const newMetrics = {
      cpu: { usage: Math.random() * 100 },
      memory: { 
        used: Math.random() * 4000 + 1000,
        total: 8000,
        percentage: Math.random() * 100
      },
      processes: Math.floor(Math.random() * 50),
      timestamp: Date.now()
    };
    
    this.metrics = newMetrics;
    this.history.push(newMetrics);
    
    // Limit history size
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }
  }

  getMetrics(): any {
    return this.metrics;
  }

  getHistory(): any[] {
    return this.history;
  }

  isHealthy(): boolean {
    return this.metrics.cpu.usage < 90 && this.metrics.memory.percentage < 90;
  }

  checkHealth(): any {
    const warnings: string[] = [];
    
    if (this.metrics.cpu.usage > 80) {
      warnings.push('High CPU usage');
    }
    
    if (this.metrics.memory.percentage > 80) {
      warnings.push('High memory usage');
    }
    
    return {
      healthy: warnings.length === 0,
      warnings
    };
  }

  resetHistory(): void {
    this.history = [];
  }
}