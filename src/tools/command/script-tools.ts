// Script Tools Module
// Script execution functionality

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execa, ExecaError } from "execa";
import * as path from "path";
import * as fs from "fs/promises";
import * as os from "os";
import { SessionManager } from '../../session-manager.js';
import logger from '../../utils/logger.js';

export function registerScriptTools(
  server: McpServer,
  sessionManager: SessionManager
) {
  // Run script tool
  server.tool(
    "run_script",
    {
      script: z.string().describe("Shell script content to execute"),
      session: z.string().optional().describe("Session name or ID (uses default if not specified)"),
      timeout: z.number().optional().default(60000).describe("Script timeout in milliseconds")
    },
    async ({ script, session: sessionName, timeout }) => {
      const startTime = new Date();
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

      let tempDir: string | null = null;
      
      try {
        // Create temporary script file
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shell-script-'));
        const scriptPath = path.join(tempDir, 'script.sh');
        await fs.writeFile(scriptPath, script, 'utf8');
        await fs.chmod(scriptPath, 0o755);
        
        logger.debug({ 
          module: 'script-tools', 
          action: 'create-script', 
          scriptPath,
          lines: script.split('\n').length 
        }, 'Created temporary script file');
        
        // Execute script
        const { stdout, stderr, exitCode } = await execa('/bin/zsh', [scriptPath], {
          cwd: session.cwd,
          env: session.env,
          timeout,
          reject: false  // Don't throw on non-zero exit
        });
        
        // Record in history
        const duration = Date.now() - startTime.getTime();
        const success = exitCode === 0;
        
        sessionManager.addToHistory(session.id, {
          command: 'script',
          args: [`[${script.split('\n').length} lines]`],
          exitCode: exitCode ?? null,
          stdout,
          stderr,
          startTime,
          duration
        });
        
        // Return structured JSON for AI parsing
        return {
          content: [
            { 
              type: "text", 
              text: JSON.stringify({
                stdout: stdout || '',
                stderr: stderr || '',
                exitCode: exitCode || 0,
                success,
                duration,
                command: `script [${script.split('\n').length} lines]`
              }, null, 2)
            }
          ]
        };
      } catch (error: any) {
        const duration = Date.now() - startTime.getTime();
        const execaError = error as ExecaError;
        
        logger.error({ 
          module: 'script-tools', 
          action: 'execute-script', 
          error,
          lines: script.split('\n').length 
        }, 'Script execution failed');
        
        // Record failed script in history
        sessionManager.addToHistory(session.id, {
          command: 'script',
          args: [`[${script.split('\n').length} lines]`],
          exitCode: execaError.exitCode ?? null,
          stdout: typeof execaError.stdout === 'string' ? execaError.stdout : "",
          stderr: typeof execaError.stderr === 'string' ? execaError.stderr : "",
          startTime,
          duration
        });
        
        // Return structured JSON even for errors
        return {
          content: [
            { 
              type: "text", 
              text: JSON.stringify({
                stdout: typeof execaError.stdout === 'string' ? execaError.stdout : '',
                stderr: typeof execaError.stderr === 'string' ? execaError.stderr : error.message,
                exitCode: execaError.exitCode ?? -1,
                success: false,
                duration,
                command: `script [${script.split('\n').length} lines]`,
                error: execaError.code || 'UNKNOWN'
              }, null, 2)
            }
          ],
          isError: true
        };
      } finally {
        // Clean up temporary files
        if (tempDir) {
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
            logger.debug({ 
              module: 'script-tools', 
              action: 'cleanup', 
              tempDir 
            }, 'Cleaned up temporary script directory');
          } catch (cleanupError) {
            logger.error({ 
              module: 'script-tools', 
              action: 'cleanup', 
              error: cleanupError,
              tempDir 
            }, 'Failed to clean up temporary script directory');
          }
        }
      }
    }
  );
}
