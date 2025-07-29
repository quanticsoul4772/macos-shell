// Preflight Check Tools
// AI-optimized tools for validating conditions before operations

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execa } from "execa";
import * as fs from "fs/promises";
import * as net from "net";
import { SessionManager } from '../session-manager.js';

export function registerPreflightTools(
  server: McpServer,
  sessionManager: SessionManager
) {
  // Comprehensive preflight check tool
  server.tool(
    "preflight_check",
    {
      commands: z.array(z.string()).optional().describe("Commands to check existence"),
      paths: z.array(z.object({
        path: z.string(),
        type: z.enum(['file', 'directory', 'any']).optional().default('any'),
        access: z.enum(['read', 'write', 'execute']).optional()
      })).optional().describe("Paths to validate"),
      ports: z.array(z.number()).optional().describe("TCP ports to check availability"),
      env_vars: z.array(z.string()).optional().describe("Environment variables to check"),
      session: z.string().optional().describe("Session to check in")
    },
    async ({ commands, paths, ports, env_vars, session: sessionName }) => {
      const results: any = {
        timestamp: new Date().toISOString(),
        checks: {}
      };

      // Get session for environment checks
      const session = sessionName ? await sessionManager.getSession(sessionName) : null;
      
      // Check commands
      if (commands && commands.length > 0) {
        results.checks.commands = {};
        
        for (const cmd of commands) {
          try {
            // Use 'command -v' which works in most shells
            const { stdout } = await execa('command', ['-v', cmd], {
              shell: '/bin/zsh',
              cwd: session?.cwd || process.cwd()
            });
            
            results.checks.commands[cmd] = {
              exists: true,
              path: stdout.trim()
            };
          } catch {
            // Try 'which' as fallback
            try {
              const { stdout } = await execa('which', [cmd], {
                shell: '/bin/zsh',
                cwd: session?.cwd || process.cwd()
              });
              
              results.checks.commands[cmd] = {
                exists: true,
                path: stdout.trim()
              };
            } catch {
              results.checks.commands[cmd] = {
                exists: false,
                path: null
              };
            }
          }
        }
      }
      
      // Check paths
      if (paths && paths.length > 0) {
        results.checks.paths = {};
        
        for (const pathCheck of paths) {
          const result: any = {
            exists: false,
            type: null,
            readable: false,
            writable: false,
            executable: false
          };
          
          try {
            const stats = await fs.stat(pathCheck.path);
            result.exists = true;
            result.type = stats.isDirectory() ? 'directory' : 
                         stats.isFile() ? 'file' : 
                         stats.isSymbolicLink() ? 'symlink' : 'other';
            
            // Check if type matches requirement
            if (pathCheck.type !== 'any') {
              result.typeMatch = 
                (pathCheck.type === 'file' && stats.isFile()) ||
                (pathCheck.type === 'directory' && stats.isDirectory());
            }
            
            // Check access permissions
            try {
              await fs.access(pathCheck.path, fs.constants.R_OK);
              result.readable = true;
            } catch {}
            
            try {
              await fs.access(pathCheck.path, fs.constants.W_OK);
              result.writable = true;
            } catch {}
            
            try {
              await fs.access(pathCheck.path, fs.constants.X_OK);
              result.executable = true;
            } catch {}
            
            // Check specific access requirement
            if (pathCheck.access) {
              result.accessMatch = 
                (pathCheck.access === 'read' && result.readable) ||
                (pathCheck.access === 'write' && result.writable) ||
                (pathCheck.access === 'execute' && result.executable);
            }
            
          } catch (error: any) {
            result.error = error.code || 'UNKNOWN';
          }
          
          results.checks.paths[pathCheck.path] = result;
        }
      }
      
      // Check ports
      if (ports && ports.length > 0) {
        results.checks.ports = {};
        
        for (const port of ports) {
          const result = await checkPort(port);
          results.checks.ports[port] = result;
        }
      }
      
      // Check environment variables
      if (env_vars && env_vars.length > 0) {
        results.checks.env_vars = {};
        const env = session?.env || process.env;
        
        for (const varName of env_vars) {
          results.checks.env_vars[varName] = {
            exists: varName in env,
            value: env[varName as keyof typeof env] || null
          };
        }
      }
      
      // Add summary
      results.summary = {
        all_commands_exist: commands ? 
          Object.values(results.checks.commands || {}).every((c: any) => c.exists) : true,
        all_paths_valid: paths ? 
          Object.values(results.checks.paths || {}).every((p: any) => {
            if (!p.exists) return false;
            if (p.typeMatch !== undefined && !p.typeMatch) return false;
            if (p.accessMatch !== undefined && !p.accessMatch) return false;
            return true;
          }) : true,
        all_ports_available: ports ? 
          Object.values(results.checks.ports || {}).every((p: any) => p.available) : true,
        all_env_vars_set: env_vars ? 
          Object.values(results.checks.env_vars || {}).every((e: any) => e.exists) : true
      };
      
      results.summary.all_checks_passed = 
        results.summary.all_commands_exist &&
        results.summary.all_paths_valid &&
        results.summary.all_ports_available &&
        results.summary.all_env_vars_set;
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(results, null, 2)
        }]
      };
    }
  );
  
  // Quick system profile tool
  server.tool(
    "system_profile",
    {
      include: z.array(z.enum([
        'os', 'shell', 'node', 'python', 'git', 'docker', 
        'homebrew', 'xcode', 'ports', 'disk', 'memory'
      ])).optional().describe("Specific items to include (default: all)")
    },
    async ({ include }) => {
      const profile: any = {
        timestamp: new Date().toISOString()
      };
      
      const checkAll = !include || include.length === 0;
      
      // OS Information
      if (checkAll || include?.includes('os')) {
        try {
          const { stdout: osVersion } = await execa('sw_vers', ['-productVersion']);
          const { stdout: osBuild } = await execa('sw_vers', ['-buildVersion']);
          const { stdout: arch } = await execa('uname', ['-m']);
          
          profile.os = {
            version: osVersion.trim(),
            build: osBuild.trim(),
            architecture: arch.trim()
          };
        } catch {
          profile.os = { error: 'Unable to determine OS version' };
        }
      }
      
      // Shell Information
      if (checkAll || include?.includes('shell')) {
        try {
          const { stdout: shellPath } = await execa('echo', ['$SHELL'], { shell: true });
          const { stdout: shellVersion } = await execa(shellPath.trim(), ['--version']);
          
          profile.shell = {
            path: shellPath.trim(),
            version: shellVersion.split('\n')[0]
          };
        } catch {
          profile.shell = { error: 'Unable to determine shell version' };
        }
      }
      
      // Node.js
      if (checkAll || include?.includes('node')) {
        try {
          const { stdout: nodeVersion } = await execa('node', ['--version']);
          const { stdout: npmVersion } = await execa('npm', ['--version']);
          
          profile.node = {
            version: nodeVersion.trim(),
            npm: npmVersion.trim()
          };
        } catch {
          profile.node = { installed: false };
        }
      }
      
      // Python
      if (checkAll || include?.includes('python')) {
        profile.python = {};
        
        // Check Python 3
        try {
          const { stdout } = await execa('python3', ['--version']);
          profile.python.python3 = stdout.trim();
        } catch {
          profile.python.python3 = null;
        }
        
        // Check pip
        try {
          const { stdout } = await execa('pip3', ['--version']);
          profile.python.pip3 = stdout.split(' ')[1];
        } catch {
          profile.python.pip3 = null;
        }
      }
      
      // Git
      if (checkAll || include?.includes('git')) {
        try {
          const { stdout } = await execa('git', ['--version']);
          profile.git = {
            version: stdout.replace('git version ', '').trim()
          };
        } catch {
          profile.git = { installed: false };
        }
      }
      
      // Docker
      if (checkAll || include?.includes('docker')) {
        try {
          const { stdout } = await execa('docker', ['--version']);
          profile.docker = {
            version: stdout.trim(),
            running: false
          };
          
          // Check if Docker daemon is running
          try {
            await execa('docker', ['ps'], { timeout: 2000 });
            profile.docker.running = true;
          } catch {}
        } catch {
          profile.docker = { installed: false };
        }
      }
      
      // Homebrew
      if (checkAll || include?.includes('homebrew')) {
        try {
          const { stdout } = await execa('brew', ['--version']);
          profile.homebrew = {
            version: stdout.split('\n')[0].replace('Homebrew ', '').trim()
          };
        } catch {
          profile.homebrew = { installed: false };
        }
      }
      
      // Xcode Command Line Tools
      if (checkAll || include?.includes('xcode')) {
        try {
          const { stdout } = await execa('xcode-select', ['-p']);
          profile.xcode = {
            path: stdout.trim(),
            installed: true
          };
        } catch {
          profile.xcode = { installed: false };
        }
      }
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify(profile, null, 2)
        }]
      };
    }
  );
}

// Helper function to check port availability
async function checkPort(port: number): Promise<any> {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ available: false, inUse: true });
      } else {
        resolve({ available: false, error: err.code });
      }
    });
    
    server.once('listening', () => {
      server.close();
      resolve({ available: true, inUse: false });
    });
    
    server.listen(port);
  });
}
