// Interactive SSH Tool Module - REFACTORED VERSION
// Streamlined to use modular components
//
// CRITICAL SSH WORKFLOW FOR AI:
// 1. ALWAYS run ssh_interactive_list first to check for existing sessions
// 2. Reuse existing sessions (0.000s execution) instead of creating new ones (2s)
// 3. Only use ssh_interactive_start if no suitable session exists
//
// PERFORMANCE COMPARISON:
// - New SSH connection: 2+ seconds
// - Existing session command: 0.000s (instant!)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionManager } from '../session-manager.js';
import { SSHSessionManager } from './helpers/ssh-session-manager.js';
import { SSHToolHandlers } from './helpers/ssh-tool-handlers.js';

// Global instance
let sshManager: SSHSessionManager | null = null;

export function registerInteractiveSSHTools(
  server: McpServer,
  sessionManager: SessionManager
) {
  sshManager = new SSHSessionManager(sessionManager);
  const handlers = new SSHToolHandlers(sshManager);
  
  // Cleanup on process termination
  process.on('SIGTERM', () => sshManager?.cleanup());
  process.on('SIGINT', () => sshManager?.cleanup());

  // Start SSH session - AI optimized
  // WARNING: Takes ~2 seconds to connect. ALWAYS check ssh_interactive_list first!
  server.tool(
    "ssh_interactive_start",
    {
      host: z.string().describe("SSH host to connect to"),
      port: z.number().optional().default(22).describe("SSH port (default: 22)"),
      user: z.string().optional().describe("SSH username"),
      options: z.array(z.string()).optional().default([]).describe("Additional SSH options (e.g., ['-o', 'HostKeyAlgorithms=+ssh-rsa'])"),
      key_file: z.string().optional().describe("Path to SSH private key file")
    },
    async (params) => {
      if (!sshManager) {
        return {
          content: [{ type: "text" as const, text: "SSH manager not initialized" }],
          isError: true
        };
      }
      return handlers.handleStartSession(params);
    }
  );
  
  // Send input to existing session - INSTANT execution (0.000s)
  // Use this instead of creating new connections!
  server.tool(
    "ssh_interactive_send",
    {
      session_id: z.string().describe("Interactive SSH session ID (get from ssh_interactive_list)"),
      input: z.string().describe("Command to execute (instant - 0.000s execution)"),
      add_newline: z.boolean().optional().default(true).describe("Add newline after input (default: true)")
    },
    async (params) => {
      if (!sshManager) {
        return {
          content: [{ type: "text" as const, text: "SSH manager not initialized" }],
          isError: true
        };
      }
      return handlers.handleSendInput(params);
    }
  );
  
  // Send control character
  server.tool(
    "ssh_interactive_control",
    {
      session_id: z.string().describe("Interactive SSH session ID (get from ssh_interactive_list)"),
      char: z.string().describe("Control character (e.g., 'C' for Ctrl+C)")
    },
    async (params) => {
      if (!sshManager) {
        return {
          content: [{ type: "text" as const, text: "SSH manager not initialized" }],
          isError: true
        };
      }
      return handlers.handleControlChar(params);
    }
  );
  
  // Get output with search - AI optimized
  server.tool(
    "ssh_interactive_output",
    {
      session_id: z.string().describe("Interactive SSH session ID (get from ssh_interactive_list)"),
      lines: z.number().optional().describe("Number of lines to retrieve (default: all)"),
      from_line: z.number().optional().describe("Starting line number"),
      search: z.string().optional().describe("Search pattern"),
      search_type: z.enum(['text', 'regex']).optional().default('text').describe("Search type"),
      case_sensitive: z.boolean().optional().default(false).describe("Case-sensitive search"),
      invert_match: z.boolean().optional().default(false).describe("Show non-matching lines")
    },
    async (params) => {
      if (!sshManager) {
        return {
          content: [{ type: "text" as const, text: "SSH manager not initialized" }],
          isError: true
        };
      }
      return handlers.handleGetOutput(params);
    }
  );
  
  // Wait for output
  server.tool(
    "ssh_interactive_wait",
    {
      session_id: z.string().describe("Interactive SSH session ID (get from ssh_interactive_list)"),
      after_line: z.number().describe("Wait for output after this line number"),
      timeout: z.number().optional().default(5000).describe("Timeout in milliseconds")
    },
    async (params) => {
      if (!sshManager) {
        return {
          content: [{ type: "text" as const, text: "SSH manager not initialized" }],
          isError: true
        };
      }
      return handlers.handleWaitForOutput(params);
    }
  );
  
  // Resize terminal
  server.tool(
    "ssh_interactive_resize",
    {
      session_id: z.string().describe("Interactive SSH session ID (get from ssh_interactive_list)"),
      cols: z.number().describe("Number of columns"),
      rows: z.number().describe("Number of rows")
    },
    async (params) => {
      if (!sshManager) {
        return {
          content: [{ type: "text" as const, text: "SSH manager not initialized" }],
          isError: true
        };
      }
      return handlers.handleResize(params);
    }
  );
  
  // Close session
  server.tool(
    "ssh_interactive_close",
    {
      session_id: z.string().describe("Interactive SSH session ID (get from ssh_interactive_list)")
    },
    async (params) => {
      if (!sshManager) {
        return {
          content: [{ type: "text" as const, text: "SSH manager not initialized" }],
          isError: true
        };
      }
      return handlers.handleClose(params);
    }
  );
  
  // List sessions - ALWAYS RUN THIS FIRST!
  // Check for existing sessions to reuse (instant execution) before creating new ones
  server.tool(
    "ssh_interactive_list",
    {},
    async () => {
      if (!sshManager) {
        return {
          content: [{ type: "text" as const, text: "SSH manager not initialized" }],
          isError: true
        };
      }
      return handlers.handleList();
    }
  );
}
