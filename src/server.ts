import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execa, ExecaError } from "execa";
import { v4 as uuidv4 } from "uuid";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import { BackgroundProcess, ProcessStatus } from "./background-process.js";
import { LRUCache } from './utils/lru-cache.js';
import { Debouncer } from './utils/debouncer.js';
import { EnhancedCircularBuffer } from './utils/enhanced-circular-buffer.js';
import { BatchExecutor, BatchExecuteSchema } from './utils/batch-executor.js';
import { PatternMatcher, PatternType } from './pattern-matcher.js';
import { SessionManager, ShellSession, CommandHistory, PERSISTENCE_DIR, SESSIONS_DIR, PROCESSES_DIR } from './session-manager.js';
import { registerCommandTools } from './tools/command-tools.js';
import { registerSessionTools } from './tools/session-tools.js';
import { registerProcessTools } from './tools/process-tools.js';
import { registerSystemTools } from './tools/system-tools.js';
import { registerInteractiveSSHTools } from './tools/interactive-ssh-tool.js';
import { registerPreflightTools } from './tools/preflight-tools.js';
import { registerSemanticTools } from './tools/semantic-tools.js';
import { startMonitoring } from './ai-monitor.js';
import { initializeLogger, getLogger, LogLevel } from './utils/logger.js';
import { learningPersistence } from './learning-persistence.js';
import { initEmbeddingConfig, isEmbeddingEnabled, getEmbeddingConfig } from './config/embedding-config.js';
import { getEmbeddingService } from './services/embedding-service.js';
import { getErrorKnowledgeBase } from './services/error-knowledge-base.js';
import { getDocumentationRAGService } from './services/documentation-rag-service.js';


// Initialize logger
const mainLogger = initializeLogger({
  level: process.env.MCP_DEBUG ? LogLevel.DEBUG : LogLevel.INFO,
  enableConsole: true,
  enableFile: process.env.MCP_LOG_FILE ? true : false,
  filePath: process.env.MCP_LOG_FILE
});

const logger = getLogger('Server');
logger.info('Starting macOS Shell MCP Server v3.1.1');

// Initialize learning persistence
(async () => {
  try {
    await learningPersistence.initialize();
    logger.info('Learning persistence initialized');
  } catch (error) {
    logger.error('Failed to initialize learning persistence', error as Error);
  }
})();

// Initialize embedding services - FAIL-FAST on missing API key
// CRITICAL: Must complete before server starts accepting requests
async function initializeEmbeddingServices() {
  // FAIL-FAST: initEmbeddingConfig() will throw if API key missing
  initEmbeddingConfig();

  const embeddingService = getEmbeddingService();
  const config = getEmbeddingConfig();

  logger.info('Embedding services initialized - FAIL-FAST mode enabled', {
    provider: config.provider,
    model: config.model,
    dimension: config.outputDimension,
    cacheEnabled: config.cacheEnabled,
    failFast: true,
  });

  // Initialize error knowledge base with pre-populated errors
  const errorKB = getErrorKnowledgeBase();
  await errorKB.initialize();
  const stats = errorKB.getStats();
  logger.info('Error knowledge base initialized', {
    errorCount: stats.errorCount,
    categories: stats.categories,
  });

  // Initialize documentation RAG service with curated command docs
  const docRAG = getDocumentationRAGService();
  await docRAG.initialize();
  const docStats = docRAG.getStats();
  logger.info('Documentation RAG service initialized', {
    commandCount: docStats.commandCount,
    categories: docStats.categories,
  });
}

// Initialize session manager
const sessionManager = new SessionManager();

// Initialize batch executor
const batchExecutor = new BatchExecutor(
  async (sessionId) => {
    const session = await sessionManager.getSession(sessionId);
    return session?.cwd || process.cwd();
  },
  async (sessionId) => {
    const session = await sessionManager.getSession(sessionId);
    return session?.env || process.env as Record<string, string>;
  }
);

// Create MCP server
const server = new McpServer({
  name: "macos-shell",
  version: "3.1.1",
  description: "AI-Optimized macOS shell with command caching, deduplication, and error recovery"
});

// Start AI performance monitoring
startMonitoring();
logger.debug('AI performance monitoring started');

// Register all tool modules
registerCommandTools(server, sessionManager, batchExecutor);
registerSessionTools(server, sessionManager);
registerProcessTools(server, sessionManager);
registerSystemTools(server, sessionManager);
registerInteractiveSSHTools(server, sessionManager);
registerPreflightTools(server, sessionManager);
registerSemanticTools(server, sessionManager);

// Initialize all async services and then connect to transport
// CRITICAL: Must wait for initialization before accepting requests
(async () => {
  try {
    // Wait for all embedding services to initialize
    await initializeEmbeddingServices();
    logger.info('All services initialized - server ready to accept requests');

    // Now connect to transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('Server connected and ready');
  } catch (error) {
    logger.error('FATAL: Failed to initialize services', error as Error);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  
  try {
    // Clean up all resources including resource monitoring
    await sessionManager.cleanup();
    
    // Flush all pending saves
    await sessionManager.flushPendingSaves();
    
    // Clean up all processes
    for (const process of sessionManager.listBackgroundProcesses()) {
      if (process.outputBuffer instanceof EnhancedCircularBuffer) {
        process.outputBuffer.cleanup();
      }
    }
  } catch (error) {
    logger.error('Error during shutdown', error as Error);
  }
  
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  
  try {
    // Clean up all resources including resource monitoring
    await sessionManager.cleanup();
    
    await sessionManager.flushPendingSaves();
  } catch (error) {
    logger.error('Error during shutdown', error as Error);
  }
  
  process.exit(0);
});