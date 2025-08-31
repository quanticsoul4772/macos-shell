/**
 * Request Deduplicator
 * Prevents duplicate concurrent operations by coalescing identical requests
 */

import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { getLogger } from './logger.js';

const logger = getLogger('request-deduplicator');

export interface DedupOptions {
  ttl?: number;                // Time to live for cache entries (ms)
  maxSize?: number;            // Maximum number of cached entries
  keyGenerator?: (...args: any[]) => string; // Custom key generation
  includeErrors?: boolean;     // Cache errors as well
}

export interface DedupEntry<T> {
  key: string;
  promise: Promise<T>;
  timestamp: number;
  requestCount: number;
  completed: boolean;
  error?: Error;
}

export interface DedupStats {
  hits: number;
  misses: number;
  active: number;
  cached: number;
  deduplicationRate: number;
  totalRequests: number;
  totalExecutions: number;
}

export class RequestDeduplicator<T = any> extends EventEmitter {
  private readonly cache = new Map<string, DedupEntry<T>>();
  private readonly options: Required<DedupOptions>;
  private cleanupTimer?: NodeJS.Timeout;
  
  // Statistics
  private stats: DedupStats = {
    hits: 0,
    misses: 0,
    active: 0,
    cached: 0,
    deduplicationRate: 0,
    totalRequests: 0,
    totalExecutions: 0,
  };

  constructor(options: DedupOptions = {}) {
    super();
    
    this.options = {
      ttl: options.ttl || 10000, // 10 seconds default
      maxSize: options.maxSize || 1000,
      keyGenerator: options.keyGenerator || this.defaultKeyGenerator,
      includeErrors: options.includeErrors || false,
    };

    // Start cleanup timer
    this.startCleanupTimer();
    
    logger.info({
      module: 'request-deduplicator',
      action: 'initialize',
      ttl: this.options.ttl,
      maxSize: this.options.maxSize,
    }, 'Request deduplicator initialized');
  }

  /**
   * Execute a function with deduplication
   */
  async execute<R extends T>(
    fn: () => Promise<R>,
    ...keyArgs: any[]
  ): Promise<R> {
    const key = this.options.keyGenerator(...keyArgs);
    this.stats.totalRequests++;
    
    // Check for existing request
    const existing = this.cache.get(key);
    
    if (existing && !this.isExpired(existing)) {
      this.stats.hits++;
      existing.requestCount++;
      
      logger.debug({
        module: 'request-deduplicator',
        action: 'cache-hit',
        key,
        requestCount: existing.requestCount,
      }, 'Deduplicating request');
      
      this.emit('hit', {
        key,
        requestCount: existing.requestCount,
      });
      
      this.updateStats();
      return existing.promise as Promise<R>;
    }

    // Remove expired entry if exists
    if (existing) {
      this.cache.delete(key);
    }

    // Create new request
    this.stats.misses++;
    this.stats.totalExecutions++;
    
    const entry: DedupEntry<R> = {
      key,
      promise: this.executeWithTracking(fn, key),
      timestamp: Date.now(),
      requestCount: 1,
      completed: false,
    };

    // Check cache size
    if (this.cache.size >= this.options.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, entry as DedupEntry<T>);
    this.stats.active++;
    
    logger.debug({
      module: 'request-deduplicator',
      action: 'cache-miss',
      key,
      cacheSize: this.cache.size,
    }, 'Executing new request');
    
    this.emit('miss', { key });
    this.updateStats();
    
    return entry.promise;
  }

