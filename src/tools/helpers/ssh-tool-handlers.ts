// SSH Tool Handlers Module
// Extracted from interactive-ssh-tool.ts during refactoring

import { z } from "zod";
import { SSHSessionManager } from './ssh-session-manager.js';
import { MAX_SESSIONS } from './ssh-constants.js';

export class SSHToolHandlers {
  constructor(private sshManager: SSHSessionManager) {}

  async handleStartSession(params: {
    host: string;
    port?: number;
    user?: string;
    options?: string[];
    key_file?: string;
  }) {
    const result = await this.sshManager.startSession(
      params.host, 
      params.port || 22, 
      params.user, 
      params.options || [], 
      params.key_file
    );
    
    if (result.error) {
      return {
        content: [{ type: "text" as const, text: `Failed to start SSH session: ${result.error}` }],
        isError: true
      };
    }
    
    // Wait a bit for initial output
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const output = this.sshManager.getOutput(result.sessionId);
    const sessions = this.sshManager.listSessions();
    const session = sessions.find(s => s.id === result.sessionId);
    
    return {
      content: [{
        type: "text" as const,
        text: `Started SSH session to ${params.user ? `${params.user}@` : ''}${params.host}:${params.port || 22}
Session ID: ${result.sessionId}
Status: ${session?.status || 'connecting'}${params.key_file ? `\nKey file: ${params.key_file}` : ''}

Initial output (ANSI stripped):
${output.output}`
      }]
    };
  }

  async handleSendInput(params: {
    session_id: string;
    input: string;
    add_newline?: boolean;
  }) {
    const sendResult = this.sshManager.sendInput(
      params.session_id, 
      params.input, 
      params.add_newline !== false
    );
    
    if (!sendResult.success) {
      return {
        content: [{ type: "text" as const, text: sendResult.error || "Failed to send input" }],
        isError: true
      };
    }
    
    // Wait for command to process
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const output = this.sshManager.getOutput(params.session_id, 50);
    
    return {
      content: [{
        type: "text" as const,
        text: `Sent to SSH session.

Recent output:
${output.output}`
      }]
    };
  }

  async handleControlChar(params: {
    session_id: string;
    char: string;
  }) {
    if (params.char.length !== 1) {
      return {
        content: [{ type: "text" as const, text: "Control character must be a single character" }],
        isError: true
      };
    }
    
    const result = this.sshManager.sendControlChar(params.session_id, params.char);
    
    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: result.error || "Failed to send control character" }],
        isError: true
      };
    }
    
    return {
      content: [{ type: "text" as const, text: `Sent Ctrl+${params.char.toUpperCase()} to SSH session` }]
    };
  }

  async handleGetOutput(params: {
    session_id: string;
    lines?: number;
    from_line?: number;
    search?: string;
    search_type?: 'text' | 'regex';
    case_sensitive?: boolean;
    invert_match?: boolean;
  }) {
    const output = this.sshManager.getOutput(
      params.session_id, 
      params.lines, 
      params.from_line,
      params.search,
      params.search_type || 'text',
      params.case_sensitive || false,
      params.invert_match || false
    );
    
    if (output.error) {
      return {
        content: [{ type: "text" as const, text: output.error }],
        isError: true
      };
    }
    
    const sessions = this.sshManager.listSessions();
    const session = sessions.find(s => s.id === params.session_id);
    
    let responseText = `SSH Session: ${session?.user ? `${session.user}@` : ''}${session?.host}:${session?.port}
Status: ${session?.status || 'unknown'}
Total lines: ${output.totalLines}`;

    if (params.search) {
      responseText += `\nSearch: "${params.search}" (${params.search_type || 'text'}${params.case_sensitive ? ', case-sensitive' : ''}${params.invert_match ? ', inverted' : ''})`;
      responseText += `\nMatches: ${output.matchCount || 0} lines`;
    }

    responseText += `\n\nOutput:\n${output.output}`;
    
    return {
      content: [{ type: "text" as const, text: responseText }]
    };
  }

  async handleWaitForOutput(params: {
    session_id: string;
    after_line: number;
    timeout?: number;
  }) {
    const output = await this.sshManager.waitForOutput(
      params.session_id, 
      params.after_line, 
      params.timeout || 5000
    );
    
    if (output.error) {
      return {
        content: [{ type: "text" as const, text: output.error }],
        isError: true
      };
    }
    
    if (!output.output) {
      return {
        content: [{ type: "text" as const, text: `No new output after line ${params.after_line} within ${params.timeout || 5000}ms` }]
      };
    }
    
    return {
      content: [{
        type: "text" as const,
        text: `New output received:\n${output.output}`
      }]
    };
  }

  async handleResize(params: {
    session_id: string;
    cols: number;
    rows: number;
  }) {
    const result = this.sshManager.resizeTerminal(
      params.session_id, 
      params.cols, 
      params.rows
    );
    
    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: result.error || "Failed to resize terminal" }],
        isError: true
      };
    }
    
    return {
      content: [{ type: "text" as const, text: `Resized terminal to ${params.cols}x${params.rows}` }]
    };
  }

  async handleClose(params: { session_id: string }) {
    const result = this.sshManager.closeSession(params.session_id);
    
    if (!result.success) {
      return {
        content: [{ type: "text" as const, text: result.error || "Failed to close session" }],
        isError: true
      };
    }
    
    return {
      content: [{ type: "text" as const, text: "SSH session closed" }]
    };
  }

  async handleList() {
    const sessions = this.sshManager.listSessions();
    
    if (sessions.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No active SSH sessions" }]
      };
    }
    
    const sessionInfo = sessions.map(session => {
      const runtime = (Date.now() - session.startTime.getTime()) / 1000;
      return `ID: ${session.id}
Host: ${session.user ? `${session.user}@` : ''}${session.host}:${session.port}
Status: ${session.status}
Runtime: ${runtime.toFixed(1)}s
Output lines: ${session.outputBuffer.getTotalLines()}${session.keyFile ? `\nKey file: ${session.keyFile}` : ''}`;
    }).join('\n\n');
    
    return {
      content: [{
        type: "text" as const,
        text: `Active SSH sessions (${sessions.length}/${MAX_SESSIONS}):\n\n${sessionInfo}`
      }]
    };
  }
}
