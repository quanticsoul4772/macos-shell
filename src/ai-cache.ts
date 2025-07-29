import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { cacheClassifier, CacheStrategy } from './ai-cache-classifier.js';

/**
 * AI-Optimized Command Sequence Cache
 * Now with smart classification to avoid caching status commands
 */

interface CachedResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timestamp: number;
  accessCount: number;
  strategy: CacheStrategy;
}

interface CommandSequence {
  commands: string[];
  results: CachedResult[];
  pattern: string;
  lastAccessed: number;
}

export class AICommandCache extends EventEmitter {
  private cache: LRUCache<string, CachedResult>;
  private sequenceCache: Map<string, CommandSequence>;
  private commandHistory: string[] = [];
  private patterns: Map<string, number> = new Map();
  private keyToCommandMap: Map<string, string> = new Map();
  
  // AI-specific cache settings (TTL now varies by command)
  private readonly AI_CACHE_OPTIONS = {
    max: 10000,                    // Much larger cache for AI
    ttl: 1 * 60 * 60 * 1000,      // Max 1 hour (will be overridden per command)
    updateAgeOnGet: true,
    allowStale: false,             // Don't serve stale data
  };

  // Common AI command patterns (updated to respect cache strategy)
  private readonly AI_PATTERNS = [
    ['pwd', 'ls', 'cat:package.json'],
    ['ls', 'cd:*', 'ls'],
    ['npm:install', 'npm:run:*', 'npm:test'],
    ['cat:*', 'grep:*', 'cat:*'],
    ['find:*', 'cat:*'],
  ];

  constructor() {
    super();
    this.cache = new LRUCache<string, CachedResult>(this.AI_CACHE_OPTIONS);
    this.sequenceCache = new Map();
    this.setupPatternRecognition();
  }

  /**
   * Get cached result or null (now respects cache strategy)
   */
  get(command: string, cwd: string): CachedResult | null {
    // First check if this command should be cached at all
    if (!cacheClassifier.shouldCache(command)) {
      this.emit('cache:skip', { command, cwd, reason: 'never-cache command' });
      return null;
    }

    const key = this.generateKey(command, cwd);
    const cached = this.cache.get(key);
    
    if (cached) {
      // Check if cache is still valid based on strategy
      const ttl = cacheClassifier.getTTL(command);
      const age = Date.now() - cached.timestamp;
      
      if (age > ttl) {
        // Cache expired based on command-specific TTL
        this.cache.delete(key);
        this.emit('cache:expired', { command, cwd, age, ttl });
        return null;
      }

      cached.accessCount++;
      this.trackCommandPattern(command);
      this.emit('cache:hit', { 
        command, 
        cwd, 
        accessCount: cached.accessCount,
        strategy: cached.strategy,
        age: Math.round(age / 1000) + 's'
      });
      
      // Only pre-cache for non-status commands
      if (cached.strategy !== CacheStrategy.NEVER && cached.strategy !== CacheStrategy.SHORT) {
        this.preCacheNextCommands(command, cwd);
      }
      
      return cached;
    }
    
    this.emit('cache:miss', { command, cwd });
    return null;
  }

  /**
   * Store command result with AI optimizations and smart classification
   */
  set(command: string, cwd: string, result: any): void {
    // Check cache strategy
    const classification = cacheClassifier.classify(command);
    
    // Don't cache NEVER strategy commands
    if (classification.strategy === CacheStrategy.NEVER) {
      this.emit('cache:skip', { 
        command, 
        cwd, 
        reason: classification.reason 
      });
      return;
    }

    const key = this.generateKey(command, cwd);
    
    // Track the mapping
    this.keyToCommandMap.set(key, command);
    
    const cachedResult: CachedResult = {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timestamp: Date.now(),
      accessCount: 0,
      strategy: classification.strategy,
    };

    // Store with command-specific TTL
    this.cache.set(key, cachedResult, { ttl: classification.ttl });
    this.commandHistory.push(command);
    
    this.emit('cache:set', {
      command,
      cwd,
      strategy: classification.strategy,
      ttl: classification.ttl,
      reason: classification.reason
    });
    
    this.updateSequenceCache(command, cwd, cachedResult);
  }

  /**
   * AI-specific: Pre-cache likely next commands (skip status commands)
   */
  private async preCacheNextCommands(command: string, cwd: string): Promise<void> {
    const predictions = this.predictNextCommands(command);
    
    for (const nextCmd of predictions) {
      // Only pre-cache if it's a cacheable command
      if (cacheClassifier.shouldCache(nextCmd)) {
        const key = this.generateKey(nextCmd, cwd);
        if (!this.cache.has(key)) {
          this.emit('precache:request', { command: nextCmd, cwd });
        }
      }
    }
  }

  /**
   * Predict next commands based on patterns (filter out status commands)
   */
  private predictNextCommands(command: string): string[] {
    const predictions: string[] = [];
    
    // Check if command matches known patterns
    for (const pattern of this.AI_PATTERNS) {
      const index = pattern.findIndex(p => this.matchesPattern(command, p));
      if (index >= 0 && index < pattern.length - 1) {
        // Add next command in pattern
        const nextPattern = pattern[index + 1];
        const nextCommand = this.expandPattern(nextPattern, command);
        
        // Only predict cacheable commands
        if (cacheClassifier.shouldCache(nextCommand)) {
          predictions.push(nextCommand);
        }
      }
    }
    
    // Add common follow-ups (filtered)
    if (command === 'pwd') {
      // Don't predict 'ls' as it's a status command
      predictions.push('cat package.json', 'cat README.md');
    } else if (command.startsWith('cd ')) {
      // ls commands are status commands, skip them
      predictions.push('pwd'); // pwd has short cache
    } else if (command === 'npm install') {
      predictions.push('npm run build', 'npm test');
    }
    
    return predictions.slice(0, 3); // Limit predictions
  }

