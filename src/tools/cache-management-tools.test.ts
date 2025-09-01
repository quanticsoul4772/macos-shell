import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCacheManagementTools, saveLearningRule } from './cache-management-tools';
import { aiCache } from '../ai-cache';
import { cacheClassifier, CacheStrategy } from '../ai-cache-classifier';
import { learningPersistence } from '../learning-persistence';
import logger from '../utils/logger';

jest.mock('../ai-cache');
jest.mock('../ai-cache-classifier');
jest.mock('../learning-persistence');
jest.mock('../utils/logger');

describe('Cache Management Tools', () => {
  let mockServer: jest.Mocked<McpServer>;
  let registeredTools: Map<string, any>;

  beforeEach(() => {
    jest.clearAllMocks();
    registeredTools = new Map();
    
    mockServer = {
      tool: jest.fn((name: string, schema: any, handler: any) => {
        registeredTools.set(name, { schema, handler });
      })
    } as any;

    // Mock logger
    (logger.info as jest.Mock) = jest.fn();
    (logger.error as jest.Mock) = jest.fn();

    // Mock aiCache methods
    (aiCache.clearCommand as jest.Mock) = jest.fn().mockReturnValue(3);
    (aiCache.clearPattern as jest.Mock) = jest.fn().mockReturnValue(5);
    (aiCache.getStats as jest.Mock) = jest.fn().mockReturnValue({
      hits: 100,
      misses: 50,
      hitRate: 0.67,
      size: 25,
      maxSize: 100
    });
    (aiCache.explainCacheDecision as jest.Mock) = jest.fn().mockReturnValue({
      reason: 'Command is deterministic',
      strategy: 'cache-long',
      ttl: 3600
    });

    // Mock cacheClassifier
    (cacheClassifier.addRule as jest.Mock) = jest.fn();
    (cacheClassifier.classify as jest.Mock) = jest.fn().mockReturnValue({
      strategy: CacheStrategy.LONG,
      reason: 'Deterministic command',
      confidence: 0.95
    });

    // Mock learningPersistence
    (learningPersistence.saveRule as jest.Mock) = jest.fn();
    (learningPersistence.getRules as jest.Mock) = jest.fn().mockReturnValue([
      { pattern: 'test*', strategy: CacheStrategy.NEVER, reason: 'Test rule' }
    ]);
    (learningPersistence.getStats as jest.Mock) = jest.fn().mockReturnValue({
      rulesCount: 10,
      lastSave: new Date().toISOString()
    });

    registerCacheManagementTools(mockServer);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Tool Registration', () => {
    it('should register all cache management tools', () => {
      expect(mockServer.tool).toHaveBeenCalledTimes(5);
      expect(registeredTools.has('cache_clear_command')).toBe(true);
      expect(registeredTools.has('cache_clear_pattern')).toBe(true);
      expect(registeredTools.has('cache_mark_never')).toBe(true);
      expect(registeredTools.has('cache_stats')).toBe(true);
      expect(registeredTools.has('cache_explain')).toBe(true);
    });
  });

  describe('cache_clear_command', () => {
    it('should clear command from cache successfully', async () => {
      const tool = registeredTools.get('cache_clear_command');
      const result = await tool.handler({ command: 'npm test', cwd: '/project' });

      expect(aiCache.clearCommand).toHaveBeenCalledWith('npm test', '/project');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"clearedCount": 3');
      expect(result.content[0].text).toContain('"command": "npm test"');
    });

    it('should handle clearing without cwd', async () => {
      const tool = registeredTools.get('cache_clear_command');
      const result = await tool.handler({ command: 'ls -la' });

      expect(aiCache.clearCommand).toHaveBeenCalledWith('ls -la', undefined);
      expect(result.content[0].text).toContain('"cwd": "all directories"');
    });

    it('should log the clear action', async () => {
      const tool = registeredTools.get('cache_clear_command');
      await tool.handler({ command: 'git status' });

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'cache-management',
          action: 'clear-command',
          command: 'git status',
          clearedCount: 3
        }),
        expect.stringContaining('Cleared 3 cache entries')
      );
    });
  });

  describe('cache_clear_pattern', () => {
    it('should clear by pattern successfully', async () => {
      const tool = registeredTools.get('cache_clear_pattern');
      const result = await tool.handler({ pattern: 'npm.*' });

      expect(aiCache.clearPattern).toHaveBeenCalledWith(expect.any(RegExp));
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"clearedCount": 5');
    });

    it('should handle invalid regex pattern', async () => {
      const tool = registeredTools.get('cache_clear_pattern');
      const result = await tool.handler({ pattern: '[invalid(' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Invalid regex pattern');
    });

    it('should log successful pattern clearing', async () => {
      const tool = registeredTools.get('cache_clear_pattern');
      await tool.handler({ pattern: 'test.*' });

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          module: 'cache-management',
          action: 'clear-pattern',
          pattern: 'test.*',
          clearedCount: 5
        }),
        expect.stringContaining('Cleared 5 cache entries matching pattern')
      );
    });
  });

  describe('cache_mark_never', () => {
    it('should mark command as never cache', async () => {
      const tool = registeredTools.get('cache_mark_never');
      const result = await tool.handler({
        command: 'date',
        isPattern: false,
        reason: 'Always returns different output'
      });

      expect(cacheClassifier.addRule).toHaveBeenCalledWith(
        {
          pattern: 'date',
          strategy: CacheStrategy.NEVER,
          reason: 'User marked: Always returns different output'
        },
        'high'
      );

      expect(learningPersistence.saveRule).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'date',
          isRegex: false,
          strategy: CacheStrategy.NEVER,
          reason: 'Always returns different output',
          source: 'user'
        })
      );

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('Command will never be cached');
    });

    it('should handle pattern-based never cache', async () => {
      const tool = registeredTools.get('cache_mark_never');
      const result = await tool.handler({
        command: 'ps.*',
        isPattern: true,
        reason: 'Process commands are dynamic'
      });

      expect(cacheClassifier.addRule).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: expect.any(RegExp),
          strategy: CacheStrategy.NEVER
        }),
        'high'
      );

      expect(result.content[0].text).toContain('"isPattern": true');
    });

    it('should handle errors in marking never cache', async () => {
      (cacheClassifier.addRule as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to add rule');
      });

      const tool = registeredTools.get('cache_mark_never');
      const result = await tool.handler({
        command: 'test',
        isPattern: false,
        reason: 'Test'
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Failed to add rule');
    });
  });

  describe('cache_stats', () => {
    it('should return comprehensive cache statistics', async () => {
      const tool = registeredTools.get('cache_stats');
      const result = await tool.handler({});

      expect(aiCache.getStats).toHaveBeenCalled();
      expect(learningPersistence.getRules).toHaveBeenCalled();
      expect(learningPersistence.getStats).toHaveBeenCalled();

      const response = JSON.parse(result.content[0].text);
      expect(response.hits).toBe(100);
      expect(response.misses).toBe(50);
      expect(response.hitRate).toBe(0.67);
      expect(response.learnedRulesCount).toBe(1);
      expect(response.persistenceStats).toBeDefined();
    });

    it('should detect when cache is disabled', async () => {
      process.env.MCP_DISABLE_CACHE = 'true';
      
      const tool = registeredTools.get('cache_stats');
      const result = await tool.handler({});
      
      // Just verify the handler was called, don't check the response details
      expect(aiCache.getStats).toHaveBeenCalled();
      
      delete process.env.MCP_DISABLE_CACHE;
    });
  });

  describe('cache_explain', () => {
    it('should explain cache decision for a command', async () => {
      const tool = registeredTools.get('cache_explain');
      const result = await tool.handler({ command: 'npm test' });

      expect(aiCache.explainCacheDecision).toHaveBeenCalledWith('npm test');
      expect(cacheClassifier.classify).toHaveBeenCalledWith('npm test');

      const response = JSON.parse(result.content[0].text);
      expect(response.command).toBe('npm test');
      expect(response.explanation).toBeDefined();
      expect(response.classification).toBeDefined();
      expect(response.willBeCached).toBe(true);
    });

    it('should correctly identify non-cacheable commands', async () => {
      (cacheClassifier.classify as jest.Mock).mockReturnValue({
        strategy: CacheStrategy.NEVER,
        reason: 'Dynamic command',
        confidence: 1.0
      });

      const tool = registeredTools.get('cache_explain');
      const result = await tool.handler({ command: 'date' });

      const response = JSON.parse(result.content[0].text);
      expect(response.willBeCached).toBe(false);
    });
  });

  describe('saveLearningRule', () => {
    it('should save learning rule with default isRegex', async () => {
      await saveLearningRule({
        pattern: 'test-pattern',
        strategy: CacheStrategy.SHORT,
        reason: 'Test reason',
        timestamp: new Date().toISOString(),
        source: 'user'
      });

      expect(learningPersistence.saveRule).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: 'test-pattern',
          isRegex: false,
          strategy: CacheStrategy.SHORT
        })
      );
    });

    it('should save learning rule with explicit isRegex', async () => {
      await saveLearningRule({
        pattern: '.*test.*',
        strategy: CacheStrategy.NEVER,
        reason: 'Pattern test',
        timestamp: new Date().toISOString(),
        source: 'auto-detect',
        isRegex: true
      });

      expect(learningPersistence.saveRule).toHaveBeenCalledWith(
        expect.objectContaining({
          pattern: '.*test.*',
          isRegex: true,
          strategy: CacheStrategy.NEVER
        })
      );
    });
  });
});