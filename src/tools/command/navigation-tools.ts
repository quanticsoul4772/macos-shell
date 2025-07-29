// Navigation Tools Module
// Directory navigation and history management

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "path";
import * as fs from "fs/promises";
import { SessionManager } from '../../session-manager.js';

export function registerNavigationTools(
  server: McpServer,
  sessionManager: SessionManager
) {
  // Directory navigation tool
  server.tool(
    "cd",
    {
      path: z.string().describe("Directory path to change to"),
      session: z.string().optional().describe("Session name or ID (uses default if not specified)")
    },
    async ({ path: targetPath, session: sessionName }) => {
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
      
      try {
        // Resolve the path relative to current working directory
        const resolvedPath = path.resolve(session.cwd, targetPath);
        
        // Check if directory exists
        const stats = await fs.stat(resolvedPath);
        if (!stats.isDirectory()) {
          throw new Error(`'${resolvedPath}' is not a directory`);
        }
        
        // Update session working directory
        sessionManager.updateSession(session.id, { cwd: resolvedPath });
        
        return {
          content: [
            { 
              type: "text", 
              text: `Changed directory to: ${resolvedPath}` 
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            { 
              type: "text", 
              text: `Error changing directory: ${error.message}` 
            }
          ],
          isError: true
        };
      }
    }
  );

  // Get current working directory
  server.tool(
    "pwd",
    {
      session: z.string().optional().describe("Session name or ID (uses default if not specified)")
    },
    async ({ session: sessionName }) => {
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
      
      return {
        content: [
          { 
            type: "text", 
            text: session.cwd 
          }
        ]
      };
    }
  );

  // Command history tool
  server.tool(
    "history",
    {
      session: z.string().optional().describe("Session name or ID (uses default if not specified)"),
      limit: z.number().optional().default(10).describe("Number of recent commands to show")
    },
    async ({ session: sessionName, limit }) => {
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
      
      const recentHistory = session.history.slice(-limit);
      const historyText = recentHistory.map((h, i) => 
        `${session.history.length - limit + i + 1}. ${h.command} ${h.args.join(" ")}\n   Exit code: ${h.exitCode}\n   Duration: ${h.duration}ms\n   Time: ${h.startTime.toISOString()}`
      ).join("\n\n");
      
      return {
        content: [
          { 
            type: "text", 
            text: `Recent command history for session '${session.name}':\n\n${historyText}` 
          }
        ]
      };
    }
  );
}