  /**
   * Check if command is a file read operation
   */
  private isFileReadCommand(command: string): boolean {
    const fileReadCommands = ['cat', 'head', 'tail', 'less', 'more'];
    const cmd = command.split(' ')[0];
    return fileReadCommands.includes(cmd);
  }

  /**
   * Generate cache key
   */
  private generateKey(command: string, cwd: string): string {
    return createHash('md5')
      .update(`${cwd}:${command}`)
      .digest('hex');
  }

  /**
   * Pattern matching for commands
   */
  private matchesPattern(command: string, pattern: string): boolean {
    if (pattern.includes(':*')) {
      const [cmd] = pattern.split(':');
      return command.startsWith(cmd + ' ');
    }
    if (pattern.includes(':')) {
      const [cmd, arg] = pattern.split(':');
      return command === `${cmd} ${arg}`;
    }
    return command === pattern;
  }

  /**
   * Expand pattern with actual values
   */
  private expandPattern(pattern: string, previousCommand: string): string {
    if (pattern.includes('*')) {
      return pattern.replace('*', 'predicted');
    }
    return pattern.replace(':', ' ');
  }

  /**
   * Track command patterns for learning
   */
  private trackCommandPattern(command: string): void {
    const recent = this.commandHistory.slice(-3).join(' -> ');
    this.patterns.set(recent, (this.patterns.get(recent) || 0) + 1);
  }

  /**
   * Update sequence cache
   */
  private updateSequenceCache(command: string, cwd: string, result: CachedResult): void {
    if (this.commandHistory.length >= 2) {
      const sequence = this.commandHistory.slice(-3);
      const key = sequence.join('|');
      
      if (!this.sequenceCache.has(key)) {
        this.sequenceCache.set(key, {
          commands: sequence,
          results: [result],
          pattern: key,
          lastAccessed: Date.now(),
        });
      }
    }
  }

  /**
   * Setup pattern recognition
   */
  private setupPatternRecognition(): void {
    // Learn from patterns over time
    setInterval(() => {
      const topPatterns = Array.from(this.patterns.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      
      this.emit('patterns:learned', topPatterns);
    }, 60000); // Every minute
  }

  /**
   * Get cache statistics for AI monitoring
   */
  getStats(): any {
    const cacheEntries = Array.from(this.cache.entries());
    const byStrategy: Record<CacheStrategy, number> = {
      [CacheStrategy.NEVER]: 0,
      [CacheStrategy.SHORT]: 0,
      [CacheStrategy.MEDIUM]: 0,
      [CacheStrategy.LONG]: 0,
      [CacheStrategy.PERMANENT]: 0,
    };

    let totalHits = 0;
    cacheEntries.forEach(([_, entry]) => {
      byStrategy[entry.strategy]++;
      totalHits += entry.accessCount;
    });

    const stats = {
      cacheSize: this.cache.size,
      totalHits,
      byStrategy,
      hitRate: this.cache.size > 0 ? 
        (totalHits / (totalHits + this.cache.size)) * 100 : 0,
      topPatterns: Array.from(this.patterns.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      sequenceCacheSize: this.sequenceCache.size,
      averageAccessCount: totalHits / this.cache.size || 0,
    };
    
    return stats;
  }

  /**
   * Clear cache (rarely needed for AI)
   */
  clear(): void {
    this.cache.clear();
    this.sequenceCache.clear();
    this.commandHistory = [];
    this.patterns.clear();
    this.emit('cache:cleared');
  }

  /**
   * Explain cache decision for a command (debugging)
   */
  explainCacheDecision(command: string): string {
    return cacheClassifier.explainClassification(command);
  }

  /**
   * Clear specific command from cache
   */
  clearCommand(command: string, cwd?: string): number {
    let clearedCount = 0;
    
    if (cwd) {
      const key = this.generateKey(command, cwd);
      if (this.cache.delete(key)) {
        this.keyToCommandMap.delete(key);
        clearedCount++;
      }
    } else {
      // Clear all entries for this command across all directories
      for (const [key, entry] of this.cache.entries()) {
        // Key format is hash of "command:cwd"
        // We need to check if this entry matches the command
        if (this.commandMatchesKey(command, key)) {
          this.cache.delete(key);
          this.keyToCommandMap.delete(key);
          clearedCount++;
        }
      }
    }
    
    this.emit('cache:cleared-command', { command, cwd, clearedCount });
    return clearedCount;
  }

  /**
   * Clear cache entries matching a pattern
   */
  clearPattern(pattern: RegExp): number {
    let clearedCount = 0;
    
    // Store commands to check
    const commandsToCheck = new Map<string, string>();
    
    // First pass: collect all unique commands
    for (const [key, entry] of this.cache.entries()) {
      // Extract command from the key (this is a bit tricky since we hash it)
      // We'll need to track commands when we cache them
      const command = this.keyToCommandMap.get(key);
      if (command) {
        commandsToCheck.set(key, command);
      }
    }
    
    // Second pass: delete matching entries
    for (const [key, command] of commandsToCheck) {
      if (pattern.test(command)) {
        if (this.cache.delete(key)) {
          this.keyToCommandMap.delete(key);
          clearedCount++;
        }
      }
    }
    
    this.emit('cache:cleared-pattern', { pattern: pattern.toString(), clearedCount });
    return clearedCount;
  }

  /**
   * Helper to check if a key matches a command
   */
  private commandMatchesKey(command: string, key: string): boolean {
    // Use our mapping
    return this.keyToCommandMap.get(key) === command;
  }
}

// Export singleton instance
export const aiCache = new AICommandCache();
