// Refactored Session Manager Module
// Orchestrates session operations using modular components

import { v4 as uuidv4 } from 'uuid';
import * as os from 'os';
import * as path from 'path';
import {
  ShellSession,
  CommandHistory,
  BackgroundProcess,
  PERSISTENCE_CONFIG
} from './sessions/session-types.js';
import { SessionPersistence } from './sessions/session-persistence.js';
import { BackgroundProcessManager } from './sessions/background-process-manager.js';
import { CommandHistoryManager } from './sessions/command-history-manager.js';
import { ResourceMonitor } from './resource-monitor.js';
import { Debouncer } from './utils/debouncer.js';
import { getLogger } from './utils/logger.js';

const logger = getLogger('session-manager');

export { ShellSession, CommandHistory, BackgroundProcess, ProcessStatus } from './sessions/session-types.js';

// Export persistence paths for backward compatibility
export const PERSISTENCE_DIR = path.join(os.homedir(), PERSISTENCE_CONFIG.baseDir);
export const SESSIONS_DIR = path.join(PERSISTENCE_DIR, PERSISTENCE_CONFIG.sessionSubdir);
export const PROCESSES_DIR = path.join(PERSISTENCE_DIR, PERSISTENCE_CONFIG.processSubdir);

export class SessionManager {
  private sessions = new Map<string, ShellSession>();
  private defaultSessionId = '';
  private initialized = false;
  private initializationPromise: Promise<void>;
  
  // Modular components
  private persistence: SessionPersistence;
  private processManager: BackgroundProcessManager;
  private historyManager: CommandHistoryManager;
  private resourceMonitor: ResourceMonitor;
  private saveDebouncer: Debouncer<ShellSession>;

  constructor() {
    // Initialize components
    this.persistence = new SessionPersistence();
    this.resourceMonitor = new ResourceMonitor();
    this.processManager = new BackgroundProcessManager(this.resourceMonitor, this.persistence);
    this.historyManager = new CommandHistoryManager();
    
    // Initialize debouncer for session saves
    this.saveDebouncer = new Debouncer(
      PERSISTENCE_CONFIG.debounceDelay,
      async (sessionId) => {
        const session = this.sessions.get(sessionId);
        if (session) {
          await this.persistence.saveSession(session);
        }
      }
    );
    
    // Initialize persistence and load data
    this.initializationPromise = this.initialize();
  }

  /**
   * Initialize the session manager
   */
  private async initialize(): Promise<void> {
    try {
      // Initialize persistence
      await this.persistence.initialize();
      
      // Load existing sessions
      const loadedSessions = await this.persistence.loadSessions();
      for (const session of loadedSessions) {
        this.sessions.set(session.id, session);
        logger.info({ module: 'session-manager', action: 'load-session', sessionId: session.id }, 
          `Loaded session: ${session.name}`);
      }
      
      // Load processes
      await this.processManager.loadProcesses();
      
      // Ensure default session exists
      const hasDefault = Array.from(this.sessions.values()).some(s => s.name === 'default');
      if (!hasDefault) {
        this.defaultSessionId = this.createSession("default", process.cwd());
      } else {
        // Find the default session ID
        const defaultSession = Array.from(this.sessions.entries()).find(([_, s]) => s.name === 'default');
        if (defaultSession) {
          this.defaultSessionId = defaultSession[0];
        }
      }
      
      this.initialized = true;
      logger.info({ module: 'session-manager', action: 'initialize', sessionCount: this.sessions.size }, 
        'Session manager initialized');
    } catch (error) {
      logger.error({ module: 'session-manager', action: 'initialize', error }, 
        'Failed to initialize session manager');
      // Create default session on error
      this.defaultSessionId = this.createSession("default", process.cwd());
      this.initialized = true;
    }
  }

  /**
   * Ensure the session manager is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initializationPromise;
    }
  }

  /**
   * Create a new session
   */
  createSession(name: string, cwd?: string): string {
    const id = uuidv4();
    const session: ShellSession = {
      id,
      name,
      cwd: cwd || process.cwd(),
      env: Object.fromEntries(
        Object.entries(process.env).filter(([_, v]) => v !== undefined)
      ) as Record<string, string>,
      history: [],
      created: new Date(),
      lastUsed: new Date()
    };
    
    this.sessions.set(id, session);
    
    // Schedule debounced save
    this.saveDebouncer.schedule(id, session);
    
    logger.info({ module: 'session-manager', action: 'create-session', sessionId: id, name }, 
      `Created session: ${name}`);
    
    return id;
  }

