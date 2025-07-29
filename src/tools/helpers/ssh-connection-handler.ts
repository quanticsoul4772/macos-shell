// SSH Connection Handler Module
// Extracted from interactive-ssh-tool.ts during refactoring

import * as pty from 'node-pty';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { 
  InteractiveSSHSession, 
  CONNECT_TIMEOUT_MS, 
  ERROR_PATTERNS, 
  AUTH_SUCCESS_PATTERNS, 
  PROMPT_PATTERNS,
  ANSI_PATTERN 
} from './ssh-constants.js';
import { EnhancedCircularBuffer } from '../../utils/enhanced-circular-buffer.js';
import { AI_BUFFER_SIZE } from '../../sessions/session-types.js';

export class SSHConnectionHandler {
  
  stripAnsi(text: string): string {
    return text.replace(ANSI_PATTERN, '');
  }

  detectConnectionStatus(data: string): 'connected' | 'error' | null {
    // Check for errors first
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.test(data)) {
        return 'error';
      }
    }

    // Check for successful connection
    for (const pattern of AUTH_SUCCESS_PATTERNS) {
      if (pattern.test(data)) {
        return 'connected';
      }
    }

    // Check for prompt patterns
    for (const pattern of PROMPT_PATTERNS) {
      if (pattern.test(data)) {
        return 'connected';
      }
    }

    return null;
  }

  async validateKeyFile(keyFile?: string): Promise<string | null> {
    if (!keyFile) return null;
    
    try {
      await fs.access(keyFile, fs.constants.R_OK);
      return null;
    } catch (error) {
      return `SSH key file not accessible: ${keyFile}`;
    }
  }

  buildSSHArgs(host: string, port: number, user?: string, keyFile?: string, options: string[] = []): { 
    args: string[];
    target: string;
  } {
    const sshArgs = ['-tt']; // Force TTY
    
    if (keyFile) {
      sshArgs.push('-i', keyFile);
    }
    
    if (port !== 22) {
      sshArgs.push('-p', port.toString());
    }
    
    const target = user ? `${user}@${host}` : host;
    sshArgs.push(target, ...options);
    
    return { args: sshArgs, target };
  }

  cleanEnv(): Record<string, string> {
    return Object.entries(process.env).reduce((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, string>);
  }

  async createConnection(
    host: string, 
    port: number = 22, 
    user?: string, 
    options: string[] = [],
    keyFile?: string
  ): Promise<{ session: InteractiveSSHSession; error?: string }> {
    // Validate key file if provided
    const keyError = await this.validateKeyFile(keyFile);
    if (keyError) {
      return { session: null as any, error: keyError };
    }

    const sessionId = uuidv4();
    const { args: sshArgs, target } = this.buildSSHArgs(host, port, user, keyFile, options);
    
    try {
      const ptyProcess = pty.spawn('ssh', sshArgs, {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: process.env.HOME || process.cwd(),
        env: this.cleanEnv()
      });
      
      const session: InteractiveSSHSession = {
        id: sessionId,
        pty: ptyProcess,
        host,
        user,
        port,
        keyFile,
        outputBuffer: new EnhancedCircularBuffer(AI_BUFFER_SIZE),
        status: 'connecting',
        lastActivity: new Date(),
        startTime: new Date()
      };
      
      return { session };
    } catch (error: any) {
      return { session: null as any, error: error.message };
    }
  }

  setupConnectionDetection(
    session: InteractiveSSHSession,
    onStatusChange: (status: 'connected' | 'error') => void
  ): NodeJS.Timeout {
    const connectTimeout = setTimeout(() => {
      if (session.status === 'connecting') {
        session.status = 'error';
        onStatusChange('error');
      }
    }, CONNECT_TIMEOUT_MS);
    
    // Buffer for connection detection
    let dataBuffer = '';
    
    // Hook into PTY data event for connection detection
    const originalOnData = session.pty.onData;
    session.pty.onData((data: string) => {
      if (session.status === 'connecting') {
        dataBuffer += data;
        const status = this.detectConnectionStatus(dataBuffer);
        if (status) {
          session.status = status;
          clearTimeout(connectTimeout);
          onStatusChange(status);
          dataBuffer = '';
        }
        
        // Keep buffer reasonable
        if (dataBuffer.length > 1000) {
          dataBuffer = dataBuffer.slice(-500);
        }
      }
    });
    
    return connectTimeout;
  }
}
