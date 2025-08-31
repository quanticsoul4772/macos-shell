/**
 * LRU (Least Recently Used) Cache implementation
 * Prevents unbounded memory growth in pattern caching
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;
  
  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }
  
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  set(key: K, value: V): void {
    // Remove if exists to update position
    this.cache.delete(key);
    this.cache.set(key, value);
    
    // Evict oldest if over limit
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }
  
  delete(key: K): boolean {
    return this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  size(): number {
    return this.cache.size;
  }
  
  has(key: K): boolean {
    return this.cache.has(key);
  }
  
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }
}
