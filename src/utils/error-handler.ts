/**
 * Enhanced Error Handler
 * Provides comprehensive error handling, recovery, and reporting
 */

import { ExecaError } from 'execa';
import { getLogger } from './logger.js';
import { 
  CommandErrorCode, 
  EnhancedError, 
  ExecutionContext,
  ExecutionError,
  isExecaError,
  isExecutionError
} from '../types/command.types.js';

const logger = getLogger('error-handler');

export interface ErrorRecoveryStrategy {
  shouldRetry: boolean;
  correctedCommand?: string;
  delay?: number;
  suggestion?: string;
  maxRetries?: number;
}

export class ErrorHandler {
  private static readonly ERROR_PATTERNS = new Map<RegExp, CommandErrorCode>([
    [/command not found/i, CommandErrorCode.COMMAND_NOT_FOUND],
    [/permission denied/i, CommandErrorCode.PERMISSION_DENIED],
    [/timeout|timed out/i, CommandErrorCode.TIMEOUT],
    [/network|connection|refused/i, CommandErrorCode.NETWORK_ERROR],
    [/resource temporarily unavailable/i, CommandErrorCode.RESOURCE_LIMIT],
    [/validation failed/i, CommandErrorCode.VALIDATION_ERROR],
    [/script injection/i, CommandErrorCode.SCRIPT_INJECTION],
  ]);

  private static readonly RECOVERY_STRATEGIES = new Map<CommandErrorCode, (error: EnhancedError) => ErrorRecoveryStrategy>([
    [CommandErrorCode.COMMAND_NOT_FOUND, ErrorHandler.handleCommandNotFound],
    [CommandErrorCode.PERMISSION_DENIED, ErrorHandler.handlePermissionDenied],
    [CommandErrorCode.TIMEOUT, ErrorHandler.handleTimeout],
    [CommandErrorCode.NETWORK_ERROR, ErrorHandler.handleNetworkError],
    [CommandErrorCode.RESOURCE_LIMIT, ErrorHandler.handleResourceLimit],
  ]);

  /**
   * Enhance an error with additional context and type information
   */
  static enhanceError(
    error: unknown, 
    context?: Partial<ExecutionContext>
  ): EnhancedError {
    let baseError: ExecutionError;
    
    if (isExecaError(error)) {
      baseError = {
        name: 'ExecutionError',
        message: error.message,
        code: error.code,
        exitCode: error.exitCode ?? undefined,
        stdout: typeof error.stdout === 'string' ? error.stdout : undefined,
        stderr: typeof error.stderr === 'string' ? error.stderr : undefined,
        command: error.command,
        timedOut: error.timedOut,
      };
    } else if (isExecutionError(error)) {
      baseError = error;
    } else if (error instanceof Error) {
      baseError = {
        name: 'ExecutionError',
        message: error.message,
      };
    } else {
      baseError = {
        name: 'ExecutionError',
        message: String(error),
      };
    }

    const errorCode = ErrorHandler.identifyErrorCode(baseError);
    const recoveryStrategy = ErrorHandler.getRecoveryStrategy(errorCode, baseError);

    const enhancedError: EnhancedError = {
      ...baseError,
      errorCode,
      suggestion: recoveryStrategy.suggestion,
      recoverable: recoveryStrategy.shouldRetry,
      context: context as ExecutionContext,
    };

    // Log the enhanced error
    logger.error({
      module: 'error-handler',
      action: 'enhance-error',
      errorCode,
      recoverable: enhancedError.recoverable,
      command: enhancedError.command,
      exitCode: enhancedError.exitCode,
    }, `Enhanced error: ${enhancedError.message}`);

    return enhancedError;
  }

  /**
   * Identify the error code based on error message and properties
   */
  private static identifyErrorCode(error: ExecutionError): CommandErrorCode {
    // Check exit codes first
    if (error.exitCode === 126) return CommandErrorCode.PERMISSION_DENIED;
    if (error.exitCode === 127) return CommandErrorCode.COMMAND_NOT_FOUND;
    if (error.timedOut) return CommandErrorCode.TIMEOUT;

    // Check error message patterns
    const errorMessage = `${error.message} ${error.stderr || ''}`.toLowerCase();
    
    for (const [pattern, code] of ErrorHandler.ERROR_PATTERNS) {
      if (pattern.test(errorMessage)) {
        return code;
      }
    }

    return CommandErrorCode.UNKNOWN;
  }

