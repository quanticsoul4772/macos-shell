// Logger Module
// Provides structured logging with levels and metadata

import * as fs from 'fs/promises';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

interface LoggerConfig {
  level?: LogLevel;
  enableConsole?: boolean;
  enableFile?: boolean;
  filePath?: string;
  maxFileSize?: number; // Max log file size in bytes
  rotateOnSize?: boolean; // Rotate log file when it reaches maxFileSize
}

interface LogContext {
  module: string;
  action?: string;
  [key: string]: any;
}

interface LogEntry {
  timestamp: string;
  level: string;
  module?: string;
  action?: string;
  message: string;
  error?: string;
  metadata?: any;
}

class Logger {
  private config: LoggerConfig;
  private fileStream?: fs.FileHandle;
  private currentFileSize = 0;
  private readonly DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  
  constructor(private module: string, config?: LoggerConfig) {
    this.config = config || globalConfig;
    if (this.config.enableFile && this.config.filePath) {
      this.initializeFileLogging().catch(err => {
        console.error(`Failed to initialize file logging: ${err}`);
      });
    }
  }

  private async initializeFileLogging(): Promise<void> {
    if (!this.config.filePath) return;
    
    try {
      // Ensure log directory exists
      const logDir = path.dirname(this.config.filePath);
      await fs.mkdir(logDir, { recursive: true });
      
      // Check existing file size
      try {
        const stats = await fs.stat(this.config.filePath);
        this.currentFileSize = stats.size;
      } catch {
        // File doesn't exist yet
        this.currentFileSize = 0;
      }
      
      // Open file in append mode
      this.fileStream = await fs.open(this.config.filePath, 'a');
    } catch (error) {
      console.error(`Failed to open log file: ${error}`);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= (this.config.level || LogLevel.INFO);
  }

  private async rotateLogFile(): Promise<void> {
    if (!this.config.filePath || !this.fileStream) return;
    
    try {
      // Close current file
      await this.fileStream.close();
      
      // Rename current file with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedPath = `${this.config.filePath}.${timestamp}`;
      await fs.rename(this.config.filePath, rotatedPath);
      
      // Open new file
      this.fileStream = await fs.open(this.config.filePath, 'a');
      this.currentFileSize = 0;
      
      // Log rotation event
      const rotationEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        module: 'logger',
        action: 'rotate',
        message: `Log file rotated to ${rotatedPath}`
      };
      await this.writeToFile(JSON.stringify(rotationEntry) + '\n');
    } catch (error) {
      console.error(`Failed to rotate log file: ${error}`);
    }
  }

  private async writeToFile(content: string): Promise<void> {
    if (!this.fileStream) return;
    
    try {
      const buffer = Buffer.from(content);
      await this.fileStream.write(buffer);
      this.currentFileSize += buffer.length;
      
      // Check if rotation is needed
      const maxSize = this.config.maxFileSize || this.DEFAULT_MAX_FILE_SIZE;
      if (this.config.rotateOnSize && this.currentFileSize >= maxSize) {
        await this.rotateLogFile();
      }
    } catch (error) {
      console.error(`Failed to write to log file: ${error}`);
    }
  }

  private async log(level: LogLevel, contextOrMessage: LogContext | string, messageOrError?: string | Error, metadata?: any): Promise<void> {
    if (!this.shouldLog(level)) return;
    
    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    
    let message: string;
    let context: LogContext;
    let error: Error | undefined;
    let meta: any;
    
    // Handle different call signatures
    if (typeof contextOrMessage === 'string') {
      // Old style: message, error?, metadata?
      message = contextOrMessage;
      if (messageOrError instanceof Error) {
        error = messageOrError;
        meta = metadata;
      } else if (messageOrError) {
        message = messageOrError;
        meta = metadata;
      }
      context = { module: this.module };
    } else {
      // New style: context, message
      context = contextOrMessage;
      message = messageOrError as string || '';
      meta = context;
      // Extract error from context if present
      if (context.error instanceof Error) {
        error = context.error;
      }
    }
    
    // Structured log format
    const logEntry: LogEntry = {
      timestamp,
      level: levelName.toLowerCase(),
      ...context,
      message,
      ...(error && { error: error.stack || error.message }),
      ...(meta && meta !== context && { metadata: meta })
    };
    
    const logString = JSON.stringify(logEntry);
    
    if (this.config.enableConsole !== false) {
      // Output to stderr to avoid mixing with command output
      console.error(logString);
    }
    
    if (this.config.enableFile && this.config.filePath) {
      await this.writeToFile(logString + '\n');
    }
  }

  debug(contextOrMessage: LogContext | string, messageOrError?: string | Error, metadata?: any): void {
    this.log(LogLevel.DEBUG, contextOrMessage, messageOrError, metadata).catch(() => {});
  }

  info(contextOrMessage: LogContext | string, messageOrError?: string | Error, metadata?: any): void {
    this.log(LogLevel.INFO, contextOrMessage, messageOrError, metadata).catch(() => {});
  }

  warn(contextOrMessage: LogContext | string, messageOrError?: string | Error, metadata?: any): void {
    this.log(LogLevel.WARN, contextOrMessage, messageOrError, metadata).catch(() => {});
  }

  error(contextOrMessage: LogContext | string, messageOrError?: string | Error, metadata?: any): void {
    this.log(LogLevel.ERROR, contextOrMessage, messageOrError, metadata).catch(() => {});
  }

  async close(): Promise<void> {
    if (this.fileStream) {
      try {
        await this.fileStream.close();
        this.fileStream = undefined;
      } catch (error) {
        console.error(`Failed to close log file: ${error}`);
      }
    }
  }
}

// Global configuration
let globalConfig: LoggerConfig = {
  level: LogLevel.INFO,
  enableConsole: true,
  enableFile: false,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  rotateOnSize: true
};

// Track all created loggers for cleanup
const activeLoggers = new Set<Logger>();

// Initialize logger with global configuration
export function initializeLogger(config: LoggerConfig): Logger {
  globalConfig = { ...globalConfig, ...config };
  const logger = new Logger('Main', globalConfig);
  activeLoggers.add(logger);
  return logger;
}

// Factory function to create module-specific loggers
export function getLogger(module: string, config?: LoggerConfig): Logger {
  const logger = new Logger(module, config);
  activeLoggers.add(logger);
  return logger;
}

// Cleanup function to close all file handles
export async function closeAllLoggers(): Promise<void> {
  const closePromises = Array.from(activeLoggers).map(logger => logger.close());
  await Promise.all(closePromises);
  activeLoggers.clear();
}

// Handle process termination
process.on('exit', () => {
  closeAllLoggers().catch(() => {});
});

// Default logger instance
const defaultLogger = new Logger('Default');
activeLoggers.add(defaultLogger);
export default defaultLogger;