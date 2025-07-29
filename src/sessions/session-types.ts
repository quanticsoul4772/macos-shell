// Session Types and Constants
// Core types used across session management modules

import { BackgroundProcess } from '../background-process.js';

// Persistence configuration
export const PERSISTENCE_CONFIG = {
  baseDir: '.macos-shell',
  sessionSubdir: 'sessions',
  processSubdir: 'processes',
  historyLimit: 1000,
  maxSavedHistory: 100,
  debounceDelay: 5000,
  processCleanupDelay: 5000
} as const;

// Resource limits
export const RESOURCE_LIMITS = {
  maxProcessesPerSession: 50,
  maxTotalProcesses: 200,
  resourceSamplingInterval: 5000,
  processCleanupDelay: 5000
} as const;

// AI-optimized buffer size
// 300 lines is sufficient for AI usage patterns:
// - Immediate command responses (30-50 lines)
// - Error searching (up to 100 lines)
// - Context preservation without overflow risk
export const AI_BUFFER_SIZE = 300;

// Core session interface
export interface ShellSession {
  id: string;
  name: string;
  cwd: string;
  env: Record<string, string>;
  history: CommandHistory[];
  created: Date;
  lastUsed: Date;
}

// Command history interface
export interface CommandHistory {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startTime: Date;
  duration: number;
}

// Session persistence interface
export interface SessionPersistenceData {
  id: string;
  name: string;
  cwd: string;
  env: Record<string, string>;
  history: Array<{
    command: string;
    args: string[];
    exitCode: number | null;
    stdout: string;
    stderr: string;
    startTime: string;
    duration: number;
  }>;
  created: string;
  lastUsed: string;
}

// Process persistence interface
export interface ProcessPersistenceData {
  id: string;
  sessionId: string;
  command: string;
  args: string[];
  pid: number | null;
  status: string;
  startTime: string;
  endTime?: string;
  exitCode?: number | null;
  metadata?: any;
  outputHistory?: Array<{
    timestamp: string;
    type: 'stdout' | 'stderr';
    content: string;
    lineNumber: number;
  }>;
}

// Session operations result types
export interface SessionOperationResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

export interface SessionListResult {
  sessions: ShellSession[];
  defaultSessionId: string;
}

// Export BackgroundProcess for convenience
export { BackgroundProcess, ProcessStatus } from '../background-process.js';
