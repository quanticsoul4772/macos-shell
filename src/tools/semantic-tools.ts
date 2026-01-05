// Semantic Search Tools
// MCP tools for semantic command history search and error matching

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getCommandIndexingService } from '../services/command-indexing-service.js';
import { getErrorKnowledgeBase } from '../services/error-knowledge-base.js';
import { getCommandRecommendationService } from '../services/command-recommendation-service.js';
import { getDocumentationRAGService } from '../services/documentation-rag-service.js';
import { getOutputAnalysisService } from '../services/output-analysis-service.js';
import { SessionManager } from '../session-manager.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('semantic-tools');

/**
 * Register semantic search tools
 */
export function registerSemanticTools(
  server: McpServer,
  sessionManager: SessionManager
) {
  /**
   * Semantic Command History Search
   * Search command history by INTENT, not exact text matching
   */
  server.tool(
    'semantic_command_search',
    {
      query: z.string().describe('Natural language description of what you want to find (e.g., "deploy to production", "fix database issues")'),
      limit: z.number().optional().describe('Maximum number of results to return (default: 10)'),
      min_similarity: z.number().min(0).max(1).optional().describe('Minimum similarity score 0-1 (default: 0.3)'),
      session: z.string().optional().describe('Filter results to specific session ID or name'),
    },
    async (params) => {
      const { query, limit, min_similarity, session: sessionFilter } = params as {
        query: string;
        limit?: number;
        min_similarity?: number;
        session?: string;
      };

      try {
        const commandIndexing = getCommandIndexingService();

        // Resolve session ID if session name provided
        let sessionId: string | undefined;
        if (sessionFilter) {
          const session = await sessionManager.getSession(sessionFilter);
          if (!session) {
            return {
              error: true,
              message: `Session not found: ${sessionFilter}`,
              results: [],
            };
          }
          sessionId = session.id;
        }

        // Perform semantic search
        const results = await commandIndexing.searchCommands(query, {
          limit,
          minSimilarity: min_similarity,
          sessionId,
        });

        logger.info('Semantic command search completed', {
          query: query.substring(0, 50),
          resultsFound: results.length,
          sessionFilter,
        });

        // Format results for display
        const formattedResults = results.map((cmd, index) => ({
          rank: index + 1,
          command: cmd.command,
          session_id: cmd.metadata.sessionId,
          working_directory: cmd.metadata.cwd,
          exit_code: cmd.metadata.exitCode,
          duration_ms: cmd.metadata.duration,
          timestamp: cmd.metadata.timestamp ? new Date(cmd.metadata.timestamp).toISOString() : undefined,
          success: cmd.metadata.exitCode === 0,
          stdout_preview: cmd.metadata.stdout?.substring(0, 100),
          stderr_preview: cmd.metadata.stderr?.substring(0, 100),
        }));

        const response = {
          query,
          results_found: results.length,
          min_similarity: min_similarity || 0.3,
          results: formattedResults,
          explanation: `Found ${results.length} commands semantically similar to: "${query}"`,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response)
            }
          ],
          isError: false
        };
      } catch (error: any) {
        logger.error('FATAL: Semantic command search failed', {
          query: query.substring(0, 50),
          error: error.message,
        });
        const errorResponse = {
          error: true,
          message: `FATAL: Semantic command search failed: ${error.message}`,
          query,
          results: [],
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorResponse)
            }
          ],
          isError: true
        };
      }
    }
  );

  /**
   * Get semantic search statistics
   */
  server.tool(
    'semantic_search_stats',
    {},
    async () => {
      try {
        const commandIndexing = getCommandIndexingService();
        const stats = commandIndexing.getStats();

        const response = {
          ...stats,
          status: 'operational',
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response)
            }
          ],
          isError: false
        };
      } catch (error: any) {
        logger.error('FATAL: Failed to get semantic search stats', {
          error: error.message,
        });
        const errorResponse = {
          error: true,
          message: `FATAL: Failed to get stats: ${error.message}`,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorResponse)
            }
          ],
          isError: true
        };
      }
    }
  );

  /**
   * Error Solution Lookup
   * Find solutions for error messages from knowledge base
   */
  server.tool(
    'error_solution_lookup',
    {
      error_message: z.string().describe('The error message or error text to find solutions for'),
      limit: z.number().optional().describe('Maximum number of similar errors to return (default: 3)'),
      min_similarity: z.number().min(0).max(1).optional().describe('Minimum similarity score 0-1 (default: 0.6)'),
    },
    async (params) => {
      const { error_message, limit, min_similarity } = params as {
        error_message: string;
        limit?: number;
        min_similarity?: number;
      };

      try {
        const errorKB = getErrorKnowledgeBase();

        // Check if knowledge base is initialized
        const stats = errorKB.getStats();
        if (!stats.initialized) {
          return {
            error: true,
            message: 'FATAL: Error knowledge base not initialized',
            results: [],
          };
        }

        // Search for similar errors
        const similarErrors = await errorKB.findSimilarErrors(error_message, {
          limit: limit || 3,
          minSimilarity: min_similarity || 0.6,
        });

        logger.info('Error solution lookup completed', {
          error: error_message.substring(0, 50),
          matchesFound: similarErrors.length,
        });

        // Format results for display
        const formattedResults = similarErrors.map((err, index) => ({
          rank: index + 1,
          error: err.error,
          category: err.category,
          solution: err.solution,
          severity: err.severity,
          examples: err.examples,
        }));

        const response = {
          query: error_message,
          matches_found: similarErrors.length,
          min_similarity: min_similarity || 0.6,
          results: formattedResults,
          explanation: similarErrors.length > 0
            ? `Found ${similarErrors.length} similar error(s) with known solutions`
            : `No similar errors found in knowledge base (${stats.errorCount} errors indexed)`,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response)
            }
          ],
          isError: false
        };
      } catch (error: any) {
        logger.error('FATAL: Error solution lookup failed', {
          error: error.message,
        });
        const errorResponse = {
          error: true,
          message: `FATAL: Error solution lookup failed: ${error.message}`,
          query: error_message,
          results: [],
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorResponse)
            }
          ],
          isError: true
        };
      }
    }
  );

  /**
   * Command Recommendations
   * Suggest commands based on user intent and historical patterns
   */
  server.tool(
    'recommend_commands',
    {
      intent: z.string().describe('What you want to accomplish (e.g., "deploy to production", "fix database connection", "install dependencies")'),
      max_recommendations: z.number().optional().describe('Maximum recommendations to return (default: 5)'),
      min_confidence: z.number().min(0).max(1).optional().describe('Minimum confidence threshold 0-1 (default: 0.4)'),
      session: z.string().optional().describe('Optional session ID or name for context'),
    },
    async (params) => {
      const { intent, max_recommendations, min_confidence, session: sessionFilter } = params as {
        intent: string;
        max_recommendations?: number;
        min_confidence?: number;
        session?: string;
      };

      try {
        const commandRec = getCommandRecommendationService();

        // Resolve session for context
        let sessionId: string | undefined;
        let cwd = process.cwd();
        if (sessionFilter) {
          const session = await sessionManager.getSession(sessionFilter);
          if (session) {
            sessionId = session.id;
            cwd = session.cwd;
          }
        } else {
          // Use default session (getSession with no args returns default)
          const defaultSession = await sessionManager.getSession();
          if (defaultSession) {
            sessionId = defaultSession.id;
            cwd = defaultSession.cwd;
          }
        }

        // Generate recommendations
        const recommendations = await commandRec.recommendCommands(
          intent,
          { cwd, session_type: 'general' },
          {
            maxRecommendations: max_recommendations,
            minConfidence: min_confidence,
          }
        );

        logger.info('Command recommendations completed', {
          intent: intent.substring(0, 50),
          recommendationsFound: recommendations.length,
        });

        const response = {
          intent,
          recommendations_found: recommendations.length,
          min_confidence: min_confidence || 0.4,
          recommendations: recommendations.map(rec => ({
            rank: rec.rank,
            command: rec.command,
            confidence: Math.round(rec.confidence * 100) / 100,
            reasoning: rec.reasoning,
            success_rate: Math.round(rec.success_rate * 100),
            usage_count: rec.usage_count,
            estimated_duration_ms: rec.estimated_duration_ms,
          })),
          explanation: recommendations.length > 0
            ? `Found ${recommendations.length} recommended command(s) for: "${intent}"`
            : `No confident recommendations found for: "${intent}". Try running similar commands to build history.`,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response)
            }
          ],
          isError: false
        };
      } catch (error: any) {
        logger.error('FATAL: Command recommendations failed', {
          intent: intent.substring(0, 50),
          error: error.message,
        });
        const errorResponse = {
          error: true,
          message: `FATAL: Command recommendations failed: ${error.message}`,
          intent,
          recommendations: [],
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorResponse)
            }
          ],
          isError: true
        };
      }
    }
  );

  /**
   * Documentation Search
   * Search command documentation using semantic similarity
   */
  server.tool(
    'search_documentation',
    {
      query: z.string().describe('What you want to learn about (e.g., "how to list files", "git merge conflicts", "docker volumes")'),
      limit: z.number().optional().describe('Maximum results to return (default: 5)'),
      command_filter: z.string().optional().describe('Filter to specific command (e.g., "git", "docker")'),
    },
    async (params) => {
      const { query, limit, command_filter } = params as {
        query: string;
        limit?: number;
        command_filter?: string;
      };

      try {
        const docRAG = getDocumentationRAGService();

        // Check if initialized
        const stats = docRAG.getStats();
        if (!stats.initialized) {
          return {
            error: true,
            message: 'FATAL: Documentation service not initialized',
            results: [],
          };
        }

        // Search documentation
        const results = await docRAG.searchDocumentation(query, {
          limit,
          commandFilter: command_filter,
        });

        logger.info('Documentation search completed', {
          query: query.substring(0, 50),
          resultsFound: results.length,
        });

        // Format results
        const formattedResults = results.map(result => ({
          command: result.command,
          category: result.category,
          relevance: Math.round(result.relevance_score * 100),
          description: result.full_doc.description,
          usage: result.full_doc.usage,
          common_options: result.full_doc.common_options.slice(0, 5),
          examples: result.full_doc.examples.slice(0, 3),
          related_commands: result.full_doc.related_commands,
        }));

        const response = {
          query,
          results_found: results.length,
          total_commands_indexed: stats.commandCount,
          results: formattedResults,
          explanation: results.length > 0
            ? `Found ${results.length} relevant command(s) for: "${query}"`
            : `No documentation found for: "${query}". Try different search terms.`,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response)
            }
          ],
          isError: false
        };
      } catch (error: any) {
        logger.error('FATAL: Documentation search failed', {
          query: query.substring(0, 50),
          error: error.message,
        });
        const errorResponse = {
          error: true,
          message: `FATAL: Documentation search failed: ${error.message}`,
          query,
          results: [],
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorResponse)
            }
          ],
          isError: true
        };
      }
    }
  );

  /**
   * Analyze Command Output
   * Extract patterns, insights, and suggestions from command output
   */
  server.tool(
    'analyze_output',
    {
      command: z.string().describe('The command that was executed'),
      stdout: z.string().describe('Standard output from the command'),
      stderr: z.string().optional().describe('Standard error from the command (if any)'),
      exit_code: z.number().describe('Exit code from the command'),
      duration_ms: z.number().optional().describe('Duration in milliseconds'),
      cwd: z.string().optional().describe('Working directory where command was run'),
    },
    async (params) => {
      const { command, stdout, stderr, exit_code, duration_ms, cwd } = params as {
        command: string;
        stdout: string;
        stderr?: string;
        exit_code: number;
        duration_ms?: number;
        cwd?: string;
      };

      try {
        const outputAnalysis = getOutputAnalysisService();

        // Analyze output
        const analysis = await outputAnalysis.analyzeOutput(
          {
            command,
            stdout,
            stderr: stderr || '',
            exit_code,
            duration_ms: duration_ms || 0,
          },
          {
            cwd: cwd || process.cwd(),
          }
        );

        logger.info('Output analysis completed', {
          command: command.substring(0, 50),
          outputType: analysis.output_type,
          patternsFound: Object.values(analysis.extracted_patterns).reduce(
            (sum, arr) => sum + arr.length,
            0
          ),
        });

        const response = {
          command,
          output_type: analysis.output_type,
          summary: analysis.summary,
          confidence: Math.round(analysis.confidence * 100),
          key_messages: analysis.key_messages,
          extracted_patterns: {
            urls: analysis.extracted_patterns.urls.slice(0, 5),
            file_paths: analysis.extracted_patterns.file_paths.slice(0, 5),
            error_codes: analysis.extracted_patterns.error_codes,
            warnings: analysis.extracted_patterns.warnings.slice(0, 3),
            process_ids: analysis.extracted_patterns.process_ids,
            ports: analysis.extracted_patterns.ports,
          },
          actionable_items: analysis.actionable_items,
          follow_up_suggestions: analysis.follow_up_suggestions,
          explanation: `Analyzed ${analysis.output_type} output from "${command}"`,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(response)
            }
          ],
          isError: false
        };
      } catch (error: any) {
        logger.error('FATAL: Output analysis failed', {
          command: command.substring(0, 50),
          error: error.message,
        });
        const errorResponse = {
          error: true,
          message: `FATAL: Output analysis failed: ${error.message}`,
          command,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(errorResponse)
            }
          ],
          isError: true
        };
      }
    }
  );

  logger.info('Semantic search tools registered', {
    tools: [
      'semantic_command_search',
      'semantic_search_stats',
      'error_solution_lookup',
      'recommend_commands',
      'search_documentation',
      'analyze_output',
    ],
  });
}