  /**
   * Get a session by name or ID
   */
  async getSession(nameOrId?: string): Promise<ShellSession | undefined> {
    await this.ensureInitialized();
    
    if (!nameOrId) {
      return this.sessions.get(this.defaultSessionId);
    }
    
    // Try to find by ID first
    let session = this.sessions.get(nameOrId);
    if (session) return session;
    
    // Try to find by name
    for (const [_, s] of this.sessions) {
      if (s.name === nameOrId) {
        return s;
      }
    }
    
    return undefined;
  }

  /**
   * Update a session
   */
  updateSession(id: string, updates: Partial<ShellSession>): void {
    const session = this.sessions.get(id);
    if (session) {
      Object.assign(session, updates, { lastUsed: new Date() });
      // Use debounced save
      this.saveDebouncer.schedule(id, session);
    }
  }

  /**
   * List all sessions
   */
  listSessions(): ShellSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Delete a session
   */
  async deleteSession(nameOrId: string): Promise<boolean> {
    const session = await this.getSession(nameOrId);
    if (session && session.id !== this.defaultSessionId) {
      // Kill any background processes for this session
      this.processManager.killSessionProcesses(session.id);
      
      const deleted = this.sessions.delete(session.id);
      if (deleted) {
        // Delete session file
        await this.persistence.deleteSessionFile(session.id);
        logger.info({ module: 'session-manager', action: 'delete-session', sessionId: session.id }, 
          `Deleted session: ${session.name}`);
      }
      return deleted;
    }
    return false;
  }

  /**
   * Add a command to session history
   */
  addToHistory(sessionId: string, history: CommandHistory): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.historyManager.addToHistory(session, history);
      // Use debounced save
      this.saveDebouncer.schedule(sessionId, session);
    }
  }

  /**
   * Get command history for a session
   */
  getHistory(sessionId: string, limit?: number): CommandHistory[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return this.historyManager.getRecentHistory(session, limit);
  }

  /**
   * Search command history
   */
  searchHistory(sessionId: string, pattern: string | RegExp): CommandHistory[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return this.historyManager.searchHistory(session, pattern);
  }

  // ===== Background Process Management =====

  /**
   * Start a background process
   */
  startBackgroundProcess(
    sessionId: string,
    command: string,
    args: string[],
    metadata?: { name?: string }
  ): string | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    try {
      return this.processManager.startProcess(session, command, args, metadata);
    } catch (error) {
      logger.error({ module: 'session-manager', action: 'start-process', sessionId, error }, 
        `Failed to start process: ${error}`);
      throw error;
    }
  }

  /**
   * Get a background process
   */
  getBackgroundProcess(id: string): BackgroundProcess | undefined {
    return this.processManager.getProcess(id);
  }

  /**
   * List background processes
   */
  listBackgroundProcesses(sessionId?: string): BackgroundProcess[] {
    return this.processManager.listProcesses(sessionId);
  }

  /**
   * Update a background process
   */
  updateBackgroundProcess(id: string, updates: Partial<BackgroundProcess>): void {
    this.processManager.updateProcess(id, updates);
  }

  /**
   * Kill a background process
   */
  killBackgroundProcess(id: string, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): boolean {
    return this.processManager.killProcess(id, signal);
  }

  /**
   * Get session process count
   */
  getSessionProcessCount(sessionId: string): number {
    return this.processManager.getSessionProcessCount(sessionId);
  }

  /**
   * Get processes with resource information
   */
  getBackgroundProcessesWithResources(): Array<BackgroundProcess & {
    resourcesSampled: boolean;
    samplingInterval?: number;
  }> {
    return this.processManager.getProcessesWithResources();
  }

  // ===== Public Methods for Cleanup =====

  /**
   * Flush pending saves
   */
  async flushPendingSaves(): Promise<void> {
    await this.saveDebouncer.flush();
  }

  /**
   * Cleanup for shutdown
   */
  async cleanup(): Promise<void> {
    // Stop resource monitoring
    await this.processManager.cleanup();
    
    // Flush pending saves
    await this.flushPendingSaves();
    
    // Clear all sessions from memory
    this.sessions.clear();
    
    logger.info({ module: 'session-manager', action: 'cleanup' }, 'Session manager cleanup complete');
  }

  // ===== Backward Compatibility Methods =====
  // These delegate to the process manager but maintain the same interface

  get runningProcesses() {
    // For backward compatibility with direct map access
    const map = new Map<string, any>();
    this.processManager.listProcesses().forEach(p => {
      if (p.process) {
        map.set(p.id, p.process);
      }
    });
    return map;
  }

  get backgroundProcesses() {
    // For backward compatibility with direct map access
    const map = new Map<string, BackgroundProcess>();
    this.processManager.listProcesses().forEach(p => {
      map.set(p.id, p);
    });
    return map;
  }
}
