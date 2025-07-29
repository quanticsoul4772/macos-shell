/**
 * Debouncer utility for coalescing frequent operations
 * Used to batch session persistence writes
 */
import logger from './logger.js';

export class Debouncer<T> {
  private timeouts = new Map<string, NodeJS.Timeout>();
  private pending = new Map<string, T>();
  
  constructor(
    private delay: number,
    private executor: (key: string, value: T) => Promise<void>
  ) {}
  
  schedule(key: string, value: T): void {
    // Clear existing timeout if any
    const existing = this.timeouts.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    
    // Store the latest value
    this.pending.set(key, value);
    
    // Schedule execution
    const timeout = setTimeout(async () => {
      const pendingValue = this.pending.get(key);
      if (pendingValue !== undefined) {
        try {
          await this.executor(key, pendingValue);
        } catch (error) {
          logger.error({ module: 'debouncer', action: 'execution-failed', key, error }, `Debounced execution failed for ${key}: ${error}`);
        } finally {
          this.pending.delete(key);
          this.timeouts.delete(key);
        }
      }
    }, this.delay);
    
    this.timeouts.set(key, timeout);
  }
  
  async flush(key?: string): Promise<void> {
    if (key) {
      // Flush specific key
      const timeout = this.timeouts.get(key);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(key);
      }
      
      const value = this.pending.get(key);
      if (value !== undefined) {
        await this.executor(key, value);
        this.pending.delete(key);
      }
    } else {
      // Flush all
      const promises: Promise<void>[] = [];
      
      for (const [k, timeout] of this.timeouts) {
        clearTimeout(timeout);
        const value = this.pending.get(k);
        if (value !== undefined) {
          promises.push(this.executor(k, value));
        }
      }
      
      await Promise.all(promises);
      this.timeouts.clear();
      this.pending.clear();
    }
  }
  
  cancel(key?: string): void {
    if (key) {
      const timeout = this.timeouts.get(key);
      if (timeout) {
        clearTimeout(timeout);
        this.timeouts.delete(key);
        this.pending.delete(key);
      }
    } else {
      for (const timeout of this.timeouts.values()) {
        clearTimeout(timeout);
      }
      this.timeouts.clear();
      this.pending.clear();
    }
  }
  
  hasPending(key?: string): boolean {
    return key ? this.pending.has(key) : this.pending.size > 0;
  }
}