  /**
   * Get recovery strategy for an error
   */
  static getRecoveryStrategy(
    errorCode: CommandErrorCode, 
    error: ExecutionError
  ): ErrorRecoveryStrategy {
    const strategyFn = ErrorHandler.RECOVERY_STRATEGIES.get(errorCode);
    
    if (strategyFn) {
      const enhancedError: EnhancedError = {
        ...error,
        errorCode,
      };
      return strategyFn(enhancedError);
    }

    return {
      shouldRetry: false,
      suggestion: 'No automatic recovery available for this error',
    };
  }

  /**
   * Handle command not found errors
   */
  private static handleCommandNotFound(error: EnhancedError): ErrorRecoveryStrategy {
    const command = error.command?.split(' ')[0] || '';
    
    // Common command alternatives
    const alternatives = new Map<string, string>([
      ['python', 'python3'],
      ['pip', 'pip3'],
      ['node', 'nodejs'],
      ['g++', 'g++-11'],
      ['gcc', 'gcc-11'],
    ]);

    const alternative = alternatives.get(command);
    
    if (alternative) {
      return {
        shouldRetry: true,
        correctedCommand: error.command?.replace(command, alternative),
        suggestion: `Command '${command}' not found. Trying '${alternative}' instead.`,
        maxRetries: 1,
      };
    }

    return {
      shouldRetry: false,
      suggestion: `Command '${command}' not found. Please ensure it is installed and in your PATH.`,
    };
  }

  /**
   * Handle permission denied errors
   */
  private static handlePermissionDenied(error: EnhancedError): ErrorRecoveryStrategy {
    const needsSudo = !error.command?.startsWith('sudo');
    
    if (needsSudo) {
      return {
        shouldRetry: false, // Don't auto-retry with sudo for security
        suggestion: `Permission denied. You may need to run this command with 'sudo'.`,
      };
    }

    return {
      shouldRetry: false,
      suggestion: 'Permission denied even with sudo. Check file permissions and ownership.',
    };
  }

  /**
   * Handle timeout errors
   */
  private static handleTimeout(error: EnhancedError): ErrorRecoveryStrategy {
    const currentTimeout = error.context?.maxAttempts || 30000;
    const newTimeout = Math.min(currentTimeout * 2, 600000); // Max 10 minutes

    return {
      shouldRetry: true,
      delay: 1000,
      suggestion: `Command timed out after ${currentTimeout}ms. Retrying with ${newTimeout}ms timeout.`,
      maxRetries: 1,
    };
  }

  /**
   * Handle network errors
   */
  private static handleNetworkError(error: EnhancedError): ErrorRecoveryStrategy {
    const attempt = error.context?.attempt || 1;
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000); // Exponential backoff

    return {
      shouldRetry: attempt < 3,
      delay,
      suggestion: `Network error. Retrying in ${delay}ms (attempt ${attempt}/3).`,
      maxRetries: 3,
    };
  }

  /**
   * Handle resource limit errors
   */
  private static handleResourceLimit(error: EnhancedError): ErrorRecoveryStrategy {
    return {
      shouldRetry: true,
      delay: 5000,
      suggestion: 'Resource temporarily unavailable. Waiting 5 seconds before retry.',
      maxRetries: 2,
    };
  }

  /**
   * Format error for user display
   */
  static formatError(error: EnhancedError): string {
    const parts: string[] = [];

    parts.push(`Error: ${error.message}`);
    
    if (error.errorCode !== CommandErrorCode.UNKNOWN) {
      parts.push(`Type: ${error.errorCode}`);
    }

    if (error.exitCode !== undefined) {
      parts.push(`Exit Code: ${error.exitCode}`);
    }

    if (error.command) {
      parts.push(`Command: ${error.command}`);
    }

    if (error.suggestion) {
      parts.push(`Suggestion: ${error.suggestion}`);
    }

    if (error.stderr && error.stderr.trim()) {
      parts.push(`Details: ${error.stderr.trim()}`);
    }

    return parts.join('\n');
  }

  /**
   * Create a sanitized error response for external consumption
   */
  static sanitizeError(error: EnhancedError): Record<string, unknown> {
    return {
      error: true,
      code: error.errorCode,
      message: error.message,
      suggestion: error.suggestion,
      recoverable: error.recoverable,
      exitCode: error.exitCode,
      // Don't expose internal paths or sensitive data
      command: error.command?.split(' ')[0], // Only show command name
    };
  }
}

// Export singleton instance for convenience
export const errorHandler = new ErrorHandler();