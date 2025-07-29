import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import logger from './utils/logger.js';

interface ResultRecord {
  hash: string;
  timestamp: number;
  stdout: string;
  stderr: string;
}

interface DuplicateEvent {
  command: string;
  cwd: string;
  duplicateCount: number;
  timeSpan: number;
}

export class DuplicateDetector extends EventEmitter {
  private commandHistory: Map<string, ResultRecord[]> = new Map();
  private detectionWindow = 5000; // 5 seconds
  private duplicateThreshold = 2; // 2 identical results trigger detection
  
  /**
   * Check if a command result is a duplicate
   */
  checkDuplicate(command: string, cwd: string, result: {
    stdout: string;
    stderr: string;
    exitCode: number;
  }): boolean {
    const key = `${command}:${cwd}`;
    const resultHash = this.hashResult(result);
    const now = Date.now();
    
    // Get history for this command
    const history = this.commandHistory.get(key) || [];
    
    // Remove old entries outside detection window
    const recentHistory = history.filter(
      record => now - record.timestamp < this.detectionWindow
    );
    
    // Count duplicates in recent history
    const duplicates = recentHistory.filter(
      record => record.hash === resultHash
    );
    
    // Check if we've hit the threshold
    const isDuplicate = duplicates.length >= this.duplicateThreshold - 1;
    
    if (isDuplicate) {
      this.emit('duplicate-detected', {
        command,
        cwd,
        duplicateCount: duplicates.length + 1,
        timeSpan: now - duplicates[0].timestamp
      } as DuplicateEvent);
      
      logger.info({
        module: 'duplicate-detector',
        action: 'duplicate-detected',
        command,
        cwd,
        duplicateCount: duplicates.length + 1
      }, `Duplicate results detected for command: ${command}`);
    }
    
    // Add current result to history
    recentHistory.push({
      hash: resultHash,
      timestamp: now,
      stdout: result.stdout,
      stderr: result.stderr
    });
    
    // Keep only recent history to prevent memory growth
    this.commandHistory.set(key, recentHistory.slice(-10));
    
    return isDuplicate;
  }
  
  /**
   * Create hash of command result
   */
  private hashResult(result: {
    stdout: string;
    stderr: string;
    exitCode: number;
  }): string {
    const content = JSON.stringify({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    });
    
    return createHash('sha256').update(content).digest('hex');
  }
  
  /**
   * Clear history for a specific command
   */
  clearHistory(command?: string, cwd?: string): void {
    if (command) {
      const key = `${command}:${cwd || '*'}`;
      if (cwd) {
        this.commandHistory.delete(key);
      } else {
        // Clear all entries for this command
        for (const [k] of this.commandHistory) {
          if (k.startsWith(`${command}:`)) {
            this.commandHistory.delete(k);
          }
        }
      }
    } else {
      // Clear all history
      this.commandHistory.clear();
    }
  }
  
  /**
   * Get statistics
   */
  getStats(): any {
    const stats = {
      totalTrackedCommands: this.commandHistory.size,
      commandsWithHistory: 0,
      totalHistoryEntries: 0
    };
    
    for (const [_, history] of this.commandHistory) {
      if (history.length > 0) {
        stats.commandsWithHistory++;
        stats.totalHistoryEntries += history.length;
      }
    }
    
    return stats;
  }
}

export const duplicateDetector = new DuplicateDetector();
