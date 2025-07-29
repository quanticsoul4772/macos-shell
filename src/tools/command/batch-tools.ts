// Batch Tools Module
// Batch command execution functionality

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BatchExecutor } from '../../utils/batch-executor.js';
import { EnhancedBatchExecutor } from '../../utils/enhanced-batch-executor.js';
import { SessionManager } from '../../session-manager.js';

export function registerBatchTools(
  server: McpServer,
  sessionManager: SessionManager,
  batchExecutor: BatchExecutor
) {
  // Initialize enhanced batch executor
  const enhancedBatchExecutor = new EnhancedBatchExecutor(
    async (sessionId) => {
      const session = await sessionManager.getSession(sessionId);
      return session?.cwd || process.cwd();
    },
    async (sessionId) => {
      const session = await sessionManager.getSession(sessionId);
      return session?.env || process.env as Record<string, string>;
    }
  );

  // Batch execute tool - delegate to BatchExecutor
  server.tool(
    "batch_execute",
    {
      commands: z.array(z.object({
        command: z.string(),
        args: z.array(z.string()).default([]),
        cwd: z.string().optional(),
        env: z.record(z.string()).optional(),
        continueOnError: z.boolean().default(false)
      })),
      parallel: z.boolean().default(false),
      maxParallel: z.number().default(5),
      session: z.string().optional(),
      timeout: z.number().default(30000)
    },
    async (params) => {
      try {
        const result = await batchExecutor.execute(params);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "BATCH_EXECUTION_FAILED",
                  message: error.message,
                  recoverable: true
                }
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  );

  // Enhanced batch execute with conditional execution
  server.tool(
    "batch_execute_enhanced",
    {
      commands: z.array(z.object({
        command: z.string(),
        args: z.array(z.string()).default([]),
        cwd: z.string().optional(),
        env: z.record(z.string()).optional(),
        continueOnError: z.boolean().default(false),
        condition: z.object({
          type: z.enum(['exitCode', 'stdout', 'stderr', 'success', 'previousCommand']),
          operator: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'matches', 'greaterThan', 'lessThan']),
          value: z.union([z.string(), z.number(), z.boolean()]),
          targetCommand: z.number().optional()
        }).optional(),
        retryOnFailure: z.number().optional().default(0),
        retryDelay: z.number().optional().default(1000)
      })),
      parallel: z.boolean().default(false),
      maxParallel: z.number().default(5),
      session: z.string().optional(),
      timeout: z.number().default(30000),
      stopOnFirstFailure: z.boolean().default(false),
      maxOutputLines: z.number().optional().default(50).describe("Maximum lines of stdout/stderr per command (default: 50)"),
      includeFullOutput: z.boolean().optional().default(false).describe("Include full output regardless of size")
    },
    async (params) => {
      try {
        const result = await enhancedBatchExecutor.execute(params);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: {
                  code: "ENHANCED_BATCH_EXECUTION_FAILED",
                  message: error.message,
                  recoverable: true
                }
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    }
  );
}
