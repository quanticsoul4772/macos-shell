// Embedding Service
// Provides text embedding generation using Voyage AI

import { VoyageAIClient } from 'voyageai';
import { getEmbeddingConfig, isEmbeddingEnabled, shouldExcludeCommand } from '../config/embedding-config.js';
import { getLogger } from '../utils/logger.js';
import { LRUCache } from 'lru-cache';

const logger = getLogger('EmbeddingService');

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimension: number;
  cached: boolean;
}

export interface BatchEmbeddingResult {
  embeddings: number[][];
  model: string;
  dimension: number;
  totalTokens: number;
}

/**
 * Embedding Service
 * Handles all embedding generation with caching and error handling
 */
export class EmbeddingService {
  private client: VoyageAIClient | null = null;
  private cache: LRUCache<string, number[]>;
  private initialized = false;

  constructor() {
    const config = getEmbeddingConfig();

    // Initialize cache
    this.cache = new LRUCache<string, number[]>({
      max: 1000, // Store up to 1000 embeddings
      ttl: config.cacheTTL * 1000, // Convert to milliseconds
      updateAgeOnGet: true,
    });

    // Initialize client if enabled
    if (isEmbeddingEnabled()) {
      this.initialize();
    }
  }

  /**
   * Initialize the Voyage AI client
   * FAIL-FAST: Throws on initialization failure
   */
  private initialize(): void {
    const config = getEmbeddingConfig();

    if (!config.apiKey) {
      throw new Error(
        'FATAL: Embedding service requires VOYAGE_API_KEY. ' +
        'API key must be set in environment variables.'
      );
    }

    try {
      this.client = new VoyageAIClient({
        apiKey: config.apiKey,
      });

      this.initialized = true;
      logger.info('Embedding service initialized', {
        model: config.model,
        dimension: config.outputDimension,
        cacheEnabled: config.cacheEnabled,
      });
    } catch (error: any) {
      logger.error('FATAL: Failed to initialize embedding service', { error: error.message });
      throw new Error(`FATAL: Embedding service initialization failed: ${error.message}`);
    }
  }

  /**
   * Check if the service is ready to generate embeddings
   */
  public isReady(): boolean {
    return this.initialized && this.client !== null && isEmbeddingEnabled();
  }

