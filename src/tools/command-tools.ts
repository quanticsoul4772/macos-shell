// Command Tools Module - Refactored
// Orchestrates all command-related tools

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionManager } from '../session-manager.js';
import { BatchExecutor } from '../utils/batch-executor.js';
import { CommandExecutor } from './command/command-executor.js';
import { AICommandEnhancer } from './command/ai-command-enhancer.js';
import { registerEnvironmentTools } from './command/environment-tools.js';
import { registerScriptTools } from './command/script-tools.js';
import { registerBatchTools } from './command/batch-tools.js';
import { registerNavigationTools } from './command/navigation-tools.js';
import { registerCacheManagementTools } from './cache-management-tools.js';

export function registerCommandTools(
  server: McpServer,
  sessionManager: SessionManager,
  batchExecutor: BatchExecutor
) {
  // Initialize command executor and AI enhancer
  const commandExecutor = new CommandExecutor(sessionManager);
  const aiEnhancer = new AICommandEnhancer(commandExecutor);

  // Register main run_command tool with AI enhancements and SDK 1.18.0 features
  server.tool(
    "run_command",
    {
      command: z.string().describe("The shell command to execute"),
      args: z.array(z.string()).default([]).describe("Command arguments"),
      session: z.string().optional().describe("Session name or ID (uses default if not specified)"),
      cwd: z.string().optional().describe("Working directory (overrides session cwd)"),
      env: z.record(z.string()).optional().describe("Environment variables (merged with session env)"),
      timeout: z.number().optional().default(30000).describe("Command timeout in milliseconds"),
      maxOutputLines: z.number().optional().default(100).describe("Maximum lines of stdout to return (default: 100)"),
      maxErrorLines: z.number().optional().default(50).describe("Maximum lines of stderr to return (default: 50)")
    },
    async ({ command, args, session: sessionName, cwd, env, timeout, maxOutputLines, maxErrorLines }, extra?: any) => {
      // Import progress tracking utilities
      const { ProgressTracker, ShellProgressReporter, extractToolContext } = await import('../utils/progress-tracker.js');

      // Extract SDK 1.18.0 metadata
      const context = extractToolContext(extra, server);

      // Create progress tracker
      const progressTracker = context.progressToken && context.server
        ? new ProgressTracker(context.server, context.progressToken, context.requestId)
        : null;

      const progressReporter = progressTracker
        ? new ShellProgressReporter(progressTracker, timeout)
        : null;

      // Report command start
      await progressReporter?.reportStart(command);
      const session = await sessionManager.getSession(sessionName);
      
      if (!session) {
        return {
          content: [
            { 
              type: "text", 
              text: `Error: Session '${sessionName}' not found` 
            }
          ],
          isError: true
        };
      }

      // Merge environment variables
      const finalEnv = { ...session.env, ...env };
      
      // Determine working directory
      const finalCwd = cwd || session.cwd;

      // Execute with AI enhancements
      const result = await aiEnhancer.executeWithAI({
        command,
        args,
        cwd: finalCwd,
        env: finalEnv,
        timeout,
        sessionId: session.id,
        maxOutputLines,
        maxErrorLines
      });

      // Report command completion
      await progressReporter?.reportComplete(result.exitCode);

      // Build compact response object
      const response: any = {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        success: result.success,
        duration: result.duration,
        command: result.command
      };

      // Add optional fields only if present
      if (result.cached !== undefined) {
        response.cached = result.cached;
        response.cacheStrategy = result.cacheStrategy;
      }
      if (result.truncation) {
        response.truncation = result.truncation;
      }
      if (result.warnings) {
        response.warnings = result.warnings;
      }
      if (result.error) {
        response.error = result.error;
      }

      // Add request ID if available for correlation
      if (context.requestId) {
        response.requestId = context.requestId;
      }

      return {
        content: [
          { 
            type: "text", 
            text: JSON.stringify(response) // Compact JSON, no formatting
          }
        ],
        isError: !result.success
      };
    }
  );

  // Register all other tool modules
  registerNavigationTools(server, sessionManager);
  registerEnvironmentTools(server, sessionManager);
  registerScriptTools(server, sessionManager);
  registerBatchTools(server, sessionManager, batchExecutor);
  
  // Register cache management tools
  registerCacheManagementTools(server);
}
