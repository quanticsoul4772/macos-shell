// Background Process Manager Module
// Handles starting, monitoring, and killing background processes

import { execa, ExecaError } from 'execa';
import { v4 as uuidv4 } from 'uuid';
import {
  BackgroundProcess,
  ProcessStatus,
  ShellSession,
  RESOURCE_LIMITS,
  AI_BUFFER_SIZE
} from './session-types.js';
import { EnhancedCircularBuffer } from '../utils/enhanced-circular-buffer.js';
import { ResourceMonitor } from '../resource-monitor.js';
import { SessionPersistence } from './session-persistence.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('background-process-manager');

export class BackgroundProcessManager {
  private processes = new Map<string, BackgroundProcess>();
  private resourceMonitor: ResourceMonitor;
  private persistence: SessionPersistence;
  private resourceSamplingTimer?: ReturnType<typeof setInterval>;

  constructor(resourceMonitor: ResourceMonitor, persistence: SessionPersistence) {
    this.resourceMonitor = resourceMonitor;
    this.persistence = persistence;
    this.startBatchResourceSampling();
  }

  /**
   * Start a new background process
   */
  startProcess(
    session: ShellSession,
    command: string,
    args: string[],
    metadata?: { name?: string }
  ): string {
    // Check resource limits
    const sessionProcessCount = this.getSessionProcessCount(session.id);
    if (sessionProcessCount >= RESOURCE_LIMITS.maxProcessesPerSession) {
      throw new Error(`Session has reached maximum process limit (${RESOURCE_LIMITS.maxProcessesPerSession})`);
    }

    if (this.processes.size >= RESOURCE_LIMITS.maxTotalProcesses) {
      throw new Error(`Server has reached maximum process limit (${RESOURCE_LIMITS.maxTotalProcesses})`);
    }

    const processId = uuidv4();
    const backgroundProcess: BackgroundProcess = {
      id: processId,
      sessionId: session.id,
      command,
      args,
      pid: null,
      status: ProcessStatus.STARTING,
      startTime: new Date(),
      outputBuffer: new EnhancedCircularBuffer(AI_BUFFER_SIZE),
      metadata: {
        ...metadata,
        cwd: session.cwd,
        env: { ...session.env }
      }
    };

    this.processes.set(processId, backgroundProcess);
    logger.info({ module: 'background-process-manager', action: 'start-process', processId, command }, `Starting background process: ${command}`);

    // Spawn the actual process
    this.spawnProcess(backgroundProcess, session);

    return processId;
  }

  /**
   * Spawn the actual process
   */
  private spawnProcess(backgroundProcess: BackgroundProcess, session: ShellSession): void {
    try {
      // Special handling for bash -c commands
      let execaOptions: any = {
        cwd: session.cwd,
        env: session.env,
        detached: true,
        cleanup: false,
        buffer: false,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore'
      };

      // Check if this is a bash -c command
      if (backgroundProcess.command === 'bash' && 
          backgroundProcess.args.length >= 2 && 
          backgroundProcess.args[0] === '-c') {
        // For bash -c, don't use shell option to avoid double shell interpretation
        execaOptions.shell = false;
      } else {
        // For other commands, use zsh shell
        execaOptions.shell = '/bin/zsh';
      }

      const childProcess = execa(backgroundProcess.command, backgroundProcess.args, execaOptions);

      // Handle process termination to prevent server crashes
      childProcess.catch((error: any) => {
        if (error.isTerminated && (error.signal === 'SIGTERM' || error.signal === 'SIGKILL')) {
          logger.debug({ module: 'background-process-manager', action: 'process-terminated', processId: backgroundProcess.id, signal: error.signal }, 
            `Process ${backgroundProcess.id} terminated with ${error.signal}`);
        } else {
          logger.error({ module: 'background-process-manager', action: 'process-error', processId: backgroundProcess.id, error }, 
            `Unexpected error in background process ${backgroundProcess.id}`);
        }
      });

      // Store process reference and PID
      backgroundProcess.process = childProcess;
      backgroundProcess.pid = childProcess.pid || null;

      // Start resource monitoring for this process
      if (backgroundProcess.pid) {
        this.resourceMonitor.startMonitoring(backgroundProcess.id, backgroundProcess.pid);
      }

      // Set up output handling
      this.setupOutputHandling(backgroundProcess, childProcess);

      // Update status to running
      this.updateProcess(backgroundProcess.id, { status: ProcessStatus.RUNNING });

    } catch (error: any) {
      // Failed to start process
      logger.error({ module: 'background-process-manager', action: 'spawn-failed', processId: backgroundProcess.id, error }, 
        `Failed to spawn process: ${error.message}`);
      
      this.updateProcess(backgroundProcess.id, {
        status: ProcessStatus.FAILED,
        endTime: new Date()
      });
      
      backgroundProcess.outputBuffer.add({
        timestamp: new Date(),
        type: 'stderr',
        content: `Failed to start process: ${error.message}`,
        lineNumber: 1
      });
    }
  }

