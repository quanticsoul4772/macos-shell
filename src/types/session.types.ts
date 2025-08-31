/**
 * Session Management Types
 * Strongly typed interfaces for session management
 */

export interface SessionConfig {
  name: string;
  cwd?: string;
  env?: Record<string, string>;
  persistent?: boolean;
  maxHistory?: number;
  maxProcesses?: number;
}

export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  env: Record<string, string>;
  created: Date;
  lastUsed: Date;
  commandCount: number;
  processCount: number;
  status: 'active' | 'idle' | 'terminated';
}

export interface SessionMetrics {
  totalCommands: number;
  successfulCommands: number;
  failedCommands: number;
  averageDuration: number;
  totalDuration: number;
  memoryUsage?: number;
  cpuUsage?: number;
}

export interface ProcessInfo {
  id: string;
  pid: number;
  command: string;
  args: string[];
  status: ProcessStatus;
  startTime: Date;
  endTime?: Date;
  exitCode?: number;
  sessionId: string;
  name?: string;
  resources?: ProcessResourceInfo;
}

export enum ProcessStatus {
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  STOPPED = 'STOPPED',
  FAILED = 'FAILED',
  KILLED = 'KILLED',
  ORPHANED = 'ORPHANED'
}

export interface ProcessResourceInfo {
  cpu: number;
  memory: number;
  memoryPercent: number;
  lastSampled: Date;
  sampleCount: number;
  trend?: 'increasing' | 'stable' | 'decreasing';
}

export interface ProcessOutput {
  processId: string;
  lines: OutputLine[];
  totalLines: number;
  truncated: boolean;
  fromLine?: number;
  toLine?: number;
}

export interface OutputLine {
  lineNumber: number;
  content: string;
  type: 'stdout' | 'stderr';
  timestamp: Date;
}

// Type guards for session types
export function isSessionInfo(value: unknown): value is SessionInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'cwd' in value &&
    'status' in value
  );
}

export function isProcessInfo(value: unknown): value is ProcessInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'pid' in value &&
    'command' in value &&
    'status' in value
  );
}

export function isValidProcessStatus(status: unknown): status is ProcessStatus {
  return Object.values(ProcessStatus).includes(status as ProcessStatus);
}

// Session persistence types
export interface PersistedSession {
  id: string;
  name: string;
  cwd: string;
  env: Record<string, string>;
  created: string; // ISO date string
  lastUsed: string; // ISO date string
  history: PersistedCommand[];
}

export interface PersistedCommand {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout?: string;
  stderr?: string;
  startTime: string; // ISO date string
  duration: number;
}

export interface PersistedProcess {
  id: string;
  sessionId: string;
  command: string;
  args: string[];
  pid: number;
  status: string;
  startTime: string; // ISO date string
  endTime?: string; // ISO date string
  exitCode?: number;
  name?: string;
}