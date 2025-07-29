// Environment Tools Module
// Environment variable management tools

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionManager } from '../../session-manager.js';

export function registerEnvironmentTools(
  server: McpServer,
  sessionManager: SessionManager
) {
  // Set environment variable
  server.tool(
    "set_env",
    {
      name: z.string().describe("Environment variable name"),
      value: z.string().describe("Environment variable value"),
      session: z.string().optional().describe("Session name or ID (uses default if not specified)")
    },
    async ({ name, value, session: sessionName }) => {
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
      
      // Update session environment
      const updatedEnv = { ...session.env, [name]: value };
      sessionManager.updateSession(session.id, { env: updatedEnv });
      
      return {
        content: [
          { 
            type: "text", 
            text: `Environment variable set: ${name}=${value}` 
          }
        ]
      };
    }
  );

  // Get environment variables
  server.tool(
    "get_env",
    {
      name: z.string().optional().describe("Environment variable name (returns all if not specified)"),
      session: z.string().optional().describe("Session name or ID (uses default if not specified)")
    },
    async ({ name, session: sessionName }) => {
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
      
      if (name) {
        const value = session.env[name];
        return {
          content: [
            { 
              type: "text", 
              text: value !== undefined ? `${name}=${value}` : `Environment variable '${name}' not set` 
            }
          ]
        };
      } else {
        // Return all environment variables
        const envVars = Object.entries(session.env)
          .map(([key, val]) => `${key}=${val}`)
          .join("\n");
        
        return {
          content: [
            { 
              type: "text", 
              text: envVars || "No environment variables set" 
            }
          ]
        };
      }
    }
  );
}