  /**
   * Set up output handling for a process
   */
  private setupOutputHandling(backgroundProcess: BackgroundProcess, childProcess: any): void {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let lineNumber = 0;

    // Helper to process lines
    const processLine = (data: string, type: 'stdout' | 'stderr', buffer: string): string => {
      const lines = (buffer + data).split('\n');
      const remaining = lines.pop() || '';

      for (const line of lines) {
        if (line) {
          backgroundProcess.outputBuffer.add({
            timestamp: new Date(),
            type,
            content: line,
            lineNumber: ++lineNumber
          });
        }
      }

      return remaining;
    };

    // Handle stdout
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer = processLine(chunk.toString(), 'stdout', stdoutBuffer);
      });
    }

    // Handle stderr
    if (childProcess.stderr) {
      childProcess.stderr.on('data', (chunk: Buffer) => {
        stderrBuffer = processLine(chunk.toString(), 'stderr', stderrBuffer);
      });
    }

    // Handle process events
    childProcess.on('error', (error: Error) => {
      logger.error({ module: 'background-process-manager', action: 'process-error', processId: backgroundProcess.id, error }, 
        `Process error: ${error.message}`);
      
      this.updateProcess(backgroundProcess.id, {
        status: ProcessStatus.FAILED,
        endTime: new Date()
      });
      
      backgroundProcess.outputBuffer.add({
        timestamp: new Date(),
        type: 'stderr',
        content: `Process error: ${error.message}`,
        lineNumber: ++lineNumber
      });
    });

    childProcess.on('exit', (code: number | null, signal: string | null) => {
      // Flush any remaining partial lines
      if (stdoutBuffer) {
        backgroundProcess.outputBuffer.add({
          timestamp: new Date(),
          type: 'stdout',
          content: stdoutBuffer,
          lineNumber: ++lineNumber
        });
      }
      if (stderrBuffer) {
        backgroundProcess.outputBuffer.add({
          timestamp: new Date(),
          type: 'stderr',
          content: stderrBuffer,
          lineNumber: ++lineNumber
        });
      }

      logger.info({ module: 'background-process-manager', action: 'process-exit', processId: backgroundProcess.id, code, signal }, 
        `Process exited with code ${code}`);

      this.updateProcess(backgroundProcess.id, {
        status: code === 0 ? ProcessStatus.STOPPED : ProcessStatus.FAILED,
        endTime: new Date(),
        exitCode: code
      });

      // Stop resource monitoring for this process
      this.resourceMonitor.stopMonitoring(backgroundProcess.id);
    });
  }

  /**
   * Get a background process by ID
   */
  getProcess(id: string): BackgroundProcess | undefined {
    return this.processes.get(id);
  }

  /**
   * List all background processes, optionally filtered by session
   */
  listProcesses(sessionId?: string): BackgroundProcess[] {
    const processes = Array.from(this.processes.values());
    if (sessionId) {
      return processes.filter(p => p.sessionId === sessionId);
    }
    return processes;
  }

  /**
   * Update a process
   */
  updateProcess(id: string, updates: Partial<BackgroundProcess>): void {
    const process = this.processes.get(id);
    if (process) {
      Object.assign(process, updates);
      // Save process metadata when state changes
      this.persistence.saveProcess(process).catch(err => {
        logger.error({ module: 'background-process-manager', action: 'save-process', processId: id, error: err }, 
          'Failed to save process metadata');
      });
    }
  }

  /**
   * Kill a background process
   */
  killProcess(id: string, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): boolean {
    const process = this.processes.get(id);
    if (!process || !process.process) {
      return false;
    }

    try {
      process.process.kill(signal);
      logger.info({ module: 'background-process-manager', action: 'kill-process', processId: id, signal }, 
        `Killing process with ${signal}`);
      
      this.updateProcess(id, {
        status: ProcessStatus.KILLED,
        endTime: new Date()
      });

      // Remove after a delay to allow output collection
      setTimeout(() => {
        this.processes.delete(id);
        // Delete process file
        this.persistence.deleteProcessFile(id).catch(err => {
          logger.error({ module: 'background-process-manager', action: 'delete-process-file', processId: id, error: err }, 
            'Failed to delete process file');
        });
      }, RESOURCE_LIMITS.processCleanupDelay);

      return true;
    } catch (error) {
      logger.error({ module: 'background-process-manager', action: 'kill-process', processId: id, error }, 
        'Failed to kill process');
      return false;
    }
  }

  /**
   * Get the number of processes for a session
   */
  getSessionProcessCount(sessionId: string): number {
    return Array.from(this.processes.values())
      .filter(p => p.sessionId === sessionId).length;
  }

  /**
   * Kill all processes for a session
   */
  killSessionProcesses(sessionId: string): void {
    for (const [id, process] of this.processes) {
      if (process.sessionId === sessionId) {
        this.killProcess(id);
      }
    }
  }

  /**
   * Load processes from persistence
   */
  async loadProcesses(): Promise<void> {
    const loadedProcesses = await this.persistence.loadProcesses();
    for (const [id, process] of loadedProcesses) {
      this.processes.set(id, process);
    }
  }

  /**
   * Start batch resource sampling
   */
  private startBatchResourceSampling(): void {
    this.resourceSamplingTimer = setInterval(() => {
      this.sampleAllProcessResources();
    }, RESOURCE_LIMITS.resourceSamplingInterval);
  }

  /**
   * Stop batch resource sampling
   */
  stopBatchResourceSampling(): void {
    if (this.resourceSamplingTimer) {
      clearInterval(this.resourceSamplingTimer);
      this.resourceSamplingTimer = undefined;
    }
  }

  /**
   * Sample resources for all running processes
   */
  private async sampleAllProcessResources(): Promise<void> {
    const runningProcesses = Array.from(this.processes.values())
      .filter(p => p.status === ProcessStatus.RUNNING && p.pid);

    if (runningProcesses.length === 0) return;

    // Collect all PIDs for batch sampling
    const pids = runningProcesses
      .map(p => p.pid!)
      .filter(pid => pid !== null);

    // Sample all processes at once
    const samples = await this.resourceMonitor.sampleProcesses(pids);

    // Update each process with its resource data
    for (const process of runningProcesses) {
      if (!process.pid) continue;

      const sample = samples.get(process.pid);
      if (sample) {
        const resources = this.resourceMonitor.updateResources(process.id, sample);
        process.resources = resources;
      }
    }
  }

  /**
   * Get processes with resource information
   */
  getProcessesWithResources(): Array<BackgroundProcess & {
    resourcesSampled: boolean;
    samplingInterval?: number;
  }> {
    return Array.from(this.processes.values()).map(process => {
      const resources = process.resources || this.resourceMonitor.getResources(process.id);

      return {
        ...process,
        resources,
        resourcesSampled: !!resources,
        samplingInterval: resources ? RESOURCE_LIMITS.resourceSamplingInterval : undefined
      };
    });
  }

  /**
   * Cleanup all processes
   */
  async cleanup(): Promise<void> {
    // Stop resource monitoring
    this.stopBatchResourceSampling();
    this.resourceMonitor.stopAll();

    // Kill all background processes
    for (const [id, process] of this.processes) {
      if (process.process && process.status === ProcessStatus.RUNNING) {
        try {
          process.process.kill('SIGTERM');
        } catch (error) {
          logger.error({ module: 'background-process-manager', action: 'cleanup', processId: id, error }, 
            `Failed to kill process ${id}`);
        }
      }
    }
  }
}
