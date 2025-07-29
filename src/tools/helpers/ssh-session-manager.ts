// SSH Session Manager Module
// Extracted and refactored from interactive-ssh-tool.ts

import { v4 as uuidv4 } from 'uuid';
import { SessionManager } from '../../session-manager.js';
import { SSHConnectionHandler } from './ssh-connection-handler.js';
import { SSHOutputHandler } from './ssh-output-handler.js';
import { 
  InteractiveSSHSession, 
  MAX_SESSIONS, 
  SESSION_TIMEOUT_MS
} from './ssh-constants.js';

export class SSHSessionManager {
  private sessions = new Map<string, InteractiveSSHSession>();
  private sessionManager: SessionManager;
  private connectionHandler: SSHConnectionHandler;
  private outputHandler: SSHOutputHandler;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.connectionHandler = new SSHConnectionHandler();
    this.outputHandler = new SSHOutputHandler();
  }

  private resetTimeout(session: InteractiveSSHSession) {
    if (session.timeoutHandle) {
      clearTimeout(session.timeoutHandle);
    }
    
    session.timeoutHandle = setTimeout(() => {
      this.closeSession(session.id, 'timeout');
    }, SESSION_TIMEOUT_MS);
  }

  async startSession(
    host: string, 
    port: number = 22, 
    user?: string, 
    options: string[] = [],
    keyFile?: string
  ): Promise<{ sessionId: string; error?: string }> {
    // Check session limit
    if (this.sessions.size >= MAX_SESSIONS) {
      return { sessionId: '', error: `Maximum session limit (${MAX_SESSIONS}) reached` };
    }

    // Create connection
    const { session, error } = await this.connectionHandler.createConnection(
      host, port, user, options, keyFile
    );
    
    if (error || !session) {
      return { sessionId: '', error: error || 'Failed to create connection' };
    }

    // Setup output capture
    this.outputHandler.setupOutputCapture(
      session, 
      this.connectionHandler.stripAnsi.bind(this.connectionHandler)
    );
    
    // Setup connection detection
    this.connectionHandler.setupConnectionDetection(session, (status) => {
      if (status === 'error') {
        this.closeSession(session.id, 'connection failed');
      }
    });
    
    // Setup activity tracking
    const originalOnData = session.pty.onData;
    session.pty.onData((data: string) => {
      session.lastActivity = new Date();
      this.resetTimeout(session);
    });
    
    // Setup cleanup on exit
    session.pty.onExit(() => {
      if (session.timeoutHandle) {
        clearTimeout(session.timeoutHandle);
      }
      setTimeout(() => {
        this.sessions.delete(session.id);
      }, 5000);
    });
    
    // Store and start timeout
    this.sessions.set(session.id, session);
    this.resetTimeout(session);
    
    return { sessionId: session.id };
  }

  sendInput(sessionId: string, input: string, addNewline: boolean = true): { 
    success: boolean; 
    error?: string 
  } {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }
    
    if (session.status === 'disconnected' || session.status === 'error') {
      return { success: false, error: `Session is ${session.status}` };
    }
    
    try {
      session.pty.write(input + (addNewline ? '\r' : ''));
      session.lastActivity = new Date();
      this.resetTimeout(session);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  sendControlChar(sessionId: string, char: string): { 
    success: boolean; 
    error?: string 
  } {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }
    
    try {
      const controlChar = String.fromCharCode(char.toUpperCase().charCodeAt(0) - 64);
      session.pty.write(controlChar);
      session.lastActivity = new Date();
      this.resetTimeout(session);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  resizeTerminal(sessionId: string, cols: number, rows: number): { 
    success: boolean; 
    error?: string 
  } {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }
    
    try {
      session.pty.resize(cols, rows);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  getOutput(
    sessionId: string, 
    lines?: number, 
    fromLine?: number,
    search?: string,
    searchType: 'text' | 'regex' = 'text',
    caseSensitive: boolean = false,
    invertMatch: boolean = false
  ): { 
    output: string; 
    totalLines: number; 
    matchCount?: number;
    hasMatches?: boolean;
    error?: string 
  } {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { output: '', totalLines: 0, error: `Session '${sessionId}' not found` };
    }
    
    return this.outputHandler.getOutput(
      session, lines, fromLine, search, searchType, caseSensitive, invertMatch
    );
  }

  async waitForOutput(
    sessionId: string, 
    afterLine: number, 
    timeout: number = 5000
  ): Promise<{ output: string; error?: string }> {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { output: '', error: `Session '${sessionId}' not found` };
    }
    
    return this.outputHandler.waitForOutput(session, afterLine, timeout);
  }

  closeSession(sessionId: string, reason?: string): { 
    success: boolean; 
    error?: string 
  } {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }
    
    try {
      if (session.timeoutHandle) {
        clearTimeout(session.timeoutHandle);
      }
      
      session.pty.kill();
      this.sessions.delete(sessionId);
      
      return { success: true };
    } catch (error: any) {
      this.sessions.delete(sessionId);
      return { success: true };
    }
  }

  listSessions(): InteractiveSSHSession[] {
    return Array.from(this.sessions.values()).map(session => ({
      ...session,
      pty: undefined as any // Don't expose PTY object
    }));
  }

  cleanup() {
    for (const [sessionId, session] of this.sessions) {
      try {
        if (session.timeoutHandle) {
          clearTimeout(session.timeoutHandle);
        }
        session.pty.kill();
      } catch (error) {
        // Ignore
      }
    }
    this.sessions.clear();
  }
}
