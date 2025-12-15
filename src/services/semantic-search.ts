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
   */
  public async index(
    id: string,
    content: string,
    options?: IndexOptions
  ): Promise<void> {
    if (!this.embeddingService.isReady()) {
      throw new Error('Embedding service not initialized. Set VOYAGE_API_KEY environment variable.');
    }

    if (!this.vectorStorage.isReady()) {
      throw new Error('Vector storage not initialized');
    }

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
   */
  public async indexBatch(
    documents: Array<{ id: string; content: string; metadata?: Record<string, any> }>,
    options?: IndexOptions
  ): Promise<void> {
    if (!this.embeddingService.isReady()) {
      throw new Error('Embedding service not initialized. Set VOYAGE_API_KEY environment variable.');
    }

    if (!this.vectorStorage.isReady()) {
      throw new Error('Vector storage not initialized');
    }

    if (documents.length === 0) {
      return;
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
   */
  public async search(
    query: string,
    options?: SearchOptions
  ): Promise<SemanticSearchResult[]> {
    if (!this.embeddingService.isReady()) {
      throw new Error('Embedding service not initialized. Set VOYAGE_API_KEY environment variable.');
    }

    if (!this.vectorStorage.isReady()) {
      throw new Error('Vector storage not initialized');
    }

    try {
      const startTime = Date.now();

      // Generate query embedding
      const embeddingResult = await this.embeddingService.embed(query, {
        inputType: 'query',
        excludeCheck: true, // Allow searching for sensitive patterns
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
   */
  public get(id: string): VectorDocument | null {
    if (!this.vectorStorage.isReady()) {
      throw new Error('Vector storage not initialized');
    }

    return this.vectorStorage.get(id);
  }

  /**
   * Delete document by ID
   */
  public delete(id: string): boolean {
    if (!this.vectorStorage.isReady()) {
      throw new Error('Vector storage not initialized');
    }

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
   */
  public isReady(): boolean {
    return this.embeddingService.isReady() && this.vectorStorage.isReady();
  }

  /**
   * Clear all indexed documents
   */
  public clear(): void {
    if (!this.vectorStorage.isReady()) {
      throw new Error('Vector storage not initialized');
    }

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
