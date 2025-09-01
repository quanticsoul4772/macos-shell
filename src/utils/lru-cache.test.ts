import { LRUCache } from './lru-cache';

describe('LRUCache', () => {
  let cache: LRUCache<string, number>;

  beforeEach(() => {
    cache = new LRUCache<string, number>(3);
  });

  describe('basic operations', () => {
    it('should store and retrieve values', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBeUndefined();
    });

    it('should return undefined for non-existent keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should update existing values', () => {
      cache.set('a', 1);
      cache.set('a', 2);
      
      expect(cache.get('a')).toBe(2);
      expect(cache.size()).toBe(1);
    });

    it('should check if key exists', () => {
      cache.set('a', 1);
      
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
    });

    it('should delete keys', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      
      expect(cache.delete('a')).toBe(true);
      expect(cache.has('a')).toBe(false);
      expect(cache.size()).toBe(1);
      
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      cache.clear();
      
      expect(cache.size()).toBe(0);
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used item when capacity exceeded', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.set('d', 4); // Should evict 'a'
      
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(cache.size()).toBe(3);
    });

    it('should update LRU order on get', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      // Access 'a' to make it most recently used
      cache.get('a');
      
      // Add new item, should evict 'b' not 'a'
      cache.set('d', 4);
      
      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });

    it('should update LRU order on set for existing key', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      // Update 'a' to make it most recently used
      cache.set('a', 10);
      
      // Add new item, should evict 'b' not 'a'
      cache.set('d', 4);
      
      expect(cache.get('a')).toBe(10);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
    });
  });

  describe('iteration', () => {
    it('should iterate over keys', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      
      const keys = Array.from(cache.keys());
      
      expect(keys).toHaveLength(3);
      expect(keys).toContain('a');
      expect(keys).toContain('b');
      expect(keys).toContain('c');
    });

    it('should maintain insertion order in keys', () => {
      cache.set('c', 3);
      cache.set('a', 1);
      cache.set('b', 2);
      
      const keys = Array.from(cache.keys());
      
      expect(keys).toEqual(['c', 'a', 'b']);
    });
  });

  describe('edge cases', () => {
    it('should handle cache with size 1', () => {
      const smallCache = new LRUCache<string, number>(1);
      
      smallCache.set('a', 1);
      smallCache.set('b', 2);
      
      expect(smallCache.has('a')).toBe(false);
      expect(smallCache.get('b')).toBe(2);
      expect(smallCache.size()).toBe(1);
    });

    it('should handle default max size', () => {
      const defaultCache = new LRUCache<string, number>();
      
      // Default max size is 100
      for (let i = 0; i < 101; i++) {
        defaultCache.set(`key${i}`, i);
      }
      
      expect(defaultCache.size()).toBe(100);
      expect(defaultCache.has('key0')).toBe(false);
      expect(defaultCache.has('key100')).toBe(true);
    });
  });
});
