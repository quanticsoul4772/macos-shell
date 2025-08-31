/**
 * Input Validator Module
 * Provides comprehensive validation for tool parameters
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { z } from 'zod';
import { getLogger } from './logger.js';

const logger = getLogger('input-validator');

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  sanitized?: unknown;
}

export class InputValidator {
  // Path validation patterns
  private static readonly DANGEROUS_PATHS = [
    /^\/etc\//,
    /^\/sys\//,
    /^\/proc\//,
    /\/\.\.\//,
    /\/\.git\//,
  ];

  private static readonly MAX_PATH_LENGTH = 4096;
  private static readonly MAX_COMMAND_LENGTH = 32768;
  private static readonly MAX_ENV_VAR_LENGTH = 131072;
  private static readonly MAX_TIMEOUT = 600000; // 10 minutes

  /**
   * Validate a file path
   */
  static async validatePath(
    inputPath: string, 
    options?: {
      mustExist?: boolean;
      allowSymlinks?: boolean;
      checkWritable?: boolean;
      basePath?: string;
    }
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check path length
    if (inputPath.length > this.MAX_PATH_LENGTH) {
      errors.push(`Path exceeds maximum length of ${this.MAX_PATH_LENGTH} characters`);
    }

    // Check for null bytes
    if (inputPath.includes('\0')) {
      errors.push('Path contains null bytes');
    }

    // Normalize and resolve path
    let resolvedPath: string;
    try {
      resolvedPath = path.resolve(inputPath);
    } catch (error) {
      errors.push(`Invalid path format: ${error}`);
      return { isValid: false, errors, warnings };
    }

    // Check for dangerous paths
    for (const pattern of this.DANGEROUS_PATHS) {
      if (pattern.test(resolvedPath)) {
        warnings.push(`Path points to sensitive system directory: ${resolvedPath}`);
      }
    }

    // Check if path escapes base path
    if (options?.basePath) {
      const basePath = path.resolve(options.basePath);
      if (!resolvedPath.startsWith(basePath)) {
        errors.push(`Path escapes base directory: ${basePath}`);
      }
    }

    // Check existence if required
    if (options?.mustExist) {
      try {
        const stats = await fs.stat(resolvedPath);
        
        // Check symlink if not allowed
        if (!options.allowSymlinks && stats.isSymbolicLink()) {
          errors.push('Symbolic links are not allowed');
        }

        // Check writability if required
        if (options.checkWritable) {
          try {
            await fs.access(resolvedPath, fs.constants.W_OK);
          } catch {
            errors.push('Path is not writable');
          }
        }
      } catch (error) {
        errors.push(`Path does not exist: ${resolvedPath}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitized: resolvedPath,
    };
  }

  /**
   * Validate a command string
   */
  static validateCommand(command: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check command length
    if (command.length > this.MAX_COMMAND_LENGTH) {
      errors.push(`Command exceeds maximum length of ${this.MAX_COMMAND_LENGTH} characters`);
    }

    // Check for empty command
    if (!command.trim()) {
      errors.push('Command cannot be empty');
    }

    // Check for null bytes
    if (command.includes('\0')) {
      errors.push('Command contains null bytes');
    }

    // Warn about potentially dangerous commands
    const dangerousCommands = [
      /rm\s+-rf\s+\//i,
      /mkfs/i,
      /dd\s+if=/i,
      /format\s+/i,
    ];

    for (const pattern of dangerousCommands) {
      if (pattern.test(command)) {
        warnings.push('Command appears to perform dangerous system operations');
      }
    }

    // Sanitize command (remove leading/trailing whitespace)
    const sanitized = command.trim();

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitized,
    };
  }

  /**
   * Validate environment variables
   */
  static validateEnvironment(env: Record<string, string>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sanitized: Record<string, string> = {};

    // Check total size
    const totalSize = Object.entries(env).reduce(
      (sum, [key, value]) => sum + key.length + value.length,
      0
    );

    if (totalSize > this.MAX_ENV_VAR_LENGTH) {
      errors.push(`Environment variables exceed maximum size of ${this.MAX_ENV_VAR_LENGTH} bytes`);
    }

    // Validate each environment variable
    for (const [key, value] of Object.entries(env)) {
      // Check key format
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        errors.push(`Invalid environment variable name: ${key}`);
        continue;
      }

      // Check for null bytes
      if (value.includes('\0')) {
        errors.push(`Environment variable ${key} contains null bytes`);
        continue;
      }

      // Warn about sensitive variables
      const sensitiveVars = ['PASSWORD', 'TOKEN', 'SECRET', 'KEY', 'API'];
      if (sensitiveVars.some(sensitive => key.toUpperCase().includes(sensitive))) {
        warnings.push(`Environment variable ${key} may contain sensitive data`);
      }

      sanitized[key] = value;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitized,
    };
  }

  /**
   * Validate timeout value
   */
  static validateTimeout(timeout: number): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Number.isInteger(timeout) || timeout < 0) {
      errors.push('Timeout must be a positive integer');
    }

    if (timeout > this.MAX_TIMEOUT) {
      errors.push(`Timeout exceeds maximum of ${this.MAX_TIMEOUT}ms (10 minutes)`);
    }

    if (timeout < 100) {
      warnings.push('Timeout is very short (<100ms), command may not complete');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitized: Math.min(Math.max(0, timeout), this.MAX_TIMEOUT),
    };
  }

  /**
   * Validate session name
   */
  static validateSessionName(name: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!name.trim()) {
      errors.push('Session name cannot be empty');
    }

    if (name.length > 255) {
      errors.push('Session name exceeds maximum length of 255 characters');
    }

    if (!/^[A-Za-z0-9_\-\.]+$/.test(name)) {
      errors.push('Session name contains invalid characters (use only letters, numbers, _, -, .)');
    }

    const sanitized = name.trim().replace(/[^A-Za-z0-9_\-\.]/g, '_');

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      sanitized,
    };
  }

  /**
   * Create a Zod schema with custom validation
   */
  static createSchema<T extends z.ZodTypeAny>(
    baseSchema: T,
    customValidator?: (value: z.infer<T>) => ValidationResult
  ): z.ZodEffects<T> {
    return baseSchema.refine(
      (value) => {
        if (customValidator) {
          const result = customValidator(value);
          if (!result.isValid) {
            logger.warn({
              module: 'input-validator',
              action: 'schema-validation-failed',
              errors: result.errors,
            }, 'Schema validation failed');
            return false;
          }
        }
        return true;
      },
      {
        message: 'Custom validation failed',
      }
    );
  }

  /**
   * Validate array bounds
   */
  static validateArrayBounds<T>(
    array: T[],
    options: {
      minLength?: number;
      maxLength?: number;
      uniqueItems?: boolean;
    }
  ): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (options.minLength !== undefined && array.length < options.minLength) {
      errors.push(`Array must contain at least ${options.minLength} items`);
    }

    if (options.maxLength !== undefined && array.length > options.maxLength) {
      errors.push(`Array cannot contain more than ${options.maxLength} items`);
    }

    if (options.uniqueItems) {
      const uniqueSet = new Set(array.map(item => JSON.stringify(item)));
      if (uniqueSet.size !== array.length) {
        errors.push('Array contains duplicate items');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Batch validate multiple inputs
   */
  static async batchValidate(
    validations: Array<() => Promise<ValidationResult> | ValidationResult>
  ): Promise<ValidationResult> {
    const results = await Promise.all(
      validations.map(validation => 
        Promise.resolve(validation())
      )
    );

    const allErrors: string[] = [];
    const allWarnings: string[] = [];
    let allValid = true;

    for (const result of results) {
      if (!result.isValid) {
        allValid = false;
      }
      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    }

    return {
      isValid: allValid,
      errors: allErrors,
      warnings: allWarnings,
    };
  }
}

// Export convenience validators
export const validators = {
  path: InputValidator.validatePath,
  command: InputValidator.validateCommand,
  environment: InputValidator.validateEnvironment,
  timeout: InputValidator.validateTimeout,
  sessionName: InputValidator.validateSessionName,
  array: InputValidator.validateArrayBounds,
  batch: InputValidator.batchValidate,
};