// Vector Storage Service
// Provides persistent vector storage with similarity search using SQLite + VSS

import Database from 'better-sqlite3';
import { load as loadVss } from 'sqlite-vss';
import { getLogger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

const logger = getLogger('VectorStorage');

export interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, any>;
  timestamp?: number;
}

export interface SearchResult {
  id: string;
  content: string;
  metadata: Record<string, any>;
  similarity: number;
  distance: number;
}

export interface VectorStorageConfig {
  databasePath?: string;
  dimension: number;
  tableName?: string;
}

/**
 * Vector Storage Service
 * Manages persistent storage and similarity search for embeddings
 */
export class VectorStorage {
  private db: Database.Database;
  private dimension: number;
  private tableName: string;
  private initialized = false;

  constructor(config: VectorStorageConfig) {
    this.dimension = config.dimension;
    this.tableName = config.tableName || 'vectors';

    // Use default path if not provided
    const dbPath = config.databasePath || this.getDefaultDatabasePath();

    // Ensure directory exists
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Initialize database
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL'); // Better concurrency

    // Load VSS extension
    try {
      loadVss(this.db);
      logger.info('VSS extension loaded successfully');
    } catch (error: any) {
      logger.error('Failed to load VSS extension', { error: error.message });
      throw new Error(`VSS extension load failed: ${error.message}`);
    }

    this.initialize();
  }

  /**
   * Get default database path
   */
  private getDefaultDatabasePath(): string {
    const homeDir = os.homedir();
    const dataDir = path.join(homeDir, '.macos-shell', 'embeddings');
    return path.join(dataDir, 'vectors.db');
  }

