// Command Recommendation Service
// Provides intelligent command suggestions based on user intent and historical patterns

import { getSemanticSearch } from './semantic-search.js';
import { getCommandIndexingService } from './command-indexing-service.js';
import { getLogger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger('CommandRecommendationService');

export interface RecommendationContext {
  cwd: string;
  recent_commands?: string[];
  session_type?: string;
  user_id?: string;
}

export interface CommandRecommendation {
  rank: number;
  command: string;
  confidence: number;
  reasoning: string;
  success_rate: number;
  usage_count: number;
  similar_contexts: string[];
  estimated_duration_ms?: number;
}

export interface ExecutionContext {
  command: string;
  cwd: string;
  exit_code: number;
  duration_ms: number;
  session_type?: string;
}

export interface RecommendationPattern {
  id: string;
  intent_embedding: number[];
  commands: string[];
  success_rates: number[];
  context_patterns: string[];
  usage_count: number;
  last_used: Date;
}

/**
 * Command Recommendation Service
 * Suggests appropriate commands based on user intent and historical patterns
 * FAIL-FAST: All operations throw on error
 */
export class CommandRecommendationService {
  private semanticSearch = getSemanticSearch();
  private commandIndexing = getCommandIndexingService();
  private initialized = false;

  constructor() {
    // Service is ready when semantic search and command indexing are ready
    this.initialized = true;
    logger.info('Command recommendation service initialized');
  }

  /**
   * Recommend commands based on user intent
   * FAIL-FAST: Throws if search fails
   */
  public async recommendCommands(
    intent: string,
    context: RecommendationContext,
    options?: {
      maxRecommendations?: number;
      minConfidence?: number;
      includeExamples?: boolean;
    }
  ): Promise<CommandRecommendation[]> {
    if (!this.initialized) {
      throw new Error('FATAL: Command recommendation service not initialized');
    }

    try {
      const maxRecs = options?.maxRecommendations || 5;
      const minConf = options?.minConfidence || 0.4;

      logger.debug('Generating command recommendations', {
        intent: intent.substring(0, 50),
        cwd: context.cwd,
        maxRecommendations: maxRecs,
      });

      // Build search query with context
      const searchQuery = this.buildSearchQuery(intent, context);

      // Search for similar successful commands
      const similarCommands = await this.commandIndexing.searchCommands(searchQuery, {
        limit: maxRecs * 3, // Get more candidates for filtering
        minSimilarity: 0.3, // Lower threshold to get more options
      });

      // Score and rank recommendations
      const recommendations = this.scoreRecommendations(
        similarCommands,
        intent,
        context
      );

      // Filter by confidence and limit
      const filteredRecs = recommendations
        .filter(rec => rec.confidence >= minConf)
        .slice(0, maxRecs);

      logger.info('Command recommendations generated', {
        intent: intent.substring(0, 50),
        recommendationsFound: filteredRecs.length,
        topCommand: filteredRecs[0]?.command,
      });

      return filteredRecs;
    } catch (error: any) {
      logger.error('FATAL: Failed to generate command recommendations', {
        intent: intent.substring(0, 50),
        error: error.message,
      });
      throw new Error(`FATAL: Command recommendation failed: ${error.message}`);
    }
  }

  /**
   * Learn from command execution
   * Updates patterns based on success/failure
   */
  public async learnFromExecution(
    context: ExecutionContext
  ): Promise<void> {
    try {
      const success = context.exit_code === 0;

      logger.debug('Learning from command execution', {
        command: context.command.substring(0, 50),
        success,
        exitCode: context.exit_code,
        duration: context.duration_ms,
      });

      // Command is already indexed by command-indexing-service
      // This method can track additional metadata like success patterns
      // For now, just log for future enhancement

      logger.debug('Command execution learned', {
        command: context.command.substring(0, 50),
        success,
      });
    } catch (error: any) {
      logger.error('Failed to learn from execution (non-fatal)', {
        command: context.command.substring(0, 50),
        error: error.message,
      });
      // Non-fatal: don't throw, just log
    }
  }

  /**
   * Get recommendation service statistics
   */
  public getStats() {
    return {
      initialized: this.initialized,
      commandIndexingStats: this.commandIndexing.getStats(),
    };
  }

  /**
   * Build search query combining intent and context
   */
  private buildSearchQuery(intent: string, context: RecommendationContext): string {
    const parts = [intent];

    // Add context hints
    if (context.cwd && context.cwd !== process.env.HOME) {
      const cwdHint = context.cwd.split('/').pop();
      if (cwdHint) {
        parts.push(`in ${cwdHint}`);
      }
    }

    if (context.session_type) {
      parts.push(`${context.session_type} workflow`);
    }

    return parts.join(' ');
  }

  /**
   * Score recommendations based on multiple factors
   */
  private scoreRecommendations(
    similarCommands: any[],
    intent: string,
    context: RecommendationContext
  ): CommandRecommendation[] {
    const recommendations: CommandRecommendation[] = [];
    const commandGroups = new Map<string, any[]>();

    // Group similar commands
    for (const cmd of similarCommands) {
      const baseCommand = cmd.command.split(' ')[0];
      if (!commandGroups.has(baseCommand)) {
        commandGroups.set(baseCommand, []);
      }
      commandGroups.get(baseCommand)!.push(cmd);
    }

    // Score each command group
    let rank = 1;
    for (const [baseCommand, cmds] of commandGroups.entries()) {
      const successfulCmds = cmds.filter(c => c.metadata.exitCode === 0);
      const successRate = successfulCmds.length / cmds.length;
      const usageCount = cmds.length;

      // Calculate confidence based on success rate and usage
      const usageFactor = Math.min(usageCount / 10, 1); // Cap at 10 uses
      const confidence = successRate * 0.7 + usageFactor * 0.3;

      // Get the most recent successful command
      const bestCmd = successfulCmds.length > 0
        ? successfulCmds[successfulCmds.length - 1]
        : cmds[cmds.length - 1];

      // Extract similar contexts
      const similarContexts = cmds
        .map(c => c.metadata.cwd)
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 3);

      // Build reasoning
      const reasoning = this.buildReasoning(
        bestCmd.command,
        successRate,
        usageCount,
        similarContexts
      );

      recommendations.push({
        rank: rank++,
        command: bestCmd.command,
        confidence,
        reasoning,
        success_rate: successRate,
        usage_count: usageCount,
        similar_contexts: similarContexts,
        estimated_duration_ms: bestCmd.metadata.duration,
      });
    }

    // Sort by confidence
    recommendations.sort((a, b) => b.confidence - a.confidence);

    // Update ranks
    recommendations.forEach((rec, idx) => {
      rec.rank = idx + 1;
    });

    return recommendations;
  }

  /**
   * Build human-readable reasoning for recommendation
   */
  private buildReasoning(
    command: string,
    successRate: number,
    usageCount: number,
    similarContexts: string[]
  ): string {
    const parts: string[] = [];

    // Success rate reasoning
    if (successRate >= 0.9) {
      parts.push(`Highly successful (${Math.round(successRate * 100)}% success rate)`);
    } else if (successRate >= 0.7) {
      parts.push(`Usually successful (${Math.round(successRate * 100)}% success rate)`);
    } else {
      parts.push(`Sometimes successful (${Math.round(successRate * 100)}% success rate)`);
    }

    // Usage reasoning
    if (usageCount >= 10) {
      parts.push(`frequently used (${usageCount} times)`);
    } else if (usageCount >= 3) {
      parts.push(`used ${usageCount} times`);
    } else {
      parts.push(`used occasionally`);
    }

    // Context reasoning
    if (similarContexts.length > 0) {
      const contexts = similarContexts.map(c => c.split('/').pop()).join(', ');
      parts.push(`in similar contexts: ${contexts}`);
    }

    return parts.join(', ');
  }
}

// Singleton instance
let commandRecommendationServiceInstance: CommandRecommendationService | null = null;

/**
 * Get the singleton command recommendation service instance
 */
export function getCommandRecommendationService(): CommandRecommendationService {
  if (!commandRecommendationServiceInstance) {
    commandRecommendationServiceInstance = new CommandRecommendationService();
  }
  return commandRecommendationServiceInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetCommandRecommendationService(): void {
  commandRecommendationServiceInstance = null;
}
