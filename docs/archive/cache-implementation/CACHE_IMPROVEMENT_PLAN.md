# Dynamic Cache Management Implementation Plan

## Overview
This document outlines the technical implementation for making the macOS Shell MCP cache system adaptable at runtime. The improvements allow Claude (the sole user) to manage cache behavior without code changes.

## Current State Analysis
- **Version**: 3.1.1
- **Current Files**:
  - `src/ai-cache-classifier.ts` - Hardcoded regex patterns for cache classification
  - `src/ai-cache.ts` - LRU cache implementation with TTL support
  - `src/tools/command/ai-command-enhancer.ts` - Integration layer for caching
  - `src/tools/command-tools.ts` - Tool registration

## Implementation Phases

### Phase 1: Cache Management MCP Tools (Week 1)

#### 1.1 Create New File: `src/tools/cache-management-tools.ts`

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { aiCache } from '../ai-cache.js';
import { cacheClassifier, CacheStrategy } from '../ai-cache-classifier.js';
import logger from '../utils/logger.js';

export function registerCacheManagementTools(server: McpServer) {
  // Tool 1: Clear specific command from cache
  server.tool(
    "cache_clear_command",
    {
      command: z.string().describe("The command to clear from cache"),
      cwd: z.string().optional().describe("Optional working directory to clear command from")
    },
    async ({ command, cwd }) => {
      const clearedCount = aiCache.clearCommand(command, cwd);
      
      logger.info({
        module: 'cache-management',
        action: 'clear-command',
        command,
        cwd,
        clearedCount
      }, `Cleared ${clearedCount} cache entries for command: ${command}`);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            clearedCount,
            command,
            cwd: cwd || "all directories"
          }, null, 2)
        }]
      };
    }
  );

  // Tool 2: Clear by pattern
  server.tool(
    "cache_clear_pattern",
    {
      pattern: z.string().describe("Regex pattern to match commands to clear")
    },
    async ({ pattern }) => {
      try {
        const regex = new RegExp(pattern);
        const clearedCount = aiCache.clearPattern(regex);
        
        logger.info({
          module: 'cache-management',
          action: 'clear-pattern',
          pattern,
          clearedCount
        }, `Cleared ${clearedCount} cache entries matching pattern: ${pattern}`);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              clearedCount,
              pattern
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Invalid regex pattern: ${error.message}`
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // Tool 3: Mark command as never cache
  server.tool(
    "cache_mark_never",
    {
      command: z.string().describe("Command or pattern to never cache"),
      isPattern: z.boolean().default(false).describe("Whether the command is a regex pattern"),
      reason: z.string().describe("Reason for marking as never-cache")
    },
    async ({ command, isPattern, reason }) => {
      try {
        const pattern = isPattern ? new RegExp(command) : command;
        
        cacheClassifier.addRule({
          pattern,
          strategy: CacheStrategy.NEVER,
          reason: `User marked: ${reason}`
        }, 'high');
        
        // Save to persistent storage
        await saveLearningRule({
          pattern: pattern.toString(),
          strategy: CacheStrategy.NEVER,
          reason,
          timestamp: new Date().toISOString(),
          source: 'user'
        });
        
        logger.info({
          module: 'cache-management',
          action: 'mark-never-cache',
          command,
          isPattern,
          reason
        }, `Marked as never-cache: ${command}`);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              command,
              isPattern,
              reason,
              message: "Command will never be cached in future executions"
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: error.message
            }, null, 2)
          }],
          isError: true
        };
      }
    }
  );

  // Tool 4: Get cache statistics
  server.tool(
    "cache_stats",
    {},
    async () => {
      const stats = aiCache.getStats();
      const learnedRules = await loadLearnedRules();
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...stats,
            learnedRulesCount: learnedRules.length,
            cacheEnabled: process.env.MCP_DISABLE_CACHE !== 'true'
          }, null, 2)
        }]
      };
    }
  );

  // Tool 5: Explain cache decision
  server.tool(
    "cache_explain",
    {
      command: z.string().describe("Command to explain cache decision for")
    },
    async ({ command }) => {
      const explanation = aiCache.explainCacheDecision(command);
      const classification = cacheClassifier.classify(command);
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            command,
            explanation,
            classification,
            willBeCached: classification.strategy !== CacheStrategy.NEVER
          }, null, 2)
        }]
      };
    }
  );
}

// Helper functions for persistent storage
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const LEARNED_RULES_FILE = path.join(os.homedir(), '.mcp-cache-rules.json');

interface LearnedRule {
  pattern: string;
  strategy: CacheStrategy;
  reason: string;
  timestamp: string;
  source: 'user' | 'auto-detect';
}

async function saveLearningRule(rule: LearnedRule): Promise<void> {
  try {
    let rules: LearnedRule[] = [];
    
    try {
      const content = await fs.readFile(LEARNED_RULES_FILE, 'utf8');
      rules = JSON.parse(content);
    } catch (error) {
      // File doesn't exist, start with empty array
    }
    
    // Add new rule
    rules.push(rule);
    
    // Keep last 1000 rules
    if (rules.length > 1000) {
      rules = rules.slice(-1000);
    }
    
    await fs.writeFile(LEARNED_RULES_FILE, JSON.stringify(rules, null, 2));
  } catch (error) {
    logger.error({
      module: 'cache-management',
      action: 'save-learned-rule',
      error: error.message
    }, 'Failed to save learned rule');
  }
}

async function loadLearnedRules(): Promise<LearnedRule[]> {
  try {
    const content = await fs.readFile(LEARNED_RULES_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return [];
  }
}
```

#### 1.2 Update `src/ai-cache.ts` to Add New Methods

Add these methods to the AICommandCache class:

```typescript
/**
 * Clear specific command from cache
 */
clearCommand(command: string, cwd?: string): number {
  let clearedCount = 0;
  
  if (cwd) {
    const key = this.generateKey(command, cwd);
    if (this.cache.delete(key)) {
      clearedCount++;
    }
  } else {
    // Clear all entries for this command across all directories
    for (const [key, entry] of this.cache.entries()) {
      // Key format is hash of "command:cwd"
      // We need to check if this entry matches the command
      if (this.commandMatchesKey(command, key)) {
        this.cache.delete(key);
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
        clearedCount++;
      }
    }
  }
  
  this.emit('cache:cleared-pattern', { pattern: pattern.toString(), clearedCount });
  return clearedCount;
}

/**
 * Track command to key mapping for pattern clearing
 */
private keyToCommandMap: Map<string, string> = new Map();

/**
 * Override set to track command mapping
 */
set(command: string, cwd: string, result: any): void {
  const classification = cacheClassifier.classify(command);
  
  if (classification.strategy === CacheStrategy.NEVER) {
    this.emit('cache:skip', { command, cwd, reason: classification.reason });
    return;
  }

  const key = this.generateKey(command, cwd);
  const ttl = classification.ttl;
  
  // Track the mapping
  this.keyToCommandMap.set(key, command);
  
  const cachedResult: CachedResult = {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.exitCode || 0,
    timestamp: Date.now(),
    accessCount: 0,
    strategy: classification.strategy
  };

  this.cache.set(key, cachedResult, { ttl });
  this.trackCommandHistory(command);
  this.updateSequenceCache(command, cwd, cachedResult);
  
  this.emit('cache:set', { command, cwd, ttl, strategy: classification.strategy });
}

/**
 * Helper to check if a key matches a command
 */
private commandMatchesKey(command: string, key: string): boolean {
  // Use our mapping
  return this.keyToCommandMap.get(key) === command;
}
```

#### 1.3 Update `src/tools/command-tools.ts` to Register Cache Tools

Add import and registration:

```typescript
import { registerCacheManagementTools } from './cache-management-tools.js';

export function registerCommandTools(
  server: McpServer, 
  sessionManager: SessionManager,
  batchExecutor: BatchExecutor
) {
  // ... existing code ...

  // Register cache management tools
  registerCacheManagementTools(server);
}
```

### Phase 2: Duplicate Detection System (Week 2)

#### 2.1 Create New File: `src/duplicate-detector.ts`

```typescript
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import logger from './utils/logger.js';

interface ResultRecord {
  hash: string;
  timestamp: number;
  stdout: string;
  stderr: string;
}

interface DuplicateEvent {
  command: string;
  cwd: string;
  duplicateCount: number;
  timeSpan: number;
}

export class DuplicateDetector extends EventEmitter {
  private commandHistory: Map<string, ResultRecord[]> = new Map();
  private detectionWindow = 5000; // 5 seconds
  private duplicateThreshold = 2; // 2 identical results trigger detection
  
  /**
   * Check if a command result is a duplicate
   */
  checkDuplicate(command: string, cwd: string, result: {
    stdout: string;
    stderr: string;
    exitCode: number;
  }): boolean {
    const key = `${command}:${cwd}`;
    const resultHash = this.hashResult(result);
    const now = Date.now();
    
    // Get history for this command
    const history = this.commandHistory.get(key) || [];
    
    // Remove old entries outside detection window
    const recentHistory = history.filter(
      record => now - record.timestamp < this.detectionWindow
    );
    
    // Count duplicates in recent history
    const duplicates = recentHistory.filter(
      record => record.hash === resultHash
    );
    
    // Check if we've hit the threshold
    const isDuplicate = duplicates.length >= this.duplicateThreshold - 1;
    
    if (isDuplicate) {
      this.emit('duplicate-detected', {
        command,
        cwd,
        duplicateCount: duplicates.length + 1,
        timeSpan: now - duplicates[0].timestamp
      } as DuplicateEvent);
      
      logger.info({
        module: 'duplicate-detector',
        action: 'duplicate-detected',
        command,
        cwd,
        duplicateCount: duplicates.length + 1
      }, `Duplicate results detected for command: ${command}`);
    }
    
    // Add current result to history
    recentHistory.push({
      hash: resultHash,
      timestamp: now,
      stdout: result.stdout,
      stderr: result.stderr
    });
    
    // Keep only recent history to prevent memory growth
    this.commandHistory.set(key, recentHistory.slice(-10));
    
    return isDuplicate;
  }
  
  /**
   * Create hash of command result
   */
  private hashResult(result: {
    stdout: string;
    stderr: string;
    exitCode: number;
  }): string {
    const content = JSON.stringify({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    });
    
    return createHash('sha256').update(content).digest('hex');
  }
  
  /**
   * Clear history for a specific command
   */
  clearHistory(command?: string, cwd?: string): void {
    if (command) {
      const key = `${command}:${cwd || '*'}`;
      if (cwd) {
        this.commandHistory.delete(key);
      } else {
        // Clear all entries for this command
        for (const [k] of this.commandHistory) {
          if (k.startsWith(`${command}:`)) {
            this.commandHistory.delete(k);
          }
        }
      }
    } else {
      // Clear all history
      this.commandHistory.clear();
    }
  }
  
  /**
   * Get statistics
   */
  getStats(): any {
    const stats = {
      totalTrackedCommands: this.commandHistory.size,
      commandsWithHistory: 0,
      totalHistoryEntries: 0
    };
    
    for (const [_, history] of this.commandHistory) {
      if (history.length > 0) {
        stats.commandsWithHistory++;
        stats.totalHistoryEntries += history.length;
      }
    }
    
    return stats;
  }
}

export const duplicateDetector = new DuplicateDetector();
```

#### 2.2 Update `src/tools/command/ai-command-enhancer.ts`

Add duplicate detection integration:

```typescript
import { duplicateDetector } from '../../duplicate-detector.js';
import { saveLearningRule } from '../cache-management-tools.js'; // Export helper

// In constructor, set up duplicate detection listener
constructor(private executor: CommandExecutor) {
  // ... existing code ...
  
  // Listen for duplicate detection
  duplicateDetector.on('duplicate-detected', async (event) => {
    // Auto-mark as never cache
    cacheClassifier.addRule({
      pattern: event.command,
      strategy: CacheStrategy.NEVER,
      reason: `Auto-detected: ${event.duplicateCount} duplicate results within ${event.timeSpan}ms`
    }, 'high');
    
    // Save to persistent storage
    await saveLearningRule({
      pattern: event.command,
      strategy: CacheStrategy.NEVER,
      reason: `Auto-detected duplicate results`,
      timestamp: new Date().toISOString(),
      source: 'auto-detect'
    });
    
    logger.info({
      module: 'ai-command-enhancer',
      action: 'auto-never-cache',
      command: event.command
    }, `Automatically marked command as never-cache: ${event.command}`);
  });
}

// In executeWithAI method, after execution:
async executeWithAI(options: ExecuteOptions): Promise<CommandResult> {
  // ... existing code ...
  
  // After getting result (whether from cache or execution)
  if (!result.cached) {
    // Check for duplicates only on fresh executions
    const isDuplicate = duplicateDetector.checkDuplicate(
      fullCommand,
      cwd,
      result
    );
    
    // If duplicate detected, clear this command from cache
    if (isDuplicate) {
      aiCache.clearCommand(fullCommand, cwd);
    }
  }
  
  return result;
}
```

### Phase 3: Persistent Learning Storage (Week 3)

#### 3.1 Create New File: `src/learning-persistence.ts`

```typescript
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CacheStrategy } from './ai-cache-classifier.js';
import logger from './utils/logger.js';

const LEARNED_RULES_FILE = path.join(os.homedir(), '.mcp-cache-rules.json');
const BACKUP_FILE = path.join(os.homedir(), '.mcp-cache-rules.backup.json');

export interface LearnedRule {
  pattern: string;
  isRegex: boolean;
  strategy: CacheStrategy;
  reason: string;
  timestamp: string;
  source: 'user' | 'auto-detect' | 'analysis';
  hitCount?: number;
  lastHit?: string;
}

export class LearningPersistence {
  private rules: LearnedRule[] = [];
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  
  async initialize(): Promise<void> {
    await this.loadRules();
  }
  
  /**
   * Load rules from disk
   */
  async loadRules(): Promise<void> {
    try {
      const content = await fs.readFile(LEARNED_RULES_FILE, 'utf8');
      this.rules = JSON.parse(content);
      
      logger.info({
        module: 'learning-persistence',
        action: 'load-rules',
        count: this.rules.length
      }, `Loaded ${this.rules.length} learned cache rules`);
      
      // Apply rules to classifier
      for (const rule of this.rules) {
        const pattern = rule.isRegex ? new RegExp(rule.pattern) : rule.pattern;
        const { cacheClassifier } = await import('./ai-cache-classifier.js');
        
        cacheClassifier.addRule({
          pattern,
          strategy: rule.strategy,
          reason: rule.reason
        }, 'high');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error({
          module: 'learning-persistence',
          action: 'load-rules',
          error: error.message
        }, 'Failed to load learned rules');
      }
      // Start with empty rules if file doesn't exist
      this.rules = [];
    }
  }
  
  /**
   * Save a new rule
   */
  async saveRule(rule: Omit<LearnedRule, 'hitCount' | 'lastHit'>): Promise<void> {
    // Check if rule already exists
    const existingIndex = this.rules.findIndex(
      r => r.pattern === rule.pattern && r.isRegex === rule.isRegex
    );
    
    if (existingIndex >= 0) {
      // Update existing rule
      this.rules[existingIndex] = {
        ...rule,
        hitCount: (this.rules[existingIndex].hitCount || 0) + 1,
        lastHit: new Date().toISOString()
      };
    } else {
      // Add new rule
      this.rules.push({
        ...rule,
        hitCount: 0,
        lastHit: new Date().toISOString()
      });
    }
    
    // Limit to 1000 rules
    if (this.rules.length > 1000) {
      // Keep most recently used rules
      this.rules.sort((a, b) => {
        const aTime = new Date(a.lastHit || a.timestamp).getTime();
        const bTime = new Date(b.lastHit || b.timestamp).getTime();
        return bTime - aTime;
      });
      this.rules = this.rules.slice(0, 1000);
    }
    
    await this.debouncedSave();
  }
  
  /**
   * Save rules with debouncing
   */
  private async debouncedSave(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    
    this.saveDebounceTimer = setTimeout(async () => {
      await this.saveRules();
    }, 1000); // Save after 1 second of inactivity
  }
  
  /**
   * Save rules to disk
   */
  private async saveRules(): Promise<void> {
    try {
      // Create backup first
      try {
        await fs.copyFile(LEARNED_RULES_FILE, BACKUP_FILE);
      } catch (error) {
        // Ignore if original doesn't exist
      }
      
      // Write new rules
      await fs.writeFile(
        LEARNED_RULES_FILE,
        JSON.stringify(this.rules, null, 2)
      );
      
      logger.info({
        module: 'learning-persistence',
        action: 'save-rules',
        count: this.rules.length
      }, `Saved ${this.rules.length} learned cache rules`);
    } catch (error) {
      logger.error({
        module: 'learning-persistence',
        action: 'save-rules',
        error: error.message
      }, 'Failed to save learned rules');
    }
  }
  
  /**
   * Get all rules
   */
  getRules(): LearnedRule[] {
    return [...this.rules];
  }
  
  /**
   * Remove a rule
   */
  async removeRule(pattern: string, isRegex: boolean): Promise<boolean> {
    const initialLength = this.rules.length;
    this.rules = this.rules.filter(
      r => !(r.pattern === pattern && r.isRegex === isRegex)
    );
    
    if (this.rules.length < initialLength) {
      await this.debouncedSave();
      return true;
    }
    
    return false;
  }
  
  /**
   * Get statistics
   */
  getStats(): any {
    const bySource = {
      user: 0,
      'auto-detect': 0,
      analysis: 0
    };
    
    const byStrategy = {
      [CacheStrategy.NEVER]: 0,
      [CacheStrategy.SHORT]: 0,
      [CacheStrategy.MEDIUM]: 0,
      [CacheStrategy.LONG]: 0,
      [CacheStrategy.PERMANENT]: 0
    };
    
    for (const rule of this.rules) {
      bySource[rule.source]++;
      byStrategy[rule.strategy]++;
    }
    
    return {
      totalRules: this.rules.length,
      bySource,
      byStrategy,
      mostUsed: this.rules
        .sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0))
        .slice(0, 5)
        .map(r => ({
          pattern: r.pattern,
          hitCount: r.hitCount,
          source: r.source
        }))
    };
  }
}

export const learningPersistence = new LearningPersistence();
```

#### 3.2 Update `src/server.ts` to Initialize Learning

Add initialization in the server startup:

```typescript
import { learningPersistence } from './learning-persistence.js';

// In the main function or server initialization
async function initializeServer() {
  // ... existing code ...
  
  // Initialize learning persistence
  await learningPersistence.initialize();
  
  // ... rest of initialization ...
}
```

### Phase 4: Smart Output Analysis (Week 4)

#### 4.1 Create New File: `src/output-analyzer.ts`

```typescript
import { CacheStrategy } from './ai-cache-classifier.js';
import logger from './utils/logger.js';

interface AnalysisResult {
  hasTimestamp: boolean;
  hasProcessId: boolean;
  hasCounter: boolean;
  hasFileSize: boolean;
  hasIpAddress: boolean;
  hasPort: boolean;
  changeIndicators: string[];
  suggestedStrategy: CacheStrategy;
  confidence: number;
}

export class OutputAnalyzer {
  // Patterns for detecting dynamic content
  private patterns = {
    // Timestamps in various formats
    timestamp: [
      /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/,  // ISO format
      /\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/,      // Unix format
      /\d{1,2}\/\d{1,2}\/\d{4}/,                  // US date
      /\d{2}:\d{2}:\d{2}/,                         // Time only
      /\d+\s*(seconds?|minutes?|hours?|days?)\s+ago/i  // Relative time
    ],
    
    // Process IDs
    processId: [
      /\bpid[:\s]+\d+/i,
      /\bprocess\s+\d+/i,
      /^\s*\d+\s+\w+/,  // ps output format
      /\[\d+\]/         // [12345] format
    ],
    
    // Counters and sequences
    counter: [
      /\b\d+\s*(bytes?|KB|MB|GB|TB)/i,
      /\b\d+\s*(packets?|messages?|items?|files?|processes?)/i,
      /count[:\s]+\d+/i,
      /total[:\s]+\d+/i,
      /\b\d+\s*\/\s*\d+/  // x/y format
    ],
    
    // File sizes
    fileSize: [
      /\b\d+\s*(bytes?|[KMGT]B?)\b/,
      /size[:\s]+\d+/i
    ],
    
    // Network indicators
    ipAddress: [
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
      /[0-9a-f:]+:[0-9a-f:]+/i  // IPv6
    ],
    
    port: [
      /:\d{2,5}\b/,
      /port\s+\d+/i
    ]
  };
  
  /**
   * Analyze command output for dynamic content
   */
  analyze(output: string): AnalysisResult {
    const result: AnalysisResult = {
      hasTimestamp: false,
      hasProcessId: false,
      hasCounter: false,
      hasFileSize: false,
      hasIpAddress: false,
      hasPort: false,
      changeIndicators: [],
      suggestedStrategy: CacheStrategy.MEDIUM,
      confidence: 0.5
    };
    
    // Check each pattern type
    for (const [type, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(output)) {
          result[`has${type.charAt(0).toUpperCase() + type.slice(1)}`] = true;
          result.changeIndicators.push(type);
          break;
        }
      }
    }
    
    // Determine suggested strategy based on indicators
    const indicatorCount = result.changeIndicators.length;
    
    if (indicatorCount === 0) {
      result.suggestedStrategy = CacheStrategy.LONG;
      result.confidence = 0.8;
    } else if (indicatorCount === 1) {
      if (result.hasTimestamp || result.hasProcessId) {
        result.suggestedStrategy = CacheStrategy.NEVER;
        result.confidence = 0.9;
      } else {
        result.suggestedStrategy = CacheStrategy.SHORT;
        result.confidence = 0.7;
      }
    } else if (indicatorCount >= 2) {
      result.suggestedStrategy = CacheStrategy.NEVER;
      result.confidence = 0.95;
    }
    
    // Check for specific high-change patterns
    if (this.hasHighChangePattern(output)) {
      result.suggestedStrategy = CacheStrategy.NEVER;
      result.confidence = 1.0;
      result.changeIndicators.push('high-change-pattern');
    }
    
    return result;
  }
  
  /**
   * Check for patterns that indicate changing data
   */
  private hasHighChangePattern(output: string): boolean {
    const highChangePatterns = [
      /\breal-time\b/i,
      /\blive\b/i,
      /\bcurrent\b/i,
      /\bnow\b/i,
      /\bactive\b/i,
      /\brunning\b/i,
      /\bin progress\b/i,
      /\bupdating\b/i
    ];
    
    return highChangePatterns.some(pattern => pattern.test(output));
  }
  
  /**
   * Compare two outputs for differences
   */
  compareOutputs(output1: string, output2: string): {
    isDifferent: boolean;
    differences: string[];
    similarity: number;
  } {
    if (output1 === output2) {
      return {
        isDifferent: false,
        differences: [],
        similarity: 1.0
      };
    }
    
    // Split into lines for comparison
    const lines1 = output1.split('\n');
    const lines2 = output2.split('\n');
    
    const differences: string[] = [];
    let matchingLines = 0;
    
    // Simple line-by-line comparison
    const maxLines = Math.max(lines1.length, lines2.length);
    for (let i = 0; i < maxLines; i++) {
      if (lines1[i] === lines2[i]) {
        matchingLines++;
      } else {
        differences.push(`Line ${i + 1} differs`);
      }
    }
    
    const similarity = matchingLines / maxLines;
    
    return {
      isDifferent: similarity < 0.95,
      differences,
      similarity
    };
  }
}

export const outputAnalyzer = new OutputAnalyzer();
```

#### 4.2 Update `src/tools/command/ai-command-enhancer.ts` for Analysis

Add output analysis integration:

```typescript
import { outputAnalyzer } from '../../output-analyzer.js';

// Add to executeWithAI method after getting fresh results:
if (!result.cached && result.success) {
  // Analyze output for dynamic content
  const analysis = outputAnalyzer.analyze(result.stdout);
  
  if (analysis.confidence > 0.8 && 
      analysis.suggestedStrategy === CacheStrategy.NEVER) {
    // High confidence that this should not be cached
    logger.info({
      module: 'ai-command-enhancer',
      action: 'output-analysis',
      command: fullCommand,
      analysis
    }, `Output analysis suggests never-cache for: ${fullCommand}`);
    
    // Add rule but don't save automatically - let duplicate detection confirm
    cacheClassifier.addRule({
      pattern: fullCommand,
      strategy: CacheStrategy.NEVER,
      reason: `Output analysis detected: ${analysis.changeIndicators.join(', ')}`
    }, 'low'); // Low priority - can be overridden
  }
}
```

## Testing Plan

### Unit Tests

Create test files for each new module:

1. `test/duplicate-detector.test.js`
2. `test/output-analyzer.test.js`
3. `test/learning-persistence.test.js`
4. `test/cache-management-tools.test.js`

### Integration Tests

1. Test cache management tools end-to-end
2. Test duplicate detection with real commands
3. Test persistence across restarts
4. Test output analysis accuracy

### Manual Testing Checklist

1. **Phase 1 - Cache Management Tools**
   - [ ] Test cache_clear_command with specific command
   - [ ] Test cache_clear_pattern with regex
   - [ ] Test cache_mark_never adds rule
   - [ ] Test cache_stats shows correct data
   - [ ] Test cache_explain provides clear output

2. **Phase 2 - Duplicate Detection**
   - [ ] Run `ls -la` twice quickly - should auto-mark as never cache
   - [ ] Run `pwd` twice - should not trigger (different expected behavior)
   - [ ] Verify rules are saved to persistence file

3. **Phase 3 - Persistence**
   - [ ] Add rules, restart server, verify they're loaded
   - [ ] Test backup file creation
   - [ ] Test 1000 rule limit

4. **Phase 4 - Output Analysis**
   - [ ] Test commands with timestamps get short/no cache
   - [ ] Test static output gets long cache
   - [ ] Test high-confidence detections

## Migration and Rollout

### Backward Compatibility

- All existing hardcoded rules remain active
- New rules layer on top with high priority
- Can disable entire system with MCP_DISABLE_CACHE=true
- Learned rules file can be deleted to reset

### Rollout Steps

1. **Week 1**: Deploy Phase 1 (cache management tools)
   - No automatic behavior changes
   - Claude can manually manage cache

2. **Week 2**: Deploy Phase 2 (duplicate detection)
   - Automatic learning begins
   - Monitor logs for false positives

3. **Week 3**: Deploy Phase 3 (persistence)
   - Rules survive restarts
   - Can build up knowledge base

4. **Week 4**: Deploy Phase 4 (output analysis)
   - Proactive detection of dynamic commands
   - System active

### Monitoring

Log all automatic decisions at INFO level:
- When commands are auto-marked as never-cache
- When rules are loaded/saved
- Cache hit/miss rates by strategy
- Duplicate detection triggers

## Performance Considerations

1. **Memory Usage**
   - Duplicate detector keeps max 10 entries per command
   - Learning persistence limited to 1000 rules
   - Key-to-command mapping in cache grows with cache size

2. **CPU Usage**
   - Output analysis runs regex on command output
   - Duplicate detection hashes results
   - All operations are O(1) or O(n) where n is small

3. **Disk I/O**
   - Rules file written with 1-second debounce
   - Backup created before each write
   - File size limited to ~50KB (1000 rules)

## Security Considerations

1. **File Permissions**
   - Set 600 permissions on ~/.mcp-cache-rules.json
   - Contains command patterns only, no sensitive data

2. **Command Injection**
   - Regex patterns validated before use
   - No command execution based on learned rules

3. **Resource Limits**
   - All collections have size limits
   - Timeouts on all operations

## Future Enhancements

1. **Pattern Generalization**
   - Detect similar commands and create regex rules
   - Example: `ls -la /path1` and `ls -la /path2` → `ls -la .*`

2. **Time-based Learning**
   - Track when commands are run
   - Adjust cache TTL based on access patterns

3. **Command Clustering**
   - Group related commands
   - Apply learned behavior to similar commands

4. **Export/Import Rules**
   - Share learned rules between environments
   - Create rule presets for common workflows

## Conclusion

This implementation provides a dynamic cache management system that:
- Gives Claude runtime control over caching
- Automatically learns from usage patterns
- Persists knowledge across sessions
- Maintains backward compatibility
- Requires no code changes for new patterns

The phased approach allows rollout with monitoring at each stage.
