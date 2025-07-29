// Logger Module
// Provides structured logging with levels and metadata

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
}

interface LogContext {
  module: string;
  action?: string;
  [key: string]: any;
}

class Logger {
  private config: LoggerConfig;
  
  constructor(private module: string, config?: LoggerConfig) {
    this.config = config || globalConfig;
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= (this.config.level || LogLevel.INFO);
  }

  private log(level: LogLevel, contextOrMessage: LogContext | string, messageOrError?: string | Error, metadata?: any): void {
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
    const logEntry = {
      timestamp,
      level: levelName.toLowerCase(),
      ...context,
      message,
      ...(error && { error: error.stack || error.message }),
      ...(meta && meta !== context && { metadata: meta })
    };
    
    if (this.config.enableConsole !== false) {
      // Output to stderr to avoid mixing with command output
      console.error(JSON.stringify(logEntry));
    }
    
    if (this.config.enableFile && this.config.filePath) {
      // TODO: Implement file logging if needed
    }
  }

  debug(contextOrMessage: LogContext | string, messageOrError?: string | Error, metadata?: any): void {
    this.log(LogLevel.DEBUG, contextOrMessage, messageOrError, metadata);
  }

  info(contextOrMessage: LogContext | string, messageOrError?: string | Error, metadata?: any): void {
    this.log(LogLevel.INFO, contextOrMessage, messageOrError, metadata);
  }

  warn(contextOrMessage: LogContext | string, messageOrError?: string | Error, metadata?: any): void {
    this.log(LogLevel.WARN, contextOrMessage, messageOrError, metadata);
  }

  error(contextOrMessage: LogContext | string, messageOrError?: string | Error, metadata?: any): void {
    this.log(LogLevel.ERROR, contextOrMessage, messageOrError, metadata);
  }
}

// Global configuration
let globalConfig: LoggerConfig = {
  level: LogLevel.INFO,
  enableConsole: true,
  enableFile: false
};

// Initialize logger with global configuration
export function initializeLogger(config: LoggerConfig): Logger {
  globalConfig = { ...globalConfig, ...config };
  return new Logger('Main', globalConfig);
}

// Factory function to create module-specific loggers
export function getLogger(module: string, config?: LoggerConfig): Logger {
  return new Logger(module, config);
}

// Default logger instance
const defaultLogger = new Logger('Default');
export default defaultLogger;
