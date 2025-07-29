// Process Management Handlers
// Core process management tool implementations

import { SessionManager } from '../../session-manager.js';
import { ProcessStatus } from '../../background-process.js';
import {
  createErrorResponse,
  createSuccessResponse,
  validateSession,
  validateProcess,
  formatProcessInfo,
  killProcess,
  ToolResponse
} from './process-helpers.js';
import { searchOutputLines, formatOutputLines } from './process-search.js';
import * as fs from "fs/promises";
import * as path from "path";

/**
 * Starts a background process
 */
export async function handleRunBackground(
  params: {
    command: string;
    args: string[];
    session?: string;
    name?: string;
  },
  sessionManager: SessionManager
): Promise<ToolResponse> {
  const { session, error } = await validateSession(sessionManager, params.session);
  if (error) return error;
  
  try {
    const processId = sessionManager.startBackgroundProcess(
      session.id,
      params.command,
      params.args,
      params.name ? { name: params.name } : undefined
    );
    
    if (!processId) {
      return createErrorResponse("Failed to start background process");
    }
    
    const process = sessionManager.getBackgroundProcess(processId);
    return createSuccessResponse(
      `Started background process:\nID: ${processId}\nCommand: ${params.command} ${params.args.join(' ')}\nPID: ${process?.pid || 'pending'}\nStatus: ${process?.status}\nSession: ${session.name}`
    );
  } catch (error: any) {
    return createErrorResponse(`Error starting background process: ${error.message}`);
  }
}

/**
 * Lists background processes with pagination and filtering
 */
export async function handleListProcesses(
  params: {
    session?: string;
    limit: number;
    offset: number;
    includeOrphaned: boolean;
  },
  sessionManager: SessionManager
): Promise<ToolResponse> {
  let processesWithResources = sessionManager.getBackgroundProcessesWithResources();
  
  // Filter out orphaned processes if requested
  if (!params.includeOrphaned) {
    processesWithResources = processesWithResources.filter(
      p => p.status !== ProcessStatus.ORPHANED
    );
  }
  
  // Filter by session if specified
  if (params.session) {
    const { session, error } = await validateSession(sessionManager, params.session);
    if (error) return error;
    
    processesWithResources = processesWithResources.filter(
      p => p.sessionId === session.id
    );
  }
  
  const totalCount = processesWithResources.length;
  
  if (totalCount === 0) {
    const message = params.session
      ? `No background processes in session '${params.session}'`
      : "No background processes running";
    
    return createSuccessResponse(
      JSON.stringify({
        processes: [],
        totalProcesses: 0,
        returnedCount: 0,
        message
      }, null, 2)
    );
  }
  
  // Sort by start time (newest first)
  processesWithResources.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  
  // Apply pagination
  const paginatedProcesses = processesWithResources.slice(
    params.offset,
    params.offset + params.limit
  );
  const hasMore = (params.offset + params.limit) < totalCount;
  
  // Format process information
  const formattedProcesses = await Promise.all(
    paginatedProcesses.map(p => formatProcessInfo(p, sessionManager))
  );
  
  return createSuccessResponse(
    JSON.stringify({
      processes: formattedProcesses,
      totalProcesses: totalCount,
      returnedCount: formattedProcesses.length,
      offset: params.offset,
      limit: params.limit,
      hasMore,
      resourceMonitoring: {
        enabled: true,
        samplingInterval: 5000,
        adaptiveSampling: true
      },
      filters: {
        session: params.session || null,
        includeOrphaned: params.includeOrphaned
      }
    }, null, 2)
  );
}

/**
 * Gets output from a background process with optional search
 */