  /**
   * Initialize database tables and virtual table
   */
  private initialize(): void {
    try {
      // Create documents table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          metadata TEXT,
          timestamp INTEGER NOT NULL,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `);

      // Create virtual table for vector similarity search
      // Using vss0 for cosine similarity
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName}_vss USING vss0(
          embedding(${this.dimension})
        )
      `);

      // Create index for faster lookups
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_${this.tableName}_timestamp
        ON ${this.tableName}(timestamp DESC)
      `);

      this.initialized = true;
      logger.info('Vector storage initialized', {
        tableName: this.tableName,
        dimension: this.dimension,
        databasePath: this.db.name,
      });
    } catch (error: any) {
      logger.error('Failed to initialize vector storage', { error: error.message });
      throw new Error(`Vector storage initialization failed: ${error.message}`);
    }
  }

  /**
   * Check if storage is ready
   */
  public isReady(): boolean {
    return this.initialized && this.db.open;
  }

  /**
   * Insert or update a document with its embedding
   */
  public async upsert(doc: VectorDocument): Promise<void> {
    if (!this.isReady()) {
      throw new Error('Vector storage not initialized');
    }

    if (doc.embedding.length !== this.dimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimension}, got ${doc.embedding.length}`
      );
    }

    const timestamp = doc.timestamp || Date.now();
    const metadata = doc.metadata ? JSON.stringify(doc.metadata) : null;

    try {
      // Use transaction for atomicity
      const transaction = this.db.transaction(() => {
        // Insert or replace document
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO ${this.tableName} (id, content, metadata, timestamp)
          VALUES (?, ?, ?, ?)
        `);
        stmt.run(doc.id, doc.content, metadata, timestamp);

        // Insert or replace embedding in virtual table
        const vssStmt = this.db.prepare(`
          INSERT OR REPLACE INTO ${this.tableName}_vss (rowid, embedding)
          VALUES (
            (SELECT rowid FROM ${this.tableName} WHERE id = ?),
            ?
          )
        `);
        vssStmt.run(doc.id, JSON.stringify(doc.embedding));
      });

      transaction();

      logger.debug('Document upserted', {
        id: doc.id,
        contentLength: doc.content.length,
        dimension: doc.embedding.length,
      });
    } catch (error: any) {
      logger.error('Failed to upsert document', {
        id: doc.id,
        error: error.message,
      });
      throw new Error(`Document upsert failed: ${error.message}`);
    }
  }

  /**
   * Batch insert/update documents
   */
  public async upsertBatch(docs: VectorDocument[]): Promise<void> {
    if (!this.isReady()) {
      throw new Error('Vector storage not initialized');
    }

    if (docs.length === 0) {
      return;
    }

    try {
      const transaction = this.db.transaction(() => {
        const docStmt = this.db.prepare(`
          INSERT OR REPLACE INTO ${this.tableName} (id, content, metadata, timestamp)
          VALUES (?, ?, ?, ?)
        `);

        const vssStmt = this.db.prepare(`
          INSERT OR REPLACE INTO ${this.tableName}_vss (rowid, embedding)
          VALUES (
            (SELECT rowid FROM ${this.tableName} WHERE id = ?),
            ?
          )
        `);

        for (const doc of docs) {
          if (doc.embedding.length !== this.dimension) {
            throw new Error(
              `Embedding dimension mismatch for doc ${doc.id}: expected ${this.dimension}, got ${doc.embedding.length}`
            );
          }

          const timestamp = doc.timestamp || Date.now();
          const metadata = doc.metadata ? JSON.stringify(doc.metadata) : null;

          docStmt.run(doc.id, doc.content, metadata, timestamp);
          vssStmt.run(doc.id, JSON.stringify(doc.embedding));
        }
      });

      transaction();

      logger.info('Batch upsert completed', { count: docs.length });
    } catch (error: any) {
      logger.error('Failed to batch upsert', {
        count: docs.length,
        error: error.message,
      });
      throw new Error(`Batch upsert failed: ${error.message}`);
    }
  }

  /**
   * Search for similar vectors using cosine similarity
   */
  public search(
    queryEmbedding: number[],
    options?: {
      limit?: number;
      minSimilarity?: number;
      filter?: Record<string, any>;
    }
  ): SearchResult[] {
    if (!this.isReady()) {
      throw new Error('Vector storage not initialized');
    }

    if (queryEmbedding.length !== this.dimension) {
      throw new Error(
        `Query embedding dimension mismatch: expected ${this.dimension}, got ${queryEmbedding.length}`
      );
    }

    const limit = options?.limit || 10;
    const minSimilarity = options?.minSimilarity || 0.0;

    try {
      // VSS uses distance (lower is better), we convert to similarity (higher is better)
      // cosine distance = 1 - cosine similarity
      // So: similarity = 1 - distance
      const stmt = this.db.prepare(`
        SELECT
          d.id,
          d.content,
          d.metadata,
          d.timestamp,
          v.distance
        FROM ${this.tableName}_vss v
        INNER JOIN ${this.tableName} d ON d.rowid = v.rowid
        WHERE vss_search(v.embedding, ?)
        ORDER BY v.distance ASC
        LIMIT ?
      `);

      const rows = stmt.all(JSON.stringify(queryEmbedding), limit * 2) as Array<{
        id: string;
        content: string;
        metadata: string | null;
        timestamp: number;
        distance: number;
      }>;

      // Convert distance to similarity and filter
      const results: SearchResult[] = rows
        .map(row => {
          const similarity = 1 - row.distance;
          return {
            id: row.id,
            content: row.content,
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
            similarity,
            distance: row.distance,
          };
        })
        .filter(result => result.similarity >= minSimilarity)
        .slice(0, limit);

      logger.debug('Vector search completed', {
        queryDimension: queryEmbedding.length,
        resultsFound: results.length,
        limit,
        minSimilarity,
      });

      return results;
    } catch (error: any) {
      logger.error('Vector search failed', {
        error: error.message,
        dimension: queryEmbedding.length,
      });
      throw new Error(`Vector search failed: ${error.message}`);
    }
  }

  /**
   * Get document by ID
   */
  public get(id: string): VectorDocument | null {
    if (!this.isReady()) {
      throw new Error('Vector storage not initialized');
    }

    try {
      const stmt = this.db.prepare(`
        SELECT d.id, d.content, d.metadata, d.timestamp
        FROM ${this.tableName} d
        WHERE d.id = ?
      `);

      const row = stmt.get(id) as
        | {
            id: string;
            content: string;
            metadata: string | null;
            timestamp: number;
          }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        content: row.content,
        embedding: [], // Don't retrieve embedding for simple get
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        timestamp: row.timestamp,
      };
    } catch (error: any) {
      logger.error('Failed to get document', { id, error: error.message });
      throw new Error(`Get document failed: ${error.message}`);
    }
  }

  /**
   * Delete document by ID
   */
  public delete(id: string): boolean {
    if (!this.isReady()) {
      throw new Error('Vector storage not initialized');
    }

    try {
      const transaction = this.db.transaction(() => {
        // Delete from documents table
        const docStmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
        const docInfo = docStmt.run(id);

        // Delete from VSS table
        const vssStmt = this.db.prepare(
          `DELETE FROM ${this.tableName}_vss WHERE rowid = (SELECT rowid FROM ${this.tableName} WHERE id = ?)`
        );
        vssStmt.run(id);

        return docInfo.changes > 0;
      });

      const deleted = transaction();
      logger.debug('Document deleted', { id, deleted });
      return deleted;
    } catch (error: any) {
      logger.error('Failed to delete document', { id, error: error.message });
      throw new Error(`Delete document failed: ${error.message}`);
    }
  }

  /**
   * Get storage statistics
   */
  public getStats() {
    if (!this.isReady()) {
      throw new Error('Vector storage not initialized');
    }

    try {
      const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`);
      const countRow = countStmt.get() as { count: number };

      const sizeStmt = this.db.prepare(`
        SELECT page_count * page_size as size
        FROM pragma_page_count(), pragma_page_size()
      `);
      const sizeRow = sizeStmt.get() as { size: number };

      return {
        documentCount: countRow.count,
        databaseSize: sizeRow.size,
        dimension: this.dimension,
        tableName: this.tableName,
        databasePath: this.db.name,
      };
    } catch (error: any) {
      logger.error('Failed to get stats', { error: error.message });
      throw new Error(`Get stats failed: ${error.message}`);
    }
  }

  /**
   * Clear all documents (dangerous!)
   */
  public clear(): void {
    if (!this.isReady()) {
      throw new Error('Vector storage not initialized');
    }

    try {
      const transaction = this.db.transaction(() => {
        this.db.exec(`DELETE FROM ${this.tableName}`);
        this.db.exec(`DELETE FROM ${this.tableName}_vss`);
      });

      transaction();
      logger.warn('All documents cleared');
    } catch (error: any) {
      logger.error('Failed to clear storage', { error: error.message });
      throw new Error(`Clear storage failed: ${error.message}`);
    }
  }

  /**
   * Close the database connection
   */
  public close(): void {
    if (this.db.open) {
      this.db.close();
      this.initialized = false;
      logger.info('Vector storage closed');
    }
  }
}

// Singleton instance
let vectorStorageInstance: VectorStorage | null = null;

/**
 * Get the singleton vector storage instance
 */
export function getVectorStorage(dimension: number): VectorStorage {
  if (!vectorStorageInstance || vectorStorageInstance['dimension'] !== dimension) {
    vectorStorageInstance = new VectorStorage({ dimension });
  }
  return vectorStorageInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetVectorStorage(): void {
  if (vectorStorageInstance) {
    vectorStorageInstance.close();
  }
  vectorStorageInstance = null;
}
