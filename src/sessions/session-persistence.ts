// Session Persistence Module
// Handles saving and loading sessions and processes to/from disk

import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { 
  ShellSession, 
  SessionPersistenceData,
  ProcessPersistenceData,
  PERSISTENCE_CONFIG,
  BackgroundProcess,
  ProcessStatus,
  AI_BUFFER_SIZE
} from './session-types.js';
import { EnhancedCircularBuffer } from '../utils/enhanced-circular-buffer.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('session-persistence');

export class SessionPersistence {
  private readonly persistenceDir: string;
  private readonly sessionsDir: string;
  private readonly processesDir: string;
  private initialized = false;

  constructor() {
    const homeDir = os.homedir();
    this.persistenceDir = path.join(homeDir, PERSISTENCE_CONFIG.baseDir);
    this.sessionsDir = path.join(this.persistenceDir, PERSISTENCE_CONFIG.sessionSubdir);
    this.processesDir = path.join(this.persistenceDir, PERSISTENCE_CONFIG.processSubdir);
  }

  /**
   * Initialize persistence directories
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.persistenceDir, { recursive: true });
      await fs.mkdir(this.sessionsDir, { recursive: true });
      await fs.mkdir(this.processesDir, { recursive: true });
      this.initialized = true;
      logger.debug('Persistence directories initialized', undefined, { module: 'session-persistence', action: 'initialize' });
    } catch (error) {
      logger.error({ module: 'session-persistence', action: 'initialize', error }, 'Failed to create persistence directories');
      throw error;
    }
  }

  /**
   * Save a session to disk
   */
  async saveSession(session: ShellSession): Promise<void> {
    await this.initialize();

    try {
      const data: SessionPersistenceData = {
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        env: session.env,
        history: session.history.slice(-PERSISTENCE_CONFIG.maxSavedHistory).map(h => ({
          ...h,
          startTime: h.startTime.toISOString()
        })),
        created: session.created.toISOString(),
        lastUsed: session.lastUsed.toISOString()
      };

      const filePath = path.join(this.sessionsDir, `${session.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      logger.debug({ module: 'session-persistence', action: 'save-session', sessionId: session.id }, `Saved session: ${session.name}`);
    } catch (error) {
      logger.error({ module: 'session-persistence', action: 'save-session', sessionId: session.id, error }, `Failed to save session ${session.id}`);
      throw error;
    }
  }

  /**
   * Load all sessions from disk
   */
  async loadSessions(): Promise<ShellSession[]> {
    await this.initialize();
    const sessions: ShellSession[] = [];

    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessionFiles = files.filter(f => f.endsWith('.json'));

      for (const file of sessionFiles) {
        try {
          const session = await this.loadSession(file);
          if (session) {
            sessions.push(session);
          }
        } catch (error) {
          logger.error({ module: 'session-persistence', action: 'load-session', file, error }, `Failed to load session ${file}`);
          // Continue loading other sessions
        }
      }

      logger.info({ module: 'session-persistence', action: 'load-sessions', count: sessions.length }, `Loaded ${sessions.length} sessions`);
      return sessions;
    } catch (error) {
      logger.error({ module: 'session-persistence', action: 'load-sessions', error }, 'Failed to load sessions');
      return [];
    }
  }

  /**
   * Load a single session from disk
   */
  private async loadSession(filename: string): Promise<ShellSession | null> {
    const filePath = path.join(this.sessionsDir, filename);
    const sessionId = filename.replace('.json', '');

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      
      // Skip empty files
      if (!data || data.trim() === '') {
        logger.warn({ module: 'session-persistence', action: 'load-session', sessionId }, 'Skipping empty session file');
        await this.deleteSessionFile(sessionId);
        return null;
      }

      let saved: SessionPersistenceData;
      try {
        saved = JSON.parse(data);
      } catch (parseError) {
        logger.error({ module: 'session-persistence', action: 'parse-session', sessionId, error: parseError }, 'Failed to parse session file');
        await this.deleteSessionFile(sessionId);
        return null;
      }

      // Verify working directory exists
      let cwd = saved.cwd;
      try {
        await fs.stat(cwd);
      } catch {
        // Directory doesn't exist, use home directory
        cwd = os.homedir();
        logger.warn({ module: 'session-persistence', action: 'verify-cwd', sessionId, originalCwd: saved.cwd }, 'Session directory not found, using home directory');
      }

      // Reconstruct session
      const session: ShellSession = {
        id: saved.id,
        name: saved.name,
        cwd,
        env: saved.env,
        history: saved.history.map(h => ({
          ...h,
          startTime: new Date(h.startTime)
        })),
        created: new Date(saved.created),
        lastUsed: new Date(saved.lastUsed)
      };

      return session;
    } catch (error) {
      logger.error({ module: 'session-persistence', action: 'load-session', sessionId, error }, 'Failed to load session file');
      return null;
    }
  }

  /**
   * Delete a session file
   */
  async deleteSessionFile(sessionId: string): Promise<void> {
    try {
      const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
      await fs.unlink(filePath);
      logger.debug({ module: 'session-persistence', action: 'delete-session', sessionId }, 'Deleted session file');
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as any).code !== 'ENOENT') {
        logger.error({ module: 'session-persistence', action: 'delete-session', sessionId, error }, 'Failed to delete session file');
      }
    }
  }

  /**
   * Save process metadata to disk
   */
  async saveProcess(process: BackgroundProcess): Promise<void> {
    await this.initialize();

    try {
      const outputHistory = process.outputBuffer.getLines(1000); // Save last 1000 lines

      const data: ProcessPersistenceData = {
        id: process.id,
        sessionId: process.sessionId,
        command: process.command,
        args: process.args,
        pid: process.pid,
        status: process.status,
        startTime: process.startTime.toISOString(),
        endTime: process.endTime?.toISOString(),
        exitCode: process.exitCode,
        metadata: process.metadata,
        outputHistory: outputHistory.map(line => ({
          ...line,
          timestamp: line.timestamp.toISOString()
        }))
      };

      const filePath = path.join(this.processesDir, `${process.id}.json`);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      logger.debug({ module: 'session-persistence', action: 'save-process', processId: process.id }, `Saved process: ${process.command}`);
    } catch (error) {
      logger.error({ module: 'session-persistence', action: 'save-process', processId: process.id, error }, `Failed to save process ${process.id}`);
    }
  }

  /**
   * Load all process metadata from disk
   */
  async loadProcesses(): Promise<Map<string, BackgroundProcess>> {
    await this.initialize();
    const processes = new Map<string, BackgroundProcess>();

    try {
      const files = await fs.readdir(this.processesDir);
      const processFiles = files.filter(f => f.endsWith('.json'));

      for (const file of processFiles) {
        try {
          const process = await this.loadProcess(file);
          if (process) {
            processes.set(process.id, process);
          }
        } catch (error) {
          logger.error({ module: 'session-persistence', action: 'load-process', file, error }, `Failed to load process ${file}`);
          // Continue loading other processes
        }
      }

      logger.info({ module: 'session-persistence', action: 'load-processes', count: processes.size }, `Loaded ${processes.size} processes`);
      return processes;
    } catch (error) {
      logger.error({ module: 'session-persistence', action: 'load-processes', error }, 'Failed to load processes');
      return new Map();
    }
  }

  /**
   * Load a single process from disk
   */
  private async loadProcess(filename: string): Promise<BackgroundProcess | null> {
    const filePath = path.join(this.processesDir, filename);
    const processId = filename.replace('.json', '');

    try {
      const data = await fs.readFile(filePath, 'utf-8');
      
      // Skip empty files
      if (!data || data.trim() === '') {
        logger.warn({ module: 'session-persistence', action: 'load-process', processId }, 'Skipping empty process file');
        await this.deleteProcessFile(processId);
        return null;
      }

      let saved: ProcessPersistenceData;
      try {
        saved = JSON.parse(data);
      } catch (parseError) {
        logger.error({ module: 'session-persistence', action: 'parse-process', processId, error: parseError }, 'Failed to parse process file');
        await this.deleteProcessFile(processId);
        return null;
      }

      // Check if process is orphaned (still running)
      let status = saved.status as ProcessStatus;
      let endTime: Date | undefined = saved.endTime ? new Date(saved.endTime) : undefined;
      let exitCode: number | null | undefined = saved.exitCode;

      if (saved.pid && saved.status === ProcessStatus.RUNNING) {
        try {
          // Signal 0 checks if process is alive without affecting it
          global.process.kill(saved.pid, 0);
          status = ProcessStatus.ORPHANED;
          endTime = undefined;
          exitCode = undefined;
          logger.warn({ module: 'session-persistence', action: 'detect-orphan', processId, pid: saved.pid }, `Detected orphaned process: ${saved.command}`);
        } catch {
          // Process is not running, it's truly failed
          status = ProcessStatus.FAILED;
          endTime = new Date();
        }
      }

      // Reconstruct process
      const process: BackgroundProcess = {
        id: saved.id,
        sessionId: saved.sessionId,
        command: saved.command,
        args: saved.args,
        pid: saved.pid,
        status,
        startTime: new Date(saved.startTime),
        endTime,
        exitCode,
        outputBuffer: new EnhancedCircularBuffer(AI_BUFFER_SIZE),
        metadata: saved.metadata
      };

      // Restore output history if available
      if (saved.outputHistory) {
        for (const line of saved.outputHistory) {
          process.outputBuffer.add({
            ...line,
            timestamp: new Date(line.timestamp)
          });
        }
      }

      return process;
    } catch (error) {
      logger.error({ module: 'session-persistence', action: 'load-process', processId, error }, 'Failed to load process file');
      return null;
    }
  }

  /**
   * Delete a process file
   */
  async deleteProcessFile(processId: string): Promise<void> {
    try {
      const filePath = path.join(this.processesDir, `${processId}.json`);
      await fs.unlink(filePath);
      logger.debug({ module: 'session-persistence', action: 'delete-process', processId }, 'Deleted process file');
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as any).code !== 'ENOENT') {
        logger.error({ module: 'session-persistence', action: 'delete-process', processId, error }, 'Failed to delete process file');
      }
    }
  }
}
