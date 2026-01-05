// Semantic Search Service
// Provides high-level semantic search by combining embedding generation and vector storage

import { getEmbeddingService } from './embedding-service.js';
import { getVectorStorage, type SearchResult, type VectorDocument } from './vector-storage.js';
import { getEmbeddingConfig } from '../config/embedding-config.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger('SemanticSearch');

export interface IndexOptions {
  skipCache?: boolean;
  excludeCheck?: boolean;
  metadata?: Record<string, any>;
}

export interface SearchOptions {
  limit?: number;
  minSimilarity?: number;
  filter?: Record<string, any>;
}

export interface SemanticSearchResult {
  id: string;
  content: string;
  metadata: Record<string, any>;
  similarity: number;
}

/**
 * Semantic Search Service
 * High-level service for indexing and searching content using embeddings
 */
export class SemanticSearch {
  private embeddingService = getEmbeddingService();
  private vectorStorage = getVectorStorage(getEmbeddingConfig().outputDimension);

  /**
   * Index a single document for semantic search
   * FAIL-FAST: Assumes services are initialized (would have thrown on server startup)
   */
  public async index(
    id: string,
    content: string,
    options?: IndexOptions
  ): Promise<void> {

    try {
      // Generate embedding
      const embeddingResult = await this.embeddingService.embed(content, {
        inputType: 'document',
        skipCache: options?.skipCache,
        excludeCheck: options?.excludeCheck,
      });

      // Store in vector database
      const doc: VectorDocument = {
        id,
        content,
        embedding: embeddingResult.embedding,
        metadata: options?.metadata,
        timestamp: Date.now(),
      };

      await this.vectorStorage.upsert(doc);

      logger.debug('Document indexed', {
        id,
        contentLength: content.length,
        cached: embeddingResult.cached,
      });
    } catch (error: any) {
      logger.error('Failed to index document', {
        id,
        error: error.message,
      });
      throw new Error(`Document indexing failed: ${error.message}`);
    }
  }

  /**
   * Index multiple documents in batch
   * FAIL-FAST: Assumes services are initialized (would have thrown on server startup)
   */
  public async indexBatch(
    documents: Array<{ id: string; content: string; metadata?: Record<string, any> }>,
    options?: IndexOptions
  ): Promise<void> {
    if (documents.length === 0) {
      throw new Error('FATAL: indexBatch called with empty documents array');
    }

    try {
      const startTime = Date.now();

      // Generate embeddings in batch
      const contents = documents.map(d => d.content);
      const batchResult = await this.embeddingService.embedBatch(contents, {
        inputType: 'document',
        skipCache: options?.skipCache,
        excludeCheck: options?.excludeCheck,
      });

      // Prepare vector documents
      const vectorDocs: VectorDocument[] = documents.map((doc, i) => ({
        id: doc.id,
        content: doc.content,
        embedding: batchResult.embeddings[i],
        metadata: doc.metadata,
        timestamp: Date.now(),
      }));

      // Store in vector database
      await this.vectorStorage.upsertBatch(vectorDocs);

      const duration = Date.now() - startTime;
      logger.info('Batch indexing completed', {
        count: documents.length,
        duration,
        tokensUsed: batchResult.totalTokens,
      });
    } catch (error: any) {
      logger.error('Failed to batch index documents', {
        count: documents.length,
        error: error.message,
      });
      throw new Error(`Batch indexing failed: ${error.message}`);
    }
  }

  /**
   * Search for similar documents using semantic similarity
   * FAIL-FAST: Assumes services are initialized (would have thrown on server startup)
   */
  public async search(
    query: string,
    options?: SearchOptions
  ): Promise<SemanticSearchResult[]> {

    try {
      const startTime = Date.now();

      // Generate query embedding
      const embeddingResult = await this.embeddingService.embed(query, {
        inputType: 'query',
        excludeCheck: true, // Allow searching for sensitive patterns
      });

      // DEBUG: Log embedding details
      logger.info('Query embedding generated', {
        query: query.substring(0, 50),
        embeddingLength: embeddingResult.embedding.length,
        firstValues: embeddingResult.embedding.slice(0, 3),
        cached: embeddingResult.cached,
      });

      // Search vector storage
      const results = this.vectorStorage.search(embeddingResult.embedding, {
        limit: options?.limit,
        minSimilarity: options?.minSimilarity,
        filter: options?.filter,
      });

      const duration = Date.now() - startTime;
      logger.debug('Semantic search completed', {
        query: query.substring(0, 50),
        resultsFound: results.length,
        duration,
        cached: embeddingResult.cached,
      });

      // Convert to semantic search results
      return results.map(r => ({
        id: r.id,
        content: r.content,
        metadata: r.metadata,
        similarity: r.similarity,
      }));
    } catch (error: any) {
      logger.error('Semantic search failed', {
        query: query.substring(0, 50),
        error: error.message,
      });
      throw new Error(`Semantic search failed: ${error.message}`);
    }
  }

  /**
   * Get document by ID
   * FAIL-FAST: Assumes storage is initialized (would have thrown on server startup)
   */
  public get(id: string): VectorDocument | null {
    return this.vectorStorage.get(id);
  }

  /**
   * Delete document by ID
   * FAIL-FAST: Assumes storage is initialized (would have thrown on server startup)
   */
  public delete(id: string): boolean {
    return this.vectorStorage.delete(id);
  }

  /**
   * Get storage statistics
   */
  public getStats() {
    const embeddingStats = this.embeddingService.getCacheStats();
    const storageStats = this.vectorStorage.isReady()
      ? this.vectorStorage.getStats()
      : null;

    return {
      embedding: {
        cacheSize: embeddingStats.size,
        cacheMax: embeddingStats.max,
        cacheTTL: embeddingStats.ttl,
      },
      storage: storageStats,
      ready: this.isReady(),
    };
  }

  /**
   * Check if semantic search is ready
   * FAIL-FAST: Always returns true (services throw on construction if not ready)
   */
  public isReady(): boolean {
    return true;
  }

  /**
   * Clear all indexed documents
   * FAIL-FAST: Assumes storage is initialized (would have thrown on server startup)
   */
  public clear(): void {
    this.vectorStorage.clear();
    logger.info('All indexed documents cleared');
  }

  /**
   * Reinitialize services (useful when config changes)
   */
  public reinitialize(): void {
    this.embeddingService.reinitialize();
    this.vectorStorage = getVectorStorage(getEmbeddingConfig().outputDimension);
    logger.info('Semantic search reinitialized');
  }
}

// Singleton instance
let semanticSearchInstance: SemanticSearch | null = null;

/**
 * Get the singleton semantic search instance
 */
export function getSemanticSearch(): SemanticSearch {
  if (!semanticSearchInstance) {
    semanticSearchInstance = new SemanticSearch();
  }
  return semanticSearchInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetSemanticSearch(): void {
  semanticSearchInstance = null;
}
