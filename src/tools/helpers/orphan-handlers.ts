// Orphan Process Handlers
// Handles orphan process cleanup and management

import { SessionManager } from '../../session-manager.js';
import { ProcessStatus } from '../../background-process.js';
import { PatternMatcher, PatternType, MatchOptions } from '../../pattern-matcher.js';
import {
  createSuccessResponse,
  formatRuntime,
  ToolResponse
} from './process-helpers.js';

/**
 * Handles cleanup of orphaned processes
 */
export async function handleCleanupOrphans(
  params: {
    mode: 'list' | 'kill' | 'interactive';
    force: boolean;
  },
  sessionManager: SessionManager
): Promise<ToolResponse> {
  // Find all orphaned processes
  const orphanedProcesses = sessionManager.listBackgroundProcesses()
    .filter(p => p.status === ProcessStatus.ORPHANED);
  
  if (orphanedProcesses.length === 0) {
    return createSuccessResponse("No orphaned processes found");
  }
  
  // Format orphan information
  const orphanInfo = await Promise.all(orphanedProcesses.map(async p => {
    const sessionInfo = await sessionManager.getSession(p.sessionId);
    const runtime = formatRuntime(p);
    
    return {
      process: p,
      info: `PID: ${p.pid} | Command: ${p.command} ${p.args.join(' ')} | Session: ${sessionInfo?.name || p.sessionId} | Running for: ${runtime}s`
    };
  }));
  
  switch (params.mode) {
    case 'list':
      return createSuccessResponse(
        `Found ${orphanedProcesses.length} orphaned process(es):\n\n${orphanInfo.map(o => o.info).join('\n')}`
      );
    
    case 'kill':
      return killOrphanedProcesses(orphanedProcesses, orphanInfo, params.force, sessionManager);
    
    case 'interactive':
    default:
      return showInteractiveOrphanInfo(orphanedProcesses, orphanInfo);
  }
}

/**
 * Kills orphaned processes
 */
function killOrphanedProcesses(
  orphanedProcesses: any[],
  orphanInfo: any[],
  force: boolean,
  sessionManager: SessionManager
): ToolResponse {
  let killedCount = 0;
  const failedKills: string[] = [];
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  
  for (const orphan of orphanedProcesses) {
    if (orphan.pid) {
      try {
        global.process.kill(orphan.pid, signal);
        killedCount++;
        // Update status in our tracking
        sessionManager.updateBackgroundProcess(orphan.id, {
          status: ProcessStatus.KILLED,
          endTime: new Date()
        });
      } catch (error: any) {
        failedKills.push(`${orphan.command} (PID: ${orphan.pid}): ${error.message}`);
      }
    }
  }
  
  const resultText = [`Killed ${killedCount} orphaned process(es) with ${signal}`];
  if (failedKills.length > 0) {
    resultText.push(`\nFailed to kill ${failedKills.length} process(es):`);
    resultText.push(...failedKills);
  }
  
  return createSuccessResponse(resultText.join('\n'));
}

/**
 * Shows interactive orphan information with suggestions
 */
function showInteractiveOrphanInfo(
  orphanedProcesses: any[],
  orphanInfo: any[]
): ToolResponse {
  const suggestions = [
    `Found ${orphanedProcesses.length} orphaned process(es) from previous server session:`,
    '',
    ...orphanInfo.map(o => o.info),
    '',
    'These processes are still running but cannot be managed by the current server session.',
    '',
    'Suggested actions:',
    '1. Kill all orphans: cleanup_orphans(mode: "kill")',
    '2. Force kill all orphans: cleanup_orphans(mode: "kill", force: true)',
    '3. Kill specific process: kill_process(process_id: "<id>") for each process listed',
    '4. Check if they should be running: Use Activity Monitor or ps aux | grep <command>',
    '',
    'Note: kill_process tool now works on orphaned processes too.'
  ];
  
  return createSuccessResponse(suggestions.join('\n'));
}

/**
 * Kills all processes matching a pattern
 */
export async function handleKillAllMatching(
  params: {
    pattern: string;
    pattern_type: 'text' | 'regex';
    signal: 'SIGTERM' | 'SIGKILL';
    dry_run: boolean;
  },
  sessionManager: SessionManager
): Promise<ToolResponse> {
  const matcher = new PatternMatcher(PatternType.TEXT);
  const processes = sessionManager.listBackgroundProcesses()
    .filter(p => p.status === ProcessStatus.RUNNING || p.status === ProcessStatus.ORPHANED);
  
  if (processes.length === 0) {
    return createSuccessResponse("No running processes to match against");
  }
  
  // Find matching processes
  const matchingProcesses = processes.filter(p => {
    const commandLine = `${p.command} ${p.args.join(' ')}`;
    const options: MatchOptions = { caseSensitive: true };
    const result = matcher.match(commandLine, params.pattern, options);
    return result !== null;
  });
  
  if (matchingProcesses.length === 0) {
    return createSuccessResponse(`No processes found matching pattern: "${params.pattern}"`);
  }
  
  // Format matching processes info
  const processInfo = await Promise.all(matchingProcesses.map(async p => {
    const sessionInfo = await sessionManager.getSession(p.sessionId);
    return `ID: ${p.id} | PID: ${p.pid} | ${p.command} ${p.args.join(' ')} | Session: ${sessionInfo?.name || p.sessionId}`;
  }));
  
  if (params.dry_run) {
    return createSuccessResponse(
      `DRY RUN - Would kill ${matchingProcesses.length} process(es) with ${params.signal}:\n\n${processInfo.join('\n')}\n\nTo actually kill these processes, run again with dry_run=false`
    );
  }
  
  // Kill matching processes
  let killedCount = 0;
  const failedKills: string[] = [];
  
  for (const proc of matchingProcesses) {
    try {
      if (proc.status === ProcessStatus.ORPHANED && proc.pid) {
        // Orphaned process - use system kill
        global.process.kill(proc.pid, params.signal);
        sessionManager.updateBackgroundProcess(proc.id, {
          status: ProcessStatus.KILLED,
          endTime: new Date()
        });
        killedCount++;
      } else {
        // Normal process
        const killed = sessionManager.killBackgroundProcess(proc.id, params.signal);
        if (killed) {
          killedCount++;
        } else {
          failedKills.push(`${proc.command} (ID: ${proc.id})`);
        }
      }
    } catch (error: any) {
      failedKills.push(`${proc.command} (ID: ${proc.id}): ${error.message}`);
    }
  }
  
  const resultText = [`Killed ${killedCount} process(es) matching "${params.pattern}" with ${params.signal}`];
  if (failedKills.length > 0) {
    resultText.push(`\nFailed to kill ${failedKills.length} process(es):`);
    resultText.push(...failedKills);
  }
  
  return createSuccessResponse(resultText.join('\n'));
}
