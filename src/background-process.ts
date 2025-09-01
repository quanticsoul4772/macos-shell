import { ProcessResources } from './resource-monitor.js';

// CircularBuffer implementation for output capture
export class CircularBuffer {
  private buffer: OutputLine[] = [];
  private maxLines: number;
  private totalLines: number = 0;
  private nextIndex: number = 0;
  protected waiters: Array<{
    resolve: (lines: OutputLine[]) => void;
    minLine: number;
    timeout: NodeJS.Timeout;
  }> = [];

  constructor(maxLines: number = 10000) {
    this.maxLines = maxLines;
  }

  add(line: OutputLine): void {
    if (this.buffer.length < this.maxLines) {
      // Buffer not full yet, just append
      this.buffer.push(line);
    } else {
      // Buffer is full, overwrite oldest
      this.buffer[this.nextIndex] = line;
      this.nextIndex = (this.nextIndex + 1) % this.maxLines;
    }
    this.totalLines++;
    
    // Notify any waiters
    this.notifyWaiters();
  }

  protected notifyWaiters(): void {
    const toNotify = this.waiters.filter(w => this.totalLines > w.minLine);
    toNotify.forEach(waiter => {
      clearTimeout(waiter.timeout);
      const lines = this.getLines(undefined, waiter.minLine);
      waiter.resolve(lines);
    });
    this.waiters = this.waiters.filter(w => !toNotify.includes(w));
  }

  async waitForLines(afterLine: number, timeout: number = 30000): Promise<OutputLine[]> {
    // If lines already available, return immediately
    if (this.totalLines > afterLine) {
      return this.getLines(undefined, afterLine);
    }

    // Otherwise, wait for new lines
    return new Promise<OutputLine[]>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        // Remove from waiters
        this.waiters = this.waiters.filter(w => w.resolve !== resolve);
        // Return empty array on timeout
        resolve([]);
      }, timeout);

      this.waiters.push({
        resolve,
        minLine: afterLine,
        timeout: timeoutHandle
      });
    });
  }

  getLines(count?: number, fromLine?: number): OutputLine[] {
    // If fromLine is specified, calculate the actual number of lines available from that point
    let lines: number;
    let start: number;
    
    if (fromLine !== undefined) {
      // When fromLine is specified, return lines starting from that position
      start = fromLine;
      // If count is not specified, return all remaining lines from fromLine
      lines = count ?? Math.max(0, this.totalLines - fromLine);
    } else {
      // When fromLine is not specified, return the last 'count' lines
      lines = count ?? this.buffer.length;
      start = Math.max(0, this.totalLines - lines);
    }
    
    // If requesting lines that have been overwritten
    if (start < this.totalLines - this.buffer.length) {
      return [];
    }
    
    // Calculate position in circular buffer
    const bufferStart = (this.nextIndex + (start - (this.totalLines - this.buffer.length))) % this.buffer.length;
    const result: OutputLine[] = [];
    
    for (let i = 0; i < lines && i < this.buffer.length; i++) {
      const idx = (bufferStart + i) % this.buffer.length;
      if (this.buffer[idx]) {
        result.push(this.buffer[idx]);
      }
    }
    
    return result;
  }

  clear(): void {
    this.buffer = [];
    this.totalLines = 0;
    this.nextIndex = 0;
  }

  getTotalLines(): number {
    return this.totalLines;
  }

  getBufferSize(): number {
    return this.buffer.length;
  }
}

// Types for background process management
export interface OutputLine {
  timestamp: Date;
  type: 'stdout' | 'stderr';
  content: string;
  lineNumber: number;
}

export enum ProcessStatus {
  STARTING = "starting",
  RUNNING = "running",
  STOPPED = "stopped",
  FAILED = "failed",
  KILLED = "killed",
  ORPHANED = "orphaned"
}

export interface BackgroundProcess {
  id: string;
  sessionId: string;
  command: string;
  args: string[];
  pid: number | null;
  status: ProcessStatus;
  startTime: Date;
  endTime?: Date;
  exitCode?: number | null;
  outputBuffer: CircularBuffer;
  metadata: {
    cwd: string;
    env: Record<string, string>;
  };
  process?: any; // ChildProcess instance
  resources?: ProcessResources; // Resource monitoring data
}