export async function handleGetProcessOutput(
  params: {
    process_id: string;
    lines: number;
    from_line?: number;
    search?: string;
    search_type: 'text' | 'regex';
    case_sensitive: boolean;
    invert_match: boolean;
    show_context: number;
  },
  sessionManager: SessionManager
): Promise<ToolResponse> {
  const { process, error } = validateProcess(sessionManager, params.process_id);
  if (error) return error;
  if (!process) return createErrorResponse('Process validation failed');
  
  // TypeScript type narrowing - process is definitely not null after this point
  const validProcess = process;
  
  let outputLines = validProcess.outputBuffer.getLines(params.lines, params.from_line);
  const totalLines = validProcess.outputBuffer.getTotalLines();
  const bufferSize = validProcess.outputBuffer.getBufferSize();
  
  // Apply search if provided
  const { filteredLines, searchInfo, actualMatchedLineNumbers } = searchOutputLines(
    outputLines,
    params.search ? {
      search: params.search,
      searchType: params.search_type,
      caseSensitive: params.case_sensitive,
      invertMatch: params.invert_match,
      showContext: params.show_context
    } : undefined
  );
  
  if (searchInfo.startsWith('Invalid regex')) {
    return createErrorResponse(searchInfo);
  }
  
  outputLines = filteredLines;
  
  if (outputLines.length === 0) {
    const message = params.search
      ? `No output ${params.invert_match ? 'NOT ' : ''}matching "${params.search}" found for process '${params.process_id}'${searchInfo}\nTotal lines in buffer: ${totalLines}`
      : `No output available for process '${params.process_id}'\nTotal lines: ${totalLines}\nBuffer size: ${bufferSize}`;
    return createSuccessResponse(message);
  }
  
  // Format output
  const formattedOutput = formatOutputLines(
    outputLines,
    actualMatchedLineNumbers,
    params.show_context,
    !!params.search
  );
  
  const sessionInfo = await sessionManager.getSession(validProcess.sessionId);
  
  let message = `Process output for: ${validProcess.command} ${validProcess.args.join(' ')}\n`;
  message += `Status: ${validProcess.status}\n`;
  message += `Session: ${sessionInfo?.name || validProcess.sessionId}\n`;
  message += `Total lines: ${totalLines} (showing ${outputLines.length})${searchInfo}\n`;
  
  if (totalLines > bufferSize) {
    message += `Note: Output buffer full, showing last ${bufferSize} lines\n`;
  }
  
  if (totalLines > outputLines.length && !params.search) {
    message += `\nTip: Use lines parameter to get more (e.g., lines: ${Math.min(totalLines, 500)}) or from_line to paginate\n`;
  }
  
  message += `\n${formattedOutput}`;
  
  return createSuccessResponse(message);
}

/**
 * Streams output from a background process in real-time
 */
export async function handleStreamProcessOutput(
  params: {
    process_id: string;
    after_line?: number;
    timeout: number;
    max_lines: number;
  },
  sessionManager: SessionManager
): Promise<ToolResponse> {
  const { process, error } = validateProcess(sessionManager, params.process_id);
  if (error) return error;
  if (!process) return createErrorResponse('Process validation failed');
  
  // TypeScript type narrowing
  const validProcess = process;
  
  const afterLine = params.after_line || 0;
  const outputLines = await validProcess.outputBuffer.waitForLines(afterLine, params.timeout);
  
  if (outputLines.length === 0) {
    const totalLines = validProcess.outputBuffer.getTotalLines();
    return createSuccessResponse(
      `No new output for process '${params.process_id}'\nStatus: ${validProcess.status}\nTotal lines: ${totalLines}\nLast checked after line: ${afterLine}\nTip: Process may have finished or no new output within ${params.timeout}ms timeout`
    );
  }
  
  // Limit the number of lines returned
  const limitedLines = outputLines.slice(0, params.max_lines);
  const hasMore = outputLines.length > params.max_lines;
  
  // Format output
  const formattedOutput = formatOutputLines(limitedLines);
  
  const sessionInfo = await sessionManager.getSession(validProcess.sessionId);
  const lastLineNumber = limitedLines[limitedLines.length - 1]?.lineNumber || afterLine;
  
  let message = `Streaming output for: ${validProcess.command} ${validProcess.args.join(' ')}\n`;
  message += `Status: ${validProcess.status}\n`;
  message += `Session: ${sessionInfo?.name || validProcess.sessionId}\n`;
  message += `Lines ${limitedLines[0]?.lineNumber || afterLine + 1} to ${lastLineNumber} (${limitedLines.length} new lines)`;
  
  if (hasMore) {
    message += `\nNote: More lines available, limited to ${params.max_lines}`;
  }
  
  message += `\n\n${formattedOutput}\n\nNext call: use after_line=${lastLineNumber} to continue streaming`;
  
  return createSuccessResponse(message);
}

