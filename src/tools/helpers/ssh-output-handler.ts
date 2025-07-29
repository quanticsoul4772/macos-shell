// SSH Output Handler Module  
// Extracted from interactive-ssh-tool.ts during refactoring

import { InteractiveSSHSession } from './ssh-constants.js';
import { OutputLine } from '../../background-process.js';

export class SSHOutputHandler {

  /**
   * Process PTY data stream and handle line buffering
   */
  setupOutputCapture(
    session: InteractiveSSHSession,
    stripAnsi: (text: string) => string
  ): void {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let lineNumber = 0;
    
    // Helper to process lines
    const processLine = (data: string, type: 'stdout' | 'stderr', buffer: string): string => {
      const lines = (buffer + data).split('\n');
      const remaining = lines.pop() || '';
      
      for (const line of lines) {
        if (line || lineNumber > 0) {
          session.outputBuffer.add({
            timestamp: new Date(),
            type,
            content: stripAnsi(line), // Store clean version
            lineNumber: ++lineNumber
          });
        }
      }
      
      return remaining;
    };
    
    // Capture output
    session.pty.onData((data: string) => {
      // Split by newline for proper line handling
      const lines = data.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line || index < lines.length - 1) {
          session.outputBuffer.add({
            timestamp: new Date(),
            type: 'stdout',
            content: stripAnsi(line),
            lineNumber: session.outputBuffer.getTotalLines() + 1
          });
        }
      });
      
      session.lastActivity = new Date();
    });
    
    // Handle process exit
    session.pty.onExit((exitCode) => {
      session.status = 'disconnected';
      
      // Flush any remaining partial lines
      if (stdoutBuffer) {
        session.outputBuffer.add({
          timestamp: new Date(),
          type: 'stdout',  
          content: stripAnsi(stdoutBuffer),
          lineNumber: ++lineNumber
        });
      }
      if (stderrBuffer) {
        session.outputBuffer.add({
          timestamp: new Date(),
          type: 'stderr',
          content: stripAnsi(stderrBuffer),
          lineNumber: ++lineNumber
        });
      }
    });
  }

  /**
   * Get output with optional search and filtering
   */
  getOutput(
    session: InteractiveSSHSession,
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
    let outputLines = session.outputBuffer.getLines(lines, fromLine);
    const totalLines = session.outputBuffer.getTotalLines();
    
    // Apply search if provided
    if (search) {
      // Create matcher
      let matcherFn: (line: string) => boolean;
      
      if (searchType === 'regex') {
        try {
          const flags = caseSensitive ? '' : 'i';
          const regex = new RegExp(search, flags);
          matcherFn = (line: string) => regex.test(line);
        } catch (error: any) {
          return { output: '', totalLines: 0, error: `Invalid regex: ${error.message}` };
        }
      } else {
        if (caseSensitive) {
          matcherFn = (line: string) => line.includes(search);
        } else {
          const searchLower = search.toLowerCase();
          matcherFn = (line: string) => line.toLowerCase().includes(searchLower);
        }
      }
      
      // Filter lines
      const matchedLines = outputLines.filter(line => {
        const matches = matcherFn(line.content);
        return invertMatch ? !matches : matches;
      });
      
      const output = matchedLines.map(line => line.content).join('\n');
      
      return { 
        output, 
        totalLines,
        matchCount: matchedLines.length,
        hasMatches: matchedLines.length > 0
      };
    }
    
    // No search, return all
    const output = outputLines.map(line => line.content).join('\n');
    return { output, totalLines };
  }

  /**
   * Wait for new output after a specific line
   */
  async waitForOutput(
    session: InteractiveSSHSession,
    afterLine: number, 
    timeout: number = 5000
  ): Promise<{ output: string; error?: string }> {
    const lines = await session.outputBuffer.waitForLines(afterLine, timeout);
    const output = lines.map(line => line.content).join('\n');
    
    return { output };
  }
}
