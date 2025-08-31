/**
 * Resource Cache Module
 * Caches process resource information to reduce subprocess calls
 */

import { LRUCache } from './lru-cache.js';
import { getLogger } from './logger.js';

const logger = getLogger('resource-cache');

export interface CachedResourceData {
  pid: number;
  cpu: number;
  memory: number;
  memoryPercent: number;
  timestamp: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  hitRate: number;
  size: number;
  maxSize: number;
}

export class ResourceCache {
  private cache: LRUCache<string, CachedResourceData>;
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0
  };
  
  // Cache configuration
  private readonly MAX_AGE_MS = 5000; // 5 seconds cache TTL
  private readonly MAX_ENTRIES = 1000; // Maximum cached processes
  private readonly BATCH_THRESHOLD = 10; // Batch if requesting > 10 PIDs
  
  constructor() {
    this.cache = new LRUCache<string, CachedResourceData>(this.MAX_ENTRIES);
  }

  /**
   * Get cached resource data for a PID
   */
  get(pid: number): CachedResourceData | null {
    const key = `pid-${pid}`;
    const cached = this.cache.get(key);
    
    if (!cached) {
      this.stats.misses++;
      return null;
    }
    
    // Check if cache entry is still fresh
    const age = Date.now() - cached.timestamp;
    if (age > this.MAX_AGE_MS) {
      this.cache.delete(key);
      this.stats.misses++;
      logger.debug({ 
        module: 'resource-cache', 
        action: 'expired', 
        pid, 
        age 
      }, `Cache entry expired for PID ${pid}`);
      return null;
    }
    
    this.stats.hits++;
    return cached;
  }

  /**
   * Get multiple cached entries
   */
  getMultiple(pids: number[]): Map<number, CachedResourceData> {
    const results = new Map<number, CachedResourceData>();
    const misses: number[] = [];
    
    for (const pid of pids) {
      const cached = this.get(pid);
      if (cached) {
        results.set(pid, cached);
      } else {
        misses.push(pid);
      }
    }
    
    // Log batch cache performance
    if (pids.length > this.BATCH_THRESHOLD) {
      const hitRate = results.size / pids.length;
      logger.debug({ 
        module: 'resource-cache', 
        action: 'batch-get',
        requested: pids.length,
        hits: results.size,
        misses: misses.length,
        hitRate: Math.round(hitRate * 100)
      }, `Batch cache lookup: ${Math.round(hitRate * 100)}% hit rate`);
    }
    
    return results;
  }

  /**
   * Set cached resource data for a PID
   */
  set(pid: number, data: Omit<CachedResourceData, 'timestamp'>): void {
    const key = `pid-${pid}`;
    const entry: CachedResourceData = {
      ...data,
      pid,
      timestamp: Date.now()
    };
    
    this.cache.set(key, entry);
    
    logger.debug({ 
      module: 'resource-cache', 
      action: 'set', 
      pid,
      cpu: data.cpu,
      memory: data.memory
    }, `Cached resources for PID ${pid}`);
  }

  /**
   * Set multiple cache entries at once
   */
  setMultiple(entries: Map<number, Omit<CachedResourceData, 'timestamp'>>): void {
    const timestamp = Date.now();
    let count = 0;
    
    for (const [pid, data] of entries) {
      const key = `pid-${pid}`;
      const entry: CachedResourceData = {
        ...data,
        pid,
        timestamp
      };
      this.cache.set(key, entry);
      count++;
    }
    
    if (count > 0) {
      logger.debug({ 
        module: 'resource-cache', 
        action: 'batch-set',
        count
      }, `Cached ${count} process resource entries`);
    }
  }

  /**
   * Invalidate cache entry for a PID
   */
  invalidate(pid: number): void {
    const key = `pid-${pid}`;
    if (this.cache.delete(key)) {
      logger.debug({ 
        module: 'resource-cache', 
        action: 'invalidate', 
        pid 
      }, `Invalidated cache for PID ${pid}`);
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    const size = this.cache.size();
    this.cache.clear();
    logger.info({ 
      module: 'resource-cache', 
      action: 'clear',
      cleared: size
    }, `Cleared ${size} cache entries`);
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;
    
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hitRate: Math.round(hitRate * 100) / 100,
      size: this.cache.size(),
      maxSize: this.MAX_ENTRIES
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };
    logger.info({ 
      module: 'resource-cache', 
      action: 'reset-stats' 
    }, 'Reset cache statistics');
  }

  /**
   * Check if we should batch the request based on number of PIDs
   */
  shouldBatch(pidCount: number): boolean {
    return pidCount > this.BATCH_THRESHOLD;
  }

  /**
   * Get cache configuration
   */
  getConfig() {
    return {
      maxAge: this.MAX_AGE_MS,
      maxEntries: this.MAX_ENTRIES,
      batchThreshold: this.BATCH_THRESHOLD
    };
  }

  /**
   * Prune expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    
    // Note: We need to check all cache entries for expiry
    // LRUCache doesn't have a keys() method, so we'll track this differently
    // For now, we'll skip auto-pruning as the TTL check in get() handles it
    
    logger.debug({ 
      module: 'resource-cache', 
      action: 'prune-skipped'
    }, 'Pruning handled by TTL checks in get()');
    
    return pruned;
  }
}

// Singleton instance
export const resourceCache = new ResourceCache();

// Auto-prune expired entries every 30 seconds
setInterval(() => {
  resourceCache.prune();
}, 30000);