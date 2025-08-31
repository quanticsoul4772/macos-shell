/**
 * Command Execution Types
 * Strongly typed interfaces for command execution and results
 */

import { ExecaError } from 'execa';

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxBuffer?: number;
  shell?: boolean;
  reject?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  duration?: number;
  command?: string;
  error?: string;
  cached?: boolean;
  cacheStrategy?: string;
}

export interface BatchCommand {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  continueOnError?: boolean;
  retryOnFailure?: number;
  retryDelay?: number;
  condition?: CommandCondition;
}

export interface CommandCondition {
  type: 'exitCode' | 'stdout' | 'stderr' | 'success' | 'previousCommand';
  operator: 'equals' | 'notEquals' | 'contains' | 'notContains' | 'matches' | 'greaterThan' | 'lessThan';
  value: string | number | boolean;
  targetCommand?: number;
}

export interface ExecutionError extends Error {
  code?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  command?: string;
  timedOut?: boolean;
}

export interface ScriptExecutionOptions {
  script: string;
  session?: string;
  timeout?: number;
}

export interface ScriptExecutionResult extends CommandResult {
  scriptPath?: string;
  lineCount?: number;
}

// Type guards
export function isExecaError(error: unknown): error is ExecaError {
  return error instanceof Error && 'exitCode' in error;
}

export function isExecutionError(error: unknown): error is ExecutionError {
  return (
    (error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error && 'message' in error)) &&
    ('exitCode' in error || 'code' in error || 'timedOut' in error || 'stderr' in error)
  );
}

export function isCommandResult(value: unknown): value is CommandResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'stdout' in value &&
    'stderr' in value &&
    'exitCode' in value &&
    'success' in value
  );
}

// Utility type for command execution context
export interface ExecutionContext {
  sessionId: string;
  cwd: string;
  env: Record<string, string>;
  startTime: Date;
  attempt?: number;
  maxAttempts?: number;
}

// Enhanced error types for better error handling
export enum CommandErrorCode {
  TIMEOUT = 'TIMEOUT',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  COMMAND_NOT_FOUND = 'COMMAND_NOT_FOUND',
  NETWORK_ERROR = 'NETWORK_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SCRIPT_INJECTION = 'SCRIPT_INJECTION',
  RESOURCE_LIMIT = 'RESOURCE_LIMIT',
  UNKNOWN = 'UNKNOWN'
}

export interface EnhancedError extends ExecutionError {
  errorCode: CommandErrorCode;
  suggestion?: string;
  recoverable?: boolean;
  context?: ExecutionContext;
}