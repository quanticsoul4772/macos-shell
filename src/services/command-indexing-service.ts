// Command Indexing Service
// Automatically indexes command history with semantic embeddings for intelligent search

import { getSemanticSearch } from './semantic-search.js';
import { CommandHistory } from '../sessions/session-types.js';
import { getLogger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger('CommandIndexing');

export interface IndexedCommand {
  id: string;
  command: string;
  metadata: {
    sessionId: string;
    cwd: string;
    exitCode: number;
    duration: number;
    timestamp: number;
    stdout?: string;
    stderr?: string;
  };
}

/**
 * Command Indexing Service
 * FAIL-FAST: Automatically indexes all commands with semantic embeddings
 */
export class CommandIndexingService {
  private semanticSearch = getSemanticSearch();
  private indexQueue: IndexedCommand[] = [];
  private batchSize = 10;
  private batchTimeout: NodeJS.Timeout | null = null;

  /**
   * Index a command immediately after execution
   * FAIL-FAST: Throws if embedding fails
   */
  public async indexCommand(
    sessionId: string,
    history: CommandHistory,
    cwd: string
  ): Promise<void> {
    const commandId = uuidv4();

    // Build searchable content from command and output
    const searchableContent = this.buildSearchableContent(history);

    // Build metadata
    const metadata = {
      sessionId,
      cwd,
      exitCode: history.exitCode,
      duration: history.duration,
      timestamp: history.timestamp.getTime(),
      // Only store first 500 chars of output to avoid bloat
      stdout: history.stdout?.substring(0, 500),
      stderr: history.stderr?.substring(0, 500),
    };

    // Add to batch queue
    const indexedCmd: IndexedCommand = {
      id: commandId,
      command: history.command,
      metadata,
    };

    this.indexQueue.push(indexedCmd);

    // Index immediately or batch
    if (this.indexQueue.length >= this.batchSize) {
      await this.flushQueue();
    } else {
      // Schedule batch flush
      this.scheduleBatchFlush();
    }

    logger.debug('Command queued for indexing', {
      commandId,
      command: history.command.substring(0, 50),
      queueSize: this.indexQueue.length,
    });
  }

  /**
   * Build searchable content from command history
   * Includes command, working directory, and relevant output snippets
   */
  private buildSearchableContent(history: CommandHistory): string {
    const parts: string[] = [];

    // Primary content: the command itself
    parts.push(history.command);

    // Add success/failure context
    if (history.exitCode === 0) {
      parts.push('(successful)');
    } else {
      parts.push(`(failed with code ${history.exitCode})`);
    }

    // Add relevant output snippets (first 200 chars)
    if (history.stdout) {
      const snippet = history.stdout.substring(0, 200).trim();
      if (snippet) {
        parts.push(`output: ${snippet}`);
      }
    }

    if (history.stderr) {
      const snippet = history.stderr.substring(0, 200).trim();
      if (snippet) {
        parts.push(`error: ${snippet}`);
      }
    }

    return parts.join(' ');
  }

  /**
   * Schedule a batch flush after a delay
   */
  private scheduleBatchFlush(): void {
    if (this.batchTimeout) {
      return; // Already scheduled
    }

    this.batchTimeout = setTimeout(async () => {
      await this.flushQueue();
    }, 1000); // 1 second delay for batching
  }

  /**
   * Flush the index queue - index all queued commands
   * FAIL-FAST: Throws if batch indexing fails
   */
  private async flushQueue(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.indexQueue.length === 0) {
      return;
    }

    const commandsToIndex = [...this.indexQueue];
    this.indexQueue = [];

    try {
      const startTime = Date.now();

      // Prepare documents for batch indexing
      const documents = commandsToIndex.map(cmd => ({
        id: cmd.id,
        content: this.buildSearchableContent({
          command: cmd.command,
          exitCode: cmd.metadata.exitCode,
          duration: cmd.metadata.duration,
          timestamp: new Date(cmd.metadata.timestamp),
          stdout: cmd.metadata.stdout,
          stderr: cmd.metadata.stderr,
        }),
        metadata: cmd.metadata,
      }));

      // Batch index with embeddings
      await this.semanticSearch.indexBatch(documents, {
        excludeCheck: false, // Check for sensitive patterns
      });

      const duration = Date.now() - startTime;
      logger.info('Command batch indexed', {
        count: commandsToIndex.length,
        duration,
      });
    } catch (error: any) {
      logger.error('FATAL: Failed to index command batch', {
        count: commandsToIndex.length,
        error: error.message,
      });
      throw new Error(`FATAL: Command indexing failed: ${error.message}`);
    }
  }

  /**
   * Search command history semantically by intent
   * FAIL-FAST: Throws if search fails
   */
  public async searchCommands(
    query: string,
    options?: {
      limit?: number;
      minSimilarity?: number;
      sessionId?: string;
    }
  ): Promise<IndexedCommand[]> {
    try {
      const startTime = Date.now();

      // Search with semantic similarity
      const results = await this.semanticSearch.search(query, {
        limit: options?.limit || 10,
        minSimilarity: options?.minSimilarity || 0.3, // Lowered for query/document inputType difference
      });

      // Filter by session if specified
      let filteredResults = results;
      if (options?.sessionId) {
        filteredResults = results.filter(
          r => r.metadata.sessionId === options.sessionId
        );
      }

      // Convert to indexed commands
      const commands: IndexedCommand[] = filteredResults.map(result => ({
        id: result.id,
        command: result.metadata.command || result.content.split(' ')[0],
        metadata: result.metadata as IndexedCommand['metadata'],
      }));

      const duration = Date.now() - startTime;
      logger.debug('Command search completed', {
        query: query.substring(0, 50),
        resultsFound: commands.length,
        duration,
      });

      return commands;
    } catch (error: any) {
      logger.error('FATAL: Command search failed', {
        query: query.substring(0, 50),
        error: error.message,
      });
      throw new Error(`FATAL: Command search failed: ${error.message}`);
    }
  }

  /**
   * Get command statistics
   */
  public getStats() {
    const searchStats = this.semanticSearch.getStats();
    return {
      ...searchStats,
      queueSize: this.indexQueue.length,
      batchSize: this.batchSize,
    };
  }
}

// Singleton instance
let commandIndexingInstance: CommandIndexingService | null = null;

/**
 * Get the singleton command indexing service
 */
export function getCommandIndexingService(): CommandIndexingService {
  if (!commandIndexingInstance) {
    commandIndexingInstance = new CommandIndexingService();
  }
  return commandIndexingInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetCommandIndexingService(): void {
  commandIndexingInstance = null;
}
