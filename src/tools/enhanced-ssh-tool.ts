// Enhanced Interactive SSH Tool with Native SSH Support
// Uses ssh2 library for faster connections when possible

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionManager } from '../session-manager.js';
import { SSHSessionManager as PTYSSHManager } from './helpers/ssh-session-manager.js';
import { NativeSSHManager } from '../utils/native-ssh-manager.js';
import logger from '../utils/logger.js';

// Feature flags
const USE_NATIVE_SSH = true; // Enable native SSH by default
const NATIVE_SSH_BENCHMARK = true; // Log connection times

export function registerEnhancedSSHTools(
  server: McpServer,
  sessionManager: SessionManager
) {
  const ptyManager = new PTYSSHManager(sessionManager);
  const nativeManager = new NativeSSHManager();
  
  // Cleanup on process exit
  process.on('SIGTERM', () => {
    ptyManager.cleanup();
    nativeManager.cleanup();
  });
  
  process.on('SIGINT', () => {
    ptyManager.cleanup();
    nativeManager.cleanup();
  });

  // Enhanced start session with native SSH support
  server.tool(
    "ssh_native_start",
    {
      host: z.string().describe("SSH host to connect to"),
      port: z.number().optional().default(22).describe("SSH port (default: 22)"),
      user: z.string().optional().describe("SSH username (uses SSH config if not specified)"),
      key_file: z.string().optional().describe("Path to SSH private key file (uses SSH config if not specified)"),
      password: z.string().optional().describe("SSH password (only if key auth not available)"),
      use_native: z.boolean().optional().default(USE_NATIVE_SSH).describe("Use native SSH implementation for faster connections")
    },
    async ({ host, port, user, key_file, password, use_native }) => {
      if (use_native) {
        const startTime = Date.now();
        const result = await nativeManager.startSession(host, port, user, key_file, password);
        
        if (NATIVE_SSH_BENCHMARK && result.connectionTime) {
          logger.info({ module: 'enhanced-ssh-tool', action: 'connection-benchmark', host, connectionTime: result.connectionTime }, `SSH Native: Connection to ${host} took ${result.connectionTime}ms`);
        }
        
        if (result.error) {
          // Fallback to PTY implementation
          logger.warn({ module: 'enhanced-ssh-tool', action: 'fallback-to-pty', error: result.error }, `SSH Native failed, falling back to PTY: ${result.error}`);
          const ptyResult = await ptyManager.startSession(host, port, user, [], key_file);
          
          if (ptyResult.error) {
            return {
              content: [{ type: "text" as const, text: `Failed to start SSH session: ${ptyResult.error}` }],
              isError: true
            };
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
          const output = ptyManager.getOutput(ptyResult.sessionId);
          
          return {
            content: [{
              type: "text" as const,
              text: `Started SSH session (PTY fallback) to ${user ? `${user}@` : ''}${host}:${port}
Session ID: ${ptyResult.sessionId}
Connection time: ${Date.now() - startTime}ms

Initial output:
${output.output}`
            }]
          };
        }
        
        // Wait a bit for initial output
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const output = nativeManager.getOutput(result.sessionId);
        const sessions = nativeManager.listSessions();
        const session = sessions.find(s => s.id === result.sessionId);
        
        return {
          content: [{
            type: "text" as const,
            text: `Started SSH session (Native) to ${session?.user}@${host}:${port}
Session ID: ${result.sessionId}
Status: ${session?.status || 'connected'}
Connection time: ${result.connectionTime}ms${key_file ? `\nKey file: ${key_file}` : ''}

Initial output:
${output.output}`
          }]
        };
      } else {
        // Use PTY implementation
        const result = await ptyManager.startSession(host, port, user, [], key_file);
        
        if (result.error) {
          return {
            content: [{ type: "text" as const, text: `Failed to start SSH session: ${result.error}` }],
            isError: true
          };
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        const output = ptyManager.getOutput(result.sessionId);
        
        return {
          content: [{
            type: "text" as const,
            text: `Started SSH session (PTY) to ${user ? `${user}@` : ''}${host}:${port}
Session ID: ${result.sessionId}

Initial output:
${output.output}`
          }]
        };
      }
    }
  );
  
  // Send input - works with both implementations
  server.tool(
    "ssh_native_send",
    {
      session_id: z.string().describe("SSH session ID"),
      input: z.string().describe("Command to execute"),
      add_newline: z.boolean().optional().default(true).describe("Add newline after input")
    },
    async ({ session_id, input, add_newline }) => {
      // Try native first
      let result = nativeManager.sendInput(session_id, input, add_newline);
      let isNative = true;
      
      if (!result.success && result.error?.includes('not found')) {
        // Try PTY
        result = ptyManager.sendInput(session_id, input, add_newline);
        isNative = false;
      }
      
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: result.error || "Failed to send input" }],
          isError: true
        };
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const output = isNative 
        ? nativeManager.getOutput(session_id, 50)
        : ptyManager.getOutput(session_id, 50);
      
      return {
        content: [{
          type: "text" as const,
          text: `Sent to SSH session (${isNative ? 'Native' : 'PTY'}).

Recent output:
${output.output}`
        }]
      };
    }
  );
  
  // List all sessions from both managers
  server.tool(
    "ssh_native_list",
    {},
    async () => {
      const nativeSessions = nativeManager.listSessions();
      const ptySessions = ptyManager.listSessions();
      
      if (nativeSessions.length === 0 && ptySessions.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No active SSH sessions" }]
        };
      }
      
      let response = `Active SSH sessions:\n\n`;
      
      if (nativeSessions.length > 0) {
        response += `Native SSH Sessions (${nativeSessions.length}):\n`;
        nativeSessions.forEach(session => {
          const runtime = (Date.now() - session.startTime.getTime()) / 1000;
          response += `\nID: ${session.id}
Type: Native (ssh2)
Host: ${session.user}@${session.host}:${session.port}
Status: ${session.status}
Runtime: ${runtime.toFixed(1)}s
Output lines: ${session.outputBuffer.getTotalLines()}${session.keyFile ? `\nKey file: ${session.keyFile}` : ''}\n`;
        });
      }
      
      if (ptySessions.length > 0) {
        if (nativeSessions.length > 0) response += '\n';
        response += `PTY SSH Sessions (${ptySessions.length}):\n`;
        ptySessions.forEach((session: any) => {
          const runtime = (Date.now() - session.startTime.getTime()) / 1000;
          response += `\nID: ${session.id}
Type: PTY (spawned)
Host: ${session.user ? `${session.user}@` : ''}${session.host}:${session.port}
Status: ${session.status}
Runtime: ${runtime.toFixed(1)}s
Output lines: ${session.outputBuffer.getTotalLines()}${session.keyFile ? `\nKey file: ${session.keyFile}` : ''}\n`;
        });
      }
      
      return {
        content: [{ type: "text" as const, text: response }]
      };
    }
  );
  
  // Close session - tries both implementations
  server.tool(
    "ssh_native_close",
    {
      session_id: z.string().describe("SSH session ID")
    },
    async ({ session_id }) => {
      let result = nativeManager.closeSession(session_id);
      let type = 'Native';
      
      if (!result.success && result.error?.includes('not found')) {
        result = ptyManager.closeSession(session_id);
        type = 'PTY';
      }
      
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: result.error || "Failed to close session" }],
          isError: true
        };
      }
      
      return {
        content: [{ type: "text" as const, text: `SSH session closed (${type})` }]
      };
    }
  );
  
  // Get output - tries both implementations
  server.tool(
    "ssh_native_output",
    {
      session_id: z.string().describe("SSH session ID"),
      lines: z.number().optional().describe("Number of lines to retrieve"),
      from_line: z.number().optional().describe("Starting line number")
    },
    async ({ session_id, lines, from_line }) => {
      let output = nativeManager.getOutput(session_id, lines, from_line);
      let type = 'Native';
      
      if (output.error?.includes('not found')) {
        output = ptyManager.getOutput(session_id, lines, from_line);
        type = 'PTY';
      }
      
      if (output.error) {
        return {
          content: [{ type: "text" as const, text: output.error }],
          isError: true
        };
      }
      
      return {
        content: [{
          type: "text" as const,
          text: `SSH Session Output (${type}):
Total lines: ${output.totalLines}

${output.output}`
        }]
      };
    }
  );
}

// Export the managers for direct access if needed
export { NativeSSHManager, PTYSSHManager };
