import { OutputLine, CircularBuffer } from '../background-process.js';

/**
 * Enhanced CircularBuffer with memory-safe waiter management
 * Prevents memory leaks from orphaned promises
 */
export class EnhancedCircularBuffer extends CircularBuffer {
  // Override the protected waiters with our enhanced version
  protected waiters: Array<{
    resolve: (lines: OutputLine[]) => void;
    minLine: number;
    timeout: NodeJS.Timeout;
    createdAt: number;
  }> = [];
  
  private readonly MAX_WAITERS = 100;
  private readonly WAITER_TIMEOUT = 60000; // 1 minute max wait
  
  private cleanupInterval: NodeJS.Timeout;
  
  constructor(maxLines: number = 10000) {
    super(maxLines);
    // Periodic cleanup of stale waiters
    this.cleanupInterval = setInterval(() => this.cleanupStaleWaiters(), 30000); // Every 30 seconds
  }
  
  // Override add to ensure our notifyWaiters is called
  add(line: OutputLine): void {
    super.add(line);
    this.notifyWaiters();
  }
  
  async waitForLines(afterLine: number, timeout: number = 30000): Promise<OutputLine[]> {
    // Limit timeout to prevent excessive waits
    const effectiveTimeout = Math.min(timeout, this.WAITER_TIMEOUT);
    
    // Check waiter limit
    if (this.waiters.length >= this.MAX_WAITERS) {
      // Force cleanup of oldest waiters
      this.cleanupStaleWaiters(true);
      
      if (this.waiters.length >= this.MAX_WAITERS) {
        throw new Error('Too many pending waiters, please try again later');
      }
    }
    
    // If lines already available, return immediately
    if (this.getTotalLines() > afterLine) {
      return this.getLines(undefined, afterLine);
    }
    
    // Create waiter with timeout
    return new Promise<OutputLine[]>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        // Remove from waiters
        this.waiters = this.waiters.filter(w => w.resolve !== resolve);
        // Return empty array on timeout
        resolve([]);
      }, effectiveTimeout);
      
      this.waiters.push({
        resolve,
        minLine: afterLine,
        timeout: timeoutHandle,
        createdAt: Date.now()
      });
    });
  }
  
  private cleanupStaleWaiters(force: boolean = false): void {
    const now = Date.now();
    const staleThreshold = force ? 10000 : this.WAITER_TIMEOUT; // 10s if forced, otherwise 1 minute
    
    const staleWaiters = this.waiters.filter(w => 
      (now - w.createdAt) > staleThreshold
    );
    
    // Clean up stale waiters
    staleWaiters.forEach(waiter => {
      clearTimeout(waiter.timeout);
      waiter.resolve([]); // Resolve with empty array
    });
    
    // Remove stale waiters from array
    if (staleWaiters.length > 0) {
      this.waiters = this.waiters.filter(w => 
        (now - w.createdAt) <= staleThreshold
      );
    }
  }
  
  // Override parent's notifyWaiters for better performance
  protected notifyWaiters(): void {
    const totalLines = this.getTotalLines();
    const toNotify = this.waiters.filter(w => totalLines > w.minLine);
    
    if (toNotify.length === 0) return;
    
    // Batch process notifications
    toNotify.forEach(waiter => {
      clearTimeout(waiter.timeout);
      const lines = this.getLines(undefined, waiter.minLine);
      waiter.resolve(lines);
    });
    
    // Remove notified waiters in one operation
    this.waiters = this.waiters.filter(w => !toNotify.includes(w));
  }
  
  // Cleanup method for process termination
  cleanup(): void {
    // Clear the interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Resolve all pending waiters
    this.waiters.forEach(waiter => {
      clearTimeout(waiter.timeout);
      waiter.resolve([]);
    });
    this.waiters = [];
    
    // Clear buffer
    this.clear();
  }
}