  /**
   * Generate embedding for a single text
   * FAIL-FAST: Assumes service is initialized (would have thrown in constructor)
   */
  public async embed(
    text: string,
    options?: {
      inputType?: 'query' | 'document';
      skipCache?: boolean;
      excludeCheck?: boolean;
    }
  ): Promise<EmbeddingResult> {
    // Check if text should be excluded
    if (!options?.excludeCheck && shouldExcludeCommand(text)) {
      throw new Error('FATAL: Text contains sensitive patterns and was excluded from embedding');
    }

    const config = getEmbeddingConfig();
    const cacheKey = this.getCacheKey(text, options?.inputType);

    // Check cache first
    if (config.cacheEnabled && !options?.skipCache) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        logger.debug('Embedding cache hit', { textLength: text.length });
        return {
          embedding: cached,
          model: config.model,
          dimension: config.outputDimension,
          cached: true,
        };
      }
    }

    try {
      const startTime = Date.now();

      // Build request object according to Voyage AI API
      const request: any = {
        input: text, // Single string for single embed
        model: config.model,
        outputDimension: config.outputDimension,
      };
      if (options?.inputType) {
        request.inputType = options.inputType;
      }

      const result = await this.client!.embed(request);

      const duration = Date.now() - startTime;
      const embedding = result.data![0].embedding!;

      // Cache the result
      if (config.cacheEnabled) {
        this.cache.set(cacheKey, embedding);
      }

      logger.debug('Embedding generated', {
        textLength: text.length,
        duration,
        dimension: embedding.length,
      });

      return {
        embedding,
        model: config.model,
        dimension: config.outputDimension,
        cached: false,
      };
    } catch (error: any) {
      logger.error('Failed to generate embedding', {
        error: error.message,
        textLength: text.length,
      });
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch operation)
   * FAIL-FAST: Assumes service is initialized (would have thrown in constructor)
   */
  public async embedBatch(
    texts: string[],
    options?: {
      inputType?: 'query' | 'document';
      skipCache?: boolean;
      excludeCheck?: boolean;
    }
  ): Promise<BatchEmbeddingResult> {
    if (texts.length === 0) {
      throw new Error('FATAL: embedBatch called with empty texts array');
    }

    // Filter out excluded texts if needed
    const filteredTexts = options?.excludeCheck
      ? texts
      : texts.filter(text => !shouldExcludeCommand(text));

    if (filteredTexts.length === 0) {
      throw new Error('FATAL: All texts were excluded due to sensitive patterns');
    }

    const config = getEmbeddingConfig();
    const embeddings: number[][] = [];
    const uncachedTexts: string[] = [];
    const uncachedIndices: number[] = [];

    // Check cache for each text
    if (config.cacheEnabled && !options?.skipCache) {
      for (let i = 0; i < filteredTexts.length; i++) {
        const text = filteredTexts[i];
        const cacheKey = this.getCacheKey(text, options?.inputType);
        const cached = this.cache.get(cacheKey);

        if (cached) {
          embeddings[i] = cached;
        } else {
          uncachedTexts.push(text);
          uncachedIndices.push(i);
        }
      }

      logger.debug('Batch embedding cache check', {
        total: filteredTexts.length,
        cached: filteredTexts.length - uncachedTexts.length,
        uncached: uncachedTexts.length,
      });
    } else {
      uncachedTexts.push(...filteredTexts);
      uncachedIndices.push(...filteredTexts.map((_, i) => i));
    }

    // Generate embeddings for uncached texts
    if (uncachedTexts.length > 0) {
      try {
        const startTime = Date.now();

        // Build request object according to Voyage AI API
        const request: any = {
          input: uncachedTexts, // Array of strings for batch embed
          model: config.model,
          outputDimension: config.outputDimension,
        };
        if (options?.inputType) {
          request.inputType = options.inputType;
        }

        const result = await this.client!.embed(request);

        const duration = Date.now() - startTime;

        // Store results and cache
        for (let i = 0; i < uncachedTexts.length; i++) {
          const embedding = result.data![i].embedding!;
          const originalIndex = uncachedIndices[i];
          embeddings[originalIndex] = embedding;

          if (config.cacheEnabled) {
            const cacheKey = this.getCacheKey(uncachedTexts[i], options?.inputType);
            this.cache.set(cacheKey, embedding);
          }
        }

        logger.info('Batch embeddings generated', {
          count: uncachedTexts.length,
          duration,
          tokensUsed: result.usage?.totalTokens || 0,
        });

        return {
          embeddings,
          model: config.model,
          dimension: config.outputDimension,
          totalTokens: result.usage?.totalTokens || 0,
        };
      } catch (error: any) {
        logger.error('Failed to generate batch embeddings', {
          error: error.message,
          count: uncachedTexts.length,
        });
        throw new Error(`Batch embedding generation failed: ${error.message}`);
      }
    }

    // All embeddings were cached
    return {
      embeddings,
      model: config.model,
      dimension: config.outputDimension,
      totalTokens: 0,
    };
  }

  /**
   * Clear the embedding cache
   */
  public clearCache(): void {
    this.cache.clear();
    logger.info('Embedding cache cleared');
  }

  /**
   * Get cache statistics
   */
  public getCacheStats() {
    return {
      size: this.cache.size,
      max: this.cache.max,
      ttl: getEmbeddingConfig().cacheTTL,
    };
  }

  /**
   * Generate a cache key for text and input type
   */
  private getCacheKey(text: string, inputType?: 'query' | 'document'): string {
    const config = getEmbeddingConfig();
    return `${config.model}:${config.outputDimension}:${inputType || 'none'}:${text}`;
  }

  /**
   * Reinitialize the service (useful when config changes)
   */
  public reinitialize(): void {
    this.initialized = false;
    this.client = null;
    this.cache.clear();

    if (isEmbeddingEnabled()) {
      this.initialize();
    }
  }
}

// Singleton instance
let embeddingServiceInstance: EmbeddingService | null = null;

/**
 * Get the singleton embedding service instance
 */
export function getEmbeddingService(): EmbeddingService {
  if (!embeddingServiceInstance) {
    embeddingServiceInstance = new EmbeddingService();
  }
  return embeddingServiceInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetEmbeddingService(): void {
  embeddingServiceInstance = null;
}
