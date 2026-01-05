// Command History Manager Module
// Handles command history for sessions

import {
  CommandHistory,
  ShellSession,
  PERSISTENCE_CONFIG
} from './session-types.js';
import { getLogger } from '../utils/logger.js';
import { getCommandIndexingService } from '../services/command-indexing-service.js';

const logger = getLogger('command-history');

export class CommandHistoryManager {
  private commandIndexing = getCommandIndexingService();

  /**
   * Add a command to session history
   * AUTOMATIC INDEXING: Indexes command with semantic embeddings
   */
  addToHistory(session: ShellSession, history: CommandHistory): void {
    session.history.push(history);

    // Keep only last N commands based on limit
    if (session.history.length > PERSISTENCE_CONFIG.historyLimit) {
      session.history = session.history.slice(-PERSISTENCE_CONFIG.historyLimit);
    }

    // Update last used timestamp
    session.lastUsed = new Date();

    logger.debug({
      module: 'command-history',
      action: 'add-history',
      sessionId: session.id,
      command: history.command,
      exitCode: history.exitCode
    }, `Added command to history: ${history.command}`);

    // AUTOMATIC INDEXING: Index command with embeddings (async, non-blocking)
    this.commandIndexing.indexCommand(session.id, history, session.cwd)
      .catch(error => {
        logger.error('FATAL: Failed to index command', {
          sessionId: session.id,
          command: history.command.substring(0, 50),
          error: error.message,
        });
        // Fail-fast: Rethrow to make indexing failures visible
        throw error;
      });
  }

  /**
   * Get recent history from a session
   */
  getRecentHistory(session: ShellSession, limit: number = 10): CommandHistory[] {
    return session.history.slice(-limit);
  }

  /**
   * Search history for commands matching a pattern
   */
  searchHistory(session: ShellSession, pattern: string | RegExp): CommandHistory[] {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    
    return session.history.filter(h => {
      const fullCommand = `${h.command} ${h.args.join(' ')}`;
      return regex.test(fullCommand);
    });
  }

  /**
   * Get history statistics for a session
   */
  getHistoryStats(session: ShellSession): {
    totalCommands: number;
    successfulCommands: number;
    failedCommands: number;
    averageDuration: number;
    mostUsedCommands: Array<{ command: string; count: number }>;
  } {
    const totalCommands = session.history.length;
    const successfulCommands = session.history.filter(h => h.exitCode === 0).length;
    const failedCommands = session.history.filter(h => h.exitCode !== 0).length;
    
    // Calculate average duration
    const totalDuration = session.history.reduce((sum, h) => sum + h.duration, 0);
    const averageDuration = totalCommands > 0 ? totalDuration / totalCommands : 0;
    
    // Find most used commands
    const commandCounts = new Map<string, number>();
    session.history.forEach(h => {
      const count = commandCounts.get(h.command) || 0;
      commandCounts.set(h.command, count + 1);
    });
    
    const mostUsedCommands = Array.from(commandCounts.entries())
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return {
      totalCommands,
      successfulCommands,
      failedCommands,
      averageDuration,
      mostUsedCommands
    };
  }

  /**
   * Clear history for a session
   */
  clearHistory(session: ShellSession): void {
    const oldCount = session.history.length;
    session.history = [];
    session.lastUsed = new Date();
    
    logger.info({ 
      module: 'command-history', 
      action: 'clear-history', 
      sessionId: session.id,
      oldCount 
    }, `Cleared ${oldCount} commands from history`);
  }

  /**
   * Export history to various formats
   */
  exportHistory(session: ShellSession, format: 'json' | 'text' | 'bash'): string {
    switch (format) {
      case 'json':
        return JSON.stringify(session.history, null, 2);
        
      case 'text':
        return session.history.map(h => {
          const timestamp = h.startTime.toISOString();
          const command = `${h.command} ${h.args.join(' ')}`;
          const status = h.exitCode === 0 ? 'SUCCESS' : `FAILED (${h.exitCode})`;
          const duration = `${h.duration}ms`;
          return `[${timestamp}] ${command} - ${status} - ${duration}`;
        }).join('\n');
        
      case 'bash':
        // Export as bash history format
        return session.history.map(h => {
          const command = `${h.command} ${h.args.join(' ')}`;
          return `# ${h.startTime.toISOString()}\n${command}`;
        }).join('\n');
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Import history from a string
   */
  importHistory(session: ShellSession, data: string, format: 'json' | 'bash'): number {
    let imported = 0;
    
    try {
      if (format === 'json') {
        const historyData = JSON.parse(data);
        if (Array.isArray(historyData)) {
          historyData.forEach(h => {
            this.addToHistory(session, {
              command: h.command,
              args: h.args || [],
              exitCode: h.exitCode ?? null,
              stdout: h.stdout || '',
              stderr: h.stderr || '',
              startTime: new Date(h.startTime),
              duration: h.duration || 0
            });
            imported++;
          });
        }
      } else if (format === 'bash') {
        const lines = data.split('\n');
        let timestamp: Date | null = null;
        
        lines.forEach(line => {
          if (line.startsWith('# ')) {
            // Try to parse timestamp
            const dateStr = line.substring(2).trim();
            try {
              timestamp = new Date(dateStr);
            } catch {
              timestamp = new Date();
            }
          } else if (line.trim() && timestamp) {
            const parts = line.trim().split(' ');
            this.addToHistory(session, {
              command: parts[0],
              args: parts.slice(1),
              exitCode: null,
              stdout: '',
              stderr: '',
              startTime: timestamp,
              duration: 0
            });
            imported++;
          }
        });
      }
      
      logger.info({ 
        module: 'command-history', 
        action: 'import-history', 
        sessionId: session.id,
        format,
        imported 
      }, `Imported ${imported} commands from ${format}`);
      
      return imported;
    } catch (error) {
      logger.error({ 
        module: 'command-history', 
        action: 'import-history', 
        sessionId: session.id,
        format,
        error 
      }, `Failed to import history: ${error}`);
      throw error;
    }
  }
}
