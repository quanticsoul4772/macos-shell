// Embedding Configuration
// Manages settings for Voyage AI embedding integration

export interface EmbeddingConfig {
  enabled: boolean;
  provider: 'voyage' | 'ollama' | 'openai';
  apiKey?: string;
  model: string;
  outputDimension: 256 | 512 | 1024 | 2048;
  excludePatterns: string[];
  encryptStorage: boolean;
  retentionDays: number;
  cacheEnabled: boolean;
  cacheTTL: number; // seconds
}

const DEFAULT_CONFIG: EmbeddingConfig = {
  enabled: true, // FAIL-FAST: Enabled by default, requires API key
  provider: 'voyage',
  model: 'voyage-3.5-lite', // Optimized for latency
  outputDimension: 512, // Balance between quality and performance
  excludePatterns: [
    '.*password.*',
    '.*secret.*',
    '.*token.*',
    '.*key.*',
    'export .*_KEY=.*',
    'export .*_SECRET=.*',
  ],
  encryptStorage: true,
  retentionDays: 90,
  cacheEnabled: true,
  cacheTTL: 3600, // 1 hour
};

let currentConfig: EmbeddingConfig = { ...DEFAULT_CONFIG };

/**
 * Initialize embedding configuration
 * FAIL-FAST: Throws if API key missing when embeddings enabled
 */
export function initEmbeddingConfig(): EmbeddingConfig {
  const envConfig: Partial<EmbeddingConfig> = {};

  // Check for API key in environment
  if (process.env.VOYAGE_API_KEY) {
    envConfig.apiKey = process.env.VOYAGE_API_KEY;
    envConfig.enabled = true;
  }

  // Check for model override
  if (process.env.VOYAGE_MODEL) {
    envConfig.model = process.env.VOYAGE_MODEL;
  }

  // Check for dimension override
  if (process.env.VOYAGE_DIMENSION) {
    const dim = parseInt(process.env.VOYAGE_DIMENSION, 10);
    if ([256, 512, 1024, 2048].includes(dim)) {
      envConfig.outputDimension = dim as 256 | 512 | 1024 | 2048;
    }
  }

  // Check if embeddings should be explicitly disabled
  if (process.env.EMBEDDINGS_ENABLED === 'false') {
    envConfig.enabled = false;
  }

  currentConfig = { ...DEFAULT_CONFIG, ...envConfig };

  // FAIL-FAST: Validate API key if embeddings enabled
  if (currentConfig.enabled && !currentConfig.apiKey) {
    throw new Error(
      'FATAL: Embedding services enabled but VOYAGE_API_KEY not set. ' +
      'Set VOYAGE_API_KEY environment variable or disable embeddings with EMBEDDINGS_ENABLED=false'
    );
  }

  return currentConfig;
}

/**
 * Get current embedding configuration
 */
export function getEmbeddingConfig(): EmbeddingConfig {
  return currentConfig;
}

/**
 * Update embedding configuration at runtime
 */
export function updateEmbeddingConfig(updates: Partial<EmbeddingConfig>): void {
  currentConfig = { ...currentConfig, ...updates };
}

/**
 * Check if a command should be excluded from embedding
 */
export function shouldExcludeCommand(command: string): boolean {
  if (!currentConfig.excludePatterns.length) {
    return false;
  }

  return currentConfig.excludePatterns.some(pattern => {
    const regex = new RegExp(pattern, 'i');
    return regex.test(command);
  });
}

/**
 * Check if embeddings are properly configured and enabled
 */
export function isEmbeddingEnabled(): boolean {
  return currentConfig.enabled && !!currentConfig.apiKey;
}

// Initialize on module load
initEmbeddingConfig();
