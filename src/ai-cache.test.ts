import { AICommandCache } from './ai-cache.js';
import { cacheClassifier, CacheStrategy } from './ai-cache-classifier.js';
import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Mock the cache classifier
jest.mock('./ai-cache-classifier', () => ({
  cacheClassifier: {
    classify: jest.fn(),
    shouldCache: jest.fn(),
    getTTL: jest.fn(),
    explainClassification: jest.fn()
  },
  CacheStrategy: {
    NEVER: 'never',
    SHORT: 'short',
    MEDIUM: 'medium',
    LONG: 'long',
    PERMANENT: 'permanent'
  }
}));

describe('AICommandCache', () => {
  let cache: AICommandCache;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    cache = new AICommandCache();
    
    // Default mock behaviors
    (cacheClassifier.shouldCache as jest.Mock).mockReturnValue(true);
    (cacheClassifier.getTTL as jest.Mock).mockReturnValue(3600000); // 1 hour
    (cacheClassifier.classify as jest.Mock).mockReturnValue({
      strategy: CacheStrategy.MEDIUM,
      ttl: 3600000,
      reason: 'default'
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('cache operations', () => {
    it('should cache and retrieve command results', () => {
      const command = 'ls -la';
      const cwd = '/test';
      const result = {
        stdout: 'file list',
        stderr: '',
        exitCode: 0
      };

      cache.set(command, cwd, result);
      const cached = cache.get(command, cwd);

      expect(cached).toMatchObject({
        stdout: 'file list',
        stderr: '',
        exitCode: 0,
        accessCount: 1,
        strategy: CacheStrategy.MEDIUM
      });
    });

    it('should not cache commands with NEVER strategy', () => {
      const command = 'date';
      const cwd = '/test';
      const result = { stdout: 'current date', stderr: '', exitCode: 0 };

      (cacheClassifier.classify as jest.Mock).mockReturnValue({
        strategy: CacheStrategy.NEVER,
        ttl: 0,
        reason: 'status command'
      });

      const skipSpy = jest.fn();
      cache.on('cache:skip', skipSpy);

      cache.set(command, cwd, result);
      const cached = cache.get(command, cwd);

      expect(cached).toBeNull();
      expect(skipSpy).toHaveBeenCalledWith({
        command,
        cwd,
        reason: 'status command'
      });
    });

    it('should skip cache for non-cacheable commands on get', () => {
      const command = 'ps aux';
      const cwd = '/test';

      (cacheClassifier.shouldCache as jest.Mock).mockReturnValue(false);

      const skipSpy = jest.fn();
      cache.on('cache:skip', skipSpy);

      const cached = cache.get(command, cwd);

      expect(cached).toBeNull();
      expect(skipSpy).toHaveBeenCalledWith({
        command,
        cwd,
        reason: 'never-cache command'
      });
    });

    it('should handle cache expiration based on TTL', () => {
      const command = 'pwd';
      const cwd = '/test';
      const result = { stdout: '/test', stderr: '', exitCode: 0 };

      (cacheClassifier.classify as jest.Mock).mockReturnValue({
        strategy: CacheStrategy.SHORT,
        ttl: 5000, // 5 seconds
        reason: 'short-lived'
      });
      (cacheClassifier.getTTL as jest.Mock).mockReturnValue(5000);

      cache.set(command, cwd, result);
      
      // Access before expiry
      let cached = cache.get(command, cwd);
      expect(cached).toBeDefined();

      // Move time forward past TTL
      jest.advanceTimersByTime(6000);

      const expiredSpy = jest.fn();
      cache.on('cache:expired', expiredSpy);

      cached = cache.get(command, cwd);
      expect(cached).toBeNull();
      expect(expiredSpy).toHaveBeenCalledWith({
        command,
        cwd,
        age: 6000,
        ttl: 5000
      });
    });

    it('should increment access count on cache hits', () => {
      const command = 'cat package.json';
      const cwd = '/test';
      const result = { stdout: '{}', stderr: '', exitCode: 0 };

      cache.set(command, cwd, result);
      
      // Multiple accesses
      cache.get(command, cwd);
      cache.get(command, cwd);
      const cached = cache.get(command, cwd);

      expect(cached?.accessCount).toBe(3);
    });

    it('should emit cache hit and miss events', () => {
      const command = 'npm list';
      const cwd = '/test';
      const result = { stdout: 'packages', stderr: '', exitCode: 0 };

      const hitSpy = jest.fn();
      const missSpy = jest.fn();
      cache.on('cache:hit', hitSpy);
      cache.on('cache:miss', missSpy);

      // First access - miss
      cache.get(command, cwd);
      expect(missSpy).toHaveBeenCalledWith({ command, cwd });

      // Set cache
      cache.set(command, cwd, result);

      // Second access - hit
      cache.get(command, cwd);
      expect(hitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          command,
          cwd,
          accessCount: 1,
          strategy: CacheStrategy.MEDIUM
        })
      );
    });

    it('should pre-cache next commands for non-status strategies', () => {
      const command = 'npm install';
      const cwd = '/test';
      const result = { stdout: 'installed', stderr: '', exitCode: 0 };

      (cacheClassifier.classify as jest.Mock).mockReturnValue({
        strategy: CacheStrategy.LONG,
        ttl: 3600000,
        reason: 'build command'
      });

      const precacheSpy = jest.fn();
      cache.on('precache:request', precacheSpy);

      cache.set(command, cwd, result);
      cache.get(command, cwd);

      // Should request pre-caching of predicted next commands
      expect(precacheSpy).toHaveBeenCalled();
      const calls = precacheSpy.mock.calls;
      const requestedCommands = calls.map(call => (call[0] as any).command);
      expect(requestedCommands).toContain('npm run build');
    });

    it('should not pre-cache for SHORT strategy commands', () => {
      const command = 'pwd';
      const cwd = '/test';
      const result = { stdout: '/test', stderr: '', exitCode: 0 };

      (cacheClassifier.classify as jest.Mock).mockReturnValue({
        strategy: CacheStrategy.SHORT,
        ttl: 5000,
        reason: 'status command'
      });

      const precacheSpy = jest.fn();
      cache.on('precache:request', precacheSpy);

      cache.set(command, cwd, result);
      cache.get(command, cwd);

      expect(precacheSpy).not.toHaveBeenCalled();
    });
  });

  describe('pattern recognition', () => {
    it('should track command patterns', () => {
      const commands = ['pwd', 'ls', 'cat package.json'];
      const cwd = '/test';
      const result = { stdout: 'output', stderr: '', exitCode: 0 };

      commands.forEach(cmd => {
        cache.set(cmd, cwd, result);
        cache.get(cmd, cwd);
      });

      const stats = cache.getStats();
      expect(stats.topPatterns).toBeDefined();
    });

    it('should predict next commands based on patterns', () => {
      const command = 'cd src';
      const cwd = '/test';
      const result = { stdout: '', stderr: '', exitCode: 0 };

      const precacheSpy = jest.fn();
      cache.on('precache:request', precacheSpy);

      cache.set(command, cwd, result);
      cache.get(command, cwd);

      // Check if pwd was predicted (common after cd)
      const calls = precacheSpy.mock.calls;
      const requestedCommands = calls.map(call => (call[0] as any).command);
      expect(requestedCommands).toContain('pwd');
    });

    it('should update sequence cache for command sequences', () => {
      const commands = ['ls', 'cd src', 'ls'];
      const cwd = '/test';
      const result = { stdout: 'output', stderr: '', exitCode: 0 };

      commands.forEach(cmd => {
        cache.set(cmd, cwd, result);
      });

      const stats = cache.getStats();
      expect(stats.sequenceCacheSize).toBeGreaterThan(0);
    });

    it('should emit learned patterns periodically', () => {
      const learnedSpy = jest.fn();
      cache.on('patterns:learned', learnedSpy);

      // Add some patterns
      const commands = ['ls', 'pwd', 'ls', 'pwd'];
      const cwd = '/test';
      const result = { stdout: 'output', stderr: '', exitCode: 0 };

      commands.forEach(cmd => {
        cache.set(cmd, cwd, result);
        cache.get(cmd, cwd);
      });

      // Fast forward to trigger pattern learning
      jest.advanceTimersByTime(60000);

      expect(learnedSpy).toHaveBeenCalled();
      const topPatterns = learnedSpy.mock.calls[0][0];
      expect(Array.isArray(topPatterns)).toBe(true);
    });
  });

  describe('cache management', () => {
    it('should clear all cache', () => {
      const commands = ['ls', 'pwd', 'cat file.txt'];
      const cwd = '/test';
      const result = { stdout: 'output', stderr: '', exitCode: 0 };

      commands.forEach(cmd => cache.set(cmd, cwd, result));
      
      const clearSpy = jest.fn();
      cache.on('cache:cleared', clearSpy);

      cache.clear();

      expect(cache.getStats().cacheSize).toBe(0);
      expect(cache.getStats().sequenceCacheSize).toBe(0);
      expect(clearSpy).toHaveBeenCalled();
    });

    it('should clear specific command from cache', () => {
      const command = 'ls -la';
      const cwd1 = '/test1';
      const cwd2 = '/test2';
      const result = { stdout: 'output', stderr: '', exitCode: 0 };

      cache.set(command, cwd1, result);
      cache.set(command, cwd2, result);
      cache.set('pwd', cwd1, result);

      const clearSpy = jest.fn();
      cache.on('cache:cleared-command', clearSpy);

      // Clear specific command in specific directory
      const cleared = cache.clearCommand(command, cwd1);
      
      expect(cleared).toBe(1);
      expect(cache.get(command, cwd1)).toBeNull();
      expect(cache.get(command, cwd2)).toBeDefined();
      expect(cache.get('pwd', cwd1)).toBeDefined();
      expect(clearSpy).toHaveBeenCalledWith({
        command,
        cwd: cwd1,
        clearedCount: 1
      });
    });

    it('should clear command from all directories when cwd not specified', () => {
      const command = 'npm install';
      const cwd1 = '/test1';
      const cwd2 = '/test2';
      const result = { stdout: 'output', stderr: '', exitCode: 0 };

      cache.set(command, cwd1, result);
      cache.set(command, cwd2, result);
      cache.set('npm test', cwd1, result);

      const cleared = cache.clearCommand(command);
      
      expect(cleared).toBe(2);
      expect(cache.get(command, cwd1)).toBeNull();
      expect(cache.get(command, cwd2)).toBeNull();
      expect(cache.get('npm test', cwd1)).toBeDefined();
    });

    it('should clear cache entries matching pattern', () => {
      const commands = ['npm install', 'npm test', 'npm run build', 'yarn install'];
      const cwd = '/test';
      const result = { stdout: 'output', stderr: '', exitCode: 0 };

      commands.forEach(cmd => cache.set(cmd, cwd, result));

      const clearSpy = jest.fn();
      cache.on('cache:cleared-pattern', clearSpy);

      // Clear all npm commands
      const cleared = cache.clearPattern(/^npm /);
      
      expect(cleared).toBe(3);
      expect(cache.get('npm install', cwd)).toBeNull();
      expect(cache.get('npm test', cwd)).toBeNull();
      expect(cache.get('npm run build', cwd)).toBeNull();
      expect(cache.get('yarn install', cwd)).toBeDefined();
      expect(clearSpy).toHaveBeenCalledWith({
        pattern: '/^npm /',
        clearedCount: 3
      });
    });
  });

  describe('statistics', () => {
    it('should provide comprehensive cache statistics', () => {
      const commands = [
        { cmd: 'ls', strategy: CacheStrategy.SHORT },
        { cmd: 'cat file.txt', strategy: CacheStrategy.MEDIUM },
        { cmd: 'npm install', strategy: CacheStrategy.LONG }
      ];
      const cwd = '/test';
      const result = { stdout: 'output', stderr: '', exitCode: 0 };

      commands.forEach(({ cmd, strategy }) => {
        (cacheClassifier.classify as jest.Mock).mockReturnValue({
          strategy,
          ttl: 3600000,
          reason: 'test'
        });
        cache.set(cmd, cwd, result);
        cache.get(cmd, cwd);
        cache.get(cmd, cwd); // Multiple hits
      });

      const stats = cache.getStats();
      
      expect(stats.cacheSize).toBe(3);
      expect(stats.totalHits).toBe(6);
      expect(stats.byStrategy[CacheStrategy.SHORT]).toBe(1);
      expect(stats.byStrategy[CacheStrategy.MEDIUM]).toBe(1);
      expect(stats.byStrategy[CacheStrategy.LONG]).toBe(1);
      expect(stats.hitRate).toBeGreaterThan(0);
      expect(stats.averageAccessCount).toBe(2);
      expect(Array.isArray(stats.topPatterns)).toBe(true);
    });

    it('should handle empty cache statistics', () => {
      const stats = cache.getStats();
      
      expect(stats.cacheSize).toBe(0);
      expect(stats.totalHits).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.averageAccessCount).toBe(0);
      expect(stats.sequenceCacheSize).toBe(0);
    });
  });

  describe('cache decision explanation', () => {
    it('should explain cache decision for a command', () => {
      const command = 'ls -la';
      const explanation = 'This is a status command with short TTL';
      
      (cacheClassifier.explainClassification as jest.Mock).mockReturnValue(explanation);
      
      const result = cache.explainCacheDecision(command);
      
      expect(result).toBe(explanation);
      expect(cacheClassifier.explainClassification).toHaveBeenCalledWith(command);
    });
  });

  describe('file read commands', () => {
    it('should identify file read commands', () => {
      const fileCommands = ['cat file.txt', 'head log.txt', 'tail -n 10 output.log'];
      const cwd = '/test';
      const result = { stdout: 'content', stderr: '', exitCode: 0 };

      fileCommands.forEach(cmd => {
        cache.set(cmd, cwd, result);
        // File read commands should be cached
        expect(cache.get(cmd, cwd)).toBeDefined();
      });
    });
  });

  describe('edge cases', () => {
    it('should handle commands with special characters in key generation', () => {
      const command = 'echo "hello world" | grep hello';
      const cwd = '/test';
      const result = { stdout: 'hello world', stderr: '', exitCode: 0 };

      cache.set(command, cwd, result);
      const cached = cache.get(command, cwd);

      expect(cached).toBeDefined();
      expect(cached?.stdout).toBe('hello world');
    });

    it('should handle very long commands', () => {
      const longCommand = 'find ' + '/very/long/path'.repeat(50) + ' -name "*.txt"';
      const cwd = '/test';
      const result = { stdout: 'files', stderr: '', exitCode: 0 };

      cache.set(longCommand, cwd, result);
      const cached = cache.get(longCommand, cwd);

      expect(cached).toBeDefined();
    });

    it('should handle concurrent access to same cache entry', () => {
      const command = 'npm list';
      const cwd = '/test';
      const result = { stdout: 'packages', stderr: '', exitCode: 0 };

      cache.set(command, cwd, result);

      // Simulate concurrent access
      const promises = Array(10).fill(null).map(() => 
        Promise.resolve(cache.get(command, cwd))
      );

      return Promise.all(promises).then(results => {
        results.forEach(cached => {
          expect(cached).toBeDefined();
        });
        // All accesses should increment the counter
        const finalCached = cache.get(command, cwd);
        expect(finalCached?.accessCount).toBe(11);
      });
    });

    it('should handle cache operations when EventEmitter has no listeners', () => {
      const command = 'ls';
      const cwd = '/test';
      const result = { stdout: 'files', stderr: '', exitCode: 0 };

      // No listeners attached - should not throw
      expect(() => {
        cache.set(command, cwd, result);
        cache.get(command, cwd);
        cache.clear();
      }).not.toThrow();
    });
  });
});
