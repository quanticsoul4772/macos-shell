// Session Tools Module
// Session management tools

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionManager } from '../session-manager.js';

export function registerSessionTools(server: McpServer, sessionManager: SessionManager) {
  // Create shell session tool
  server.tool(
    "create_shell_session",
    {
      name: z.string().describe("Session name"),
      cwd: z.string().optional().describe("Initial working directory"),
      env: z.record(z.string()).optional().describe("Initial environment variables")
    },
    async ({ name, cwd, env }) => {
      // Check if session with this name already exists
      if (await sessionManager.getSession(name)) {
        return {
          content: [
            { 
              type: "text", 
              text: `Error: Session '${name}' already exists` 
            }
          ],
          isError: true
        };
      }
      
      const sessionId = sessionManager.createSession(name, cwd);
      const session = (await sessionManager.getSession(sessionId))!;
      
      // Set environment variables if provided
      if (env) {
        session.env = { ...session.env, ...env };
      }
      
      return {
        content: [
          { 
            type: "text", 
            text: `Created session '${name}' with ID: ${sessionId}\nWorking directory: ${session.cwd}` 
          }
        ]
      };
    }
  );

  // List shell sessions tool
  server.tool(
    "list_shell_sessions",
    {},
    async () => {
      const sessions = sessionManager.listSessions();
      const sessionInfo = sessions.map(s => {
        const processCount = sessionManager.getSessionProcessCount(s.id);
        return `- ${s.name} (ID: ${s.id})\n  CWD: ${s.cwd}\n  Created: ${s.created.toISOString()}\n  Last used: ${s.lastUsed.toISOString()}\n  Commands run: ${s.history.length}\n  Background processes: ${processCount}`;
      }).join("\n\n");
      
      return {
        content: [
          { 
            type: "text", 
            text: `Active sessions:\n\n${sessionInfo}` 
          }
        ]
      };
    }
  );

  // Close session tool
  server.tool(
    "close_session",
    {
      session: z.string().describe("Session name or ID to close")
    },
    async ({ session }) => {
      if (session === "default") {
        return {
          content: [
            { 
              type: "text", 
              text: "Error: Cannot close the default session" 
            }
          ],
          isError: true
        };
      }
      
      const deleted = await sessionManager.deleteSession(session);
      if (deleted) {
        return {
          content: [
            { 
              type: "text", 
              text: `Session '${session}' closed` 
            }
          ]
        };
      } else {
        return {
          content: [
            { 
              type: "text", 
              text: `Error: Session '${session}' not found` 
            }
          ],
          isError: true
        };
      }
    }
  );

  // Note: history tool is already in command-tools.ts
}
