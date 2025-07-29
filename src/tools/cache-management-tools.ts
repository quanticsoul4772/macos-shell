import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { aiCache } from '../ai-cache.js';
import { cacheClassifier, CacheStrategy } from '../ai-cache-classifier.js';
import { learningPersistence, type LearnedRule } from '../learning-persistence.js';
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
              error: `Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`
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
        await learningPersistence.saveRule({
          pattern: pattern.toString(),
          isRegex: isPattern,
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
              error: error instanceof Error ? error.message : String(error)
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
      const learnedRules = learningPersistence.getRules();
      const persistenceStats = learningPersistence.getStats();
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ...stats,
            learnedRulesCount: learnedRules.length,
            persistenceStats,
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

// Export for backward compatibility with ai-command-enhancer.ts
export async function saveLearningRule(rule: Omit<LearnedRule, 'hitCount' | 'lastHit' | 'isRegex'> & { isRegex?: boolean }): Promise<void> {
  await learningPersistence.saveRule({
    ...rule,
    isRegex: rule.isRegex || false
  });
}

export type { LearnedRule } from '../learning-persistence.js';
