// Process Tools Helper Functions
// Common utilities for process management tools

import { SessionManager } from '../../session-manager.js';
import { BackgroundProcess, ProcessStatus } from '../../background-process.js';

export interface ErrorResponse {
  [x: string]: unknown;
  content: Array<{ [x: string]: unknown; type: "text"; text: string }>;
  isError: true;
}

export interface SuccessResponse {
  [x: string]: unknown;
  content: Array<{ [x: string]: unknown; type: "text"; text: string }>;
  isError?: false;
}

export type ToolResponse = ErrorResponse | SuccessResponse;

/**
 * Creates a standardized error response
 */
export function createErrorResponse(message: string): ErrorResponse {
  return {
    content: [{ type: "text", text: message }],
    isError: true
  };
}

/**
 * Creates a standardized success response
 */
export function createSuccessResponse(text: string): SuccessResponse {
  return {
    content: [{ type: "text", text }]
  };
}

/**
 * Validates and retrieves a session, returning error response if not found
 */
export async function validateSession(
  sessionManager: SessionManager,
  sessionName?: string
): Promise<{ session: any; error?: ErrorResponse }> {
  const session = await sessionManager.getSession(sessionName);
  
  if (!session) {
    return {
      session: null,
      error: createErrorResponse(`Session '${sessionName}' not found`)
    };
  }
  
  return { session };
}

/**
 * Validates and retrieves a background process
 */
export function validateProcess(
  sessionManager: SessionManager,
  processId: string
): { process: BackgroundProcess | null; error?: ErrorResponse } {
  const process = sessionManager.getBackgroundProcess(processId);
  
  if (!process) {
    return {
      process: null,
      error: createErrorResponse(`Process '${processId}' not found`)
    };
  }
  
  return { process };
}

/**
 * Formats process runtime
 */
export function formatRuntime(process: BackgroundProcess): number {
  const endTime = process.endTime || new Date();
  return parseFloat(((endTime.getTime() - process.startTime.getTime()) / 1000).toFixed(1));
}

/**
 * Formats a single process for display
 */
export async function formatProcessInfo(
  process: BackgroundProcess,
  sessionManager: SessionManager
): Promise<any> {
  const runtime = formatRuntime(process);
  const sessionInfo = await sessionManager.getSession(process.sessionId);
  
  const processData: any = {
    id: process.id,
    command: process.command,
    args: process.args,
    status: process.status,
    pid: process.pid || null,
    runtime,
    session: sessionInfo?.name || process.sessionId,
    startTime: process.startTime.toISOString(),
    exitCode: process.exitCode !== undefined ? process.exitCode : null
  };
  
  // Add resource data if available
  if (process.resources) {
    processData.resources = {
      cpu: process.resources.cpu,
      memory: process.resources.memory,
      memoryPercent: process.resources.memoryPercent,
      lastSampled: process.resources.lastSampled.toISOString(),
      sampleCount: process.resources.sampleCount,
      samplingInterval: 5000 // Default sampling interval
    };
  }
  
  // Add warning for orphaned processes
  if (process.status === ProcessStatus.ORPHANED) {
    processData.warning = "Process from previous server session";
  }
  
  return processData;
}

/**
 * Kills a process with proper error handling
 */
export function killProcess(
  processId: string,
  process: BackgroundProcess,
  signal: 'SIGTERM' | 'SIGKILL',
  sessionManager: SessionManager
): { success: boolean; message: string } {
  // Handle orphaned processes
  if (process.status === ProcessStatus.ORPHANED && process.pid) {
    try {
      global.process.kill(process.pid, signal);
      sessionManager.updateBackgroundProcess(processId, {
        status: ProcessStatus.KILLED,
        endTime: new Date()
      });
      return {
        success: true,
        message: `Successfully sent ${signal} to orphaned process '${processId}'`
      };
    } catch (error: any) {
      return {
        success: false,
        message: `Failed to kill orphaned process '${processId}': ${error.message}`
      };
    }
  }
  
  // Normal process killing
  const killed = sessionManager.killBackgroundProcess(processId, signal);
  
  if (killed) {
    return {
      success: true,
      message: `Successfully sent ${signal} to process '${processId}'`
    };
  }
  
  return {
    success: false,
    message: `Failed to kill process '${processId}'`
  };
}