/**
 * Kills a background process
 */
export async function handleKillProcess(
  params: {
    process_id: string;
    signal: 'SIGTERM' | 'SIGKILL';
  },
  sessionManager: SessionManager
): Promise<ToolResponse> {
  const { process, error } = validateProcess(sessionManager, params.process_id);
  if (error) return error;
  if (!process) return createErrorResponse('Process validation failed');
  
  // TypeScript type narrowing
  const validProcess = process;
  
  if (validProcess.status !== ProcessStatus.RUNNING && validProcess.status !== ProcessStatus.ORPHANED) {
    return createErrorResponse(
      `Process '${params.process_id}' is not running (status: ${validProcess.status})`
    );
  }
  
  const result = killProcess(params.process_id, validProcess, params.signal, sessionManager);
  
  if (!result.success) {
    return createErrorResponse(result.message);
  }
  
  let message = result.message;
  message += `\nCommand: ${validProcess.command} ${validProcess.args.join(' ')}`;
  message += `\nPID: ${validProcess.pid}`;
  
  if (validProcess.status !== ProcessStatus.ORPHANED) {
    message += '\nNote: Process will be removed from list after 5 seconds';
  } else {
    message += '\nNote: Process status updated to KILLED';
  }
  
  return createSuccessResponse(message);
}

/**
 * Saves process output to a file
 */
export async function handleSaveProcessOutput(
  params: {
    process_id: string;
    file_path: string;
    format: 'text' | 'json';
    include_metadata: boolean;
  },
  sessionManager: SessionManager
): Promise<ToolResponse> {
  const { process, error } = validateProcess(sessionManager, params.process_id);
  if (error) return error;
  if (!process) return createErrorResponse('Process validation failed');
  
  // TypeScript type narrowing
  const validProcess = process;
  
  // Get all output lines
  const outputLines = validProcess.outputBuffer.getLines();
  const sessionInfo = await sessionManager.getSession(validProcess.sessionId);
  
  let content: string;
  
  if (params.format === 'json') {
    const data: any = {
      process: {
        id: validProcess.id,
        command: validProcess.command,
        args: validProcess.args,
        status: validProcess.status,
        pid: validProcess.pid,
        session: sessionInfo?.name || validProcess.sessionId,
        startTime: validProcess.startTime.toISOString(),
        endTime: validProcess.endTime?.toISOString() || null,
        exitCode: validProcess.exitCode ?? null
      },
      output: outputLines.map(line => ({
        lineNumber: line.lineNumber,
        type: line.type,
        content: line.content
      }))
    };
    
    content = params.include_metadata
      ? JSON.stringify(data, null, 2)
      : JSON.stringify(data.output, null, 2);
  } else {
    // Text format
    const header = params.include_metadata ? [
      `Process: ${validProcess.command} ${validProcess.args.join(' ')}`,
      `ID: ${validProcess.id}`,
      `PID: ${validProcess.pid || 'N/A'}`,
      `Status: ${validProcess.status}`,
      `Session: ${sessionInfo?.name || validProcess.sessionId}`,
      `Started: ${validProcess.startTime.toISOString()}`,
      validProcess.endTime ? `Ended: ${validProcess.endTime.toISOString()}` : '',
      validProcess.exitCode !== undefined ? `Exit code: ${validProcess.exitCode}` : '',
      '='.repeat(80),
      ''
    ].filter(Boolean).join('\n') : '';
    
    const output = formatOutputLines(outputLines);
    content = header + output;
  }
  
  try {
    // Ensure directory exists
    const dir = path.dirname(params.file_path);
    await fs.mkdir(dir, { recursive: true });
    
    // Write file
    await fs.writeFile(params.file_path, content, 'utf-8');
    
    const stats = await fs.stat(params.file_path);
    
    return createSuccessResponse(
      `Successfully saved output to: ${params.file_path}\nFormat: ${params.format}\nSize: ${stats.size} bytes\nLines: ${outputLines.length}${params.include_metadata ? '\nMetadata: included' : ''}`
    );
  } catch (error: any) {
    return createErrorResponse(`Error saving output: ${error.message}`);
  }
}