  /**
   * Execute function with tracking
   */
  private async executeWithTracking<R extends T>(
    fn: () => Promise<R>,
    key: string
  ): Promise<R> {
    const startTime = Date.now();
    
    try {
      const result = await fn();
      
      const entry = this.cache.get(key);
      if (entry) {
        entry.completed = true;
        this.stats.active--;
        this.stats.cached++;
      }
      
      const duration = Date.now() - startTime;
      
      this.emit('complete', {
        key,
        duration,
        requestCount: entry?.requestCount || 1,
      });
      
      logger.debug({
        module: 'request-deduplicator',
        action: 'request-complete',
        key,
        duration,
        requestCount: entry?.requestCount || 1,
      }, 'Request completed');
      
      // Remove from cache if errors shouldn't be cached
      if (!this.options.includeErrors) {
        setTimeout(() => {
          const entry = this.cache.get(key);
          if (entry && !entry.error) {
            // Keep successful results in cache
          }
        }, 0);
      }
      
      return result;
      
    } catch (error) {
      const entry = this.cache.get(key);
      
      if (entry) {
        entry.completed = true;
        entry.error = error as Error;
        this.stats.active--;
        
        // Remove from cache if errors shouldn't be cached
        if (!this.options.includeErrors) {
          this.cache.delete(key);
        } else {
          this.stats.cached++;
        }
      }
      
      const duration = Date.now() - startTime;
      
      this.emit('error', {
        key,
        error,
        duration,
        requestCount: entry?.requestCount || 1,
      });
      
      logger.error({
        module: 'request-deduplicator',
        action: 'request-error',
        key,
        error,
        duration,
      }, 'Request failed');
      
      throw error;
    } finally {
      this.updateStats();
    }
  }

  /**
   * Default key generator using hash
   */
  private defaultKeyGenerator(...args: any[]): string {
    const str = JSON.stringify(args);
    return createHash('sha256').update(str).digest('hex').substring(0, 16);
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: DedupEntry<T>): boolean {
    if (!entry.completed) return false; // Active requests never expire
    return Date.now() - entry.timestamp > this.options.ttl;
  }

  /**
   * Evict oldest entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache) {
      if (entry.completed && entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.cached--;
      
      logger.debug({
        module: 'request-deduplicator',
        action: 'evict',
        key: oldestKey,
      }, 'Evicted oldest entry');
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];
    
    for (const [key, entry] of this.cache) {
      if (entry.completed && now - entry.timestamp > this.options.ttl) {
        expired.push(key);
      }
    }
    
    for (const key of expired) {
      this.cache.delete(key);
      this.stats.cached--;
    }
    
    if (expired.length > 0) {
      logger.debug({
        module: 'request-deduplicator',
        action: 'cleanup',
        expired: expired.length,
      }, `Cleaned up ${expired.length} expired entries`);
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, Math.min(this.options.ttl, 60000)); // Cleanup at least every minute
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.deduplicationRate = total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Get statistics
   */
  getStats(): DedupStats {
    return { ...this.stats };
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.stats.active = 0;
    this.stats.cached = 0;
    
    logger.info({
      module: 'request-deduplicator',
      action: 'clear',
    }, 'Cache cleared');
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Check if key is cached
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    return entry !== undefined && !this.isExpired(entry);
  }

  /**
   * Dispose the deduplicator
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.clear();
    this.removeAllListeners();
    
    logger.info({
      module: 'request-deduplicator',
      action: 'dispose',
      finalStats: this.stats,
    }, 'Request deduplicator disposed');
  }
}

// Create specialized deduplicators for different operations
export class CommandDeduplicator extends RequestDeduplicator {
  constructor() {
    super({
      ttl: 5000, // 5 seconds for commands
      maxSize: 100,
      keyGenerator: (command: string, args: string[], cwd: string) => {
        return createHash('sha256')
          .update(`${command}:${args.join(',')}:${cwd}`)
          .digest('hex')
          .substring(0, 16);
      },
    });
  }
}

export class FileOperationDeduplicator extends RequestDeduplicator {
  constructor() {
    super({
      ttl: 2000, // 2 seconds for file operations
      maxSize: 50,
      keyGenerator: (operation: string, path: string) => {
        return `${operation}:${path}`;
      },
      includeErrors: true, // Cache file errors to prevent repeated failures
    });
  }
}

// Export singleton instances
export const commandDeduplicator = new CommandDeduplicator();
export const fileDeduplicator = new FileOperationDeduplicator();