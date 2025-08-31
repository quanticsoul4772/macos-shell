/**
 * Script Validation and Sanitization Module
 * Provides security validation for shell scripts to prevent injection attacks
 */

import { getLogger } from './logger.js';

const logger = getLogger('script-validator');

export interface ValidationResult {
  isValid: boolean;
  sanitizedScript?: string;
  errors: string[];
  warnings: string[];
}

export class ScriptValidator {
  // Dangerous patterns that could lead to security issues
  private static readonly DANGEROUS_PATTERNS = [
    // Command substitution attempts that could execute arbitrary code
    /\$\(.*rm\s+-rf.*\)/gi,
    /`.*rm\s+-rf.*`/gi,
    
    // Dangerous rm commands targeting root or home specifically
    /rm\s+-rf\s+\/(?:\s|$)/gi,
    /rm\s+-rf\s+\/home/gi,
    /rm\s+-rf\s+\/\*/gi,
    
    // Attempts to access sensitive files
    /\/etc\/shadow/gi,
    /\/etc\/passwd.*>>/gi,
    /\.ssh\/id_[rd]sa/gi,
    
    // Network utilities that could be used maliciously
    /nc\s+-l.*-e\s+\/bin\/(ba)?sh/gi,
    /bash\s+-i.*>&.*\/dev\/tcp/gi,
    
    // Attempts to modify system files
    />\s*\/etc\//gi,
    />>\s*\/etc\//gi,
    
    // Cryptocurrency mining patterns
    /xmrig|minergate|cryptonight/gi,
    
    // Attempts to download and execute scripts
    /curl.*\|.*sh/gi,
    /wget.*\|.*bash/gi,
    /curl.*-s.*\|.*sudo/gi,
  ];

  // Patterns that should trigger warnings but not block execution
  private static readonly WARNING_PATTERNS = [
    /sudo/gi,
    /chmod\s+777/gi,
    /rm\s+-rf/gi,
    /\/dev\/null\s+2>&1/gi,
    />\/dev\/null/gi,
  ];

  // Maximum script size (1MB)
  private static readonly MAX_SCRIPT_SIZE = 1024 * 1024;

  // Maximum line length
  private static readonly MAX_LINE_LENGTH = 4096;

  /**
   * Validate a shell script for security issues
   */
  static validate(script: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check script size
    if (script.length > this.MAX_SCRIPT_SIZE) {
      errors.push(`Script exceeds maximum size of ${this.MAX_SCRIPT_SIZE} bytes`);
      return { isValid: false, errors, warnings };
    }

    // Check for empty script
    if (!script.trim()) {
      errors.push('Script is empty');
      return { isValid: false, errors, warnings };
    }

    // Check line lengths
    const lines = script.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > this.MAX_LINE_LENGTH) {
        errors.push(`Line ${i + 1} exceeds maximum length of ${this.MAX_LINE_LENGTH} characters`);
      }
    }

    // Check for dangerous patterns
    for (const pattern of this.DANGEROUS_PATTERNS) {
      const matches = script.match(pattern);
      if (matches) {
        errors.push(`Dangerous pattern detected: ${matches[0]}`);
        logger.warn({ 
          module: 'script-validator', 
          action: 'dangerous-pattern', 
          pattern: pattern.source,
          match: matches[0] 
        }, 'Dangerous pattern detected in script');
      }
    }

    // Check for warning patterns
    for (const pattern of this.WARNING_PATTERNS) {
      const matches = script.match(pattern);
      if (matches) {
        warnings.push(`Potentially dangerous command: ${matches[0]}`);
      }
    }

    // Check for null bytes (can cause issues with file systems)
    if (script.includes('\0')) {
      errors.push('Script contains null bytes');
    }

    // Check for excessive backticks or command substitutions
    const commandSubstitutions = (script.match(/\$\(/g) || []).length + 
                                 (script.match(/`/g) || []).length;
    if (commandSubstitutions > 50) {
      warnings.push(`Script contains ${commandSubstitutions} command substitutions, which seems excessive`);
    }

    // Validate shebang if present
    if (lines[0] && lines[0].startsWith('#!')) {
      const shebang = lines[0];
      if (!this.isValidShebang(shebang)) {
        warnings.push(`Unusual shebang: ${shebang}`);
      }
    }

    const isValid = errors.length === 0;

    if (!isValid) {
      logger.error({ 
        module: 'script-validator', 
        action: 'validation-failed',
        errors,
        warnings,
        scriptLength: script.length,
        lineCount: lines.length
      }, 'Script validation failed');
    } else if (warnings.length > 0) {
      logger.warn({ 
        module: 'script-validator', 
        action: 'validation-warnings',
        warnings,
        scriptLength: script.length,
        lineCount: lines.length
      }, 'Script validation completed with warnings');
    }

    return {
      isValid,
      sanitizedScript: isValid ? this.sanitize(script) : undefined,
      errors,
      warnings
    };
  }

  /**
   * Sanitize a script by escaping potentially dangerous characters
   * This is a additional safety layer after validation
   */
  private static sanitize(script: string): string {
    // Remove any Unicode direction override characters
    let sanitized = script.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');

    // Ensure proper line endings
    sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove trailing whitespace from lines (can hide malicious code)
    sanitized = sanitized.split('\n').map(line => line.trimEnd()).join('\n');

    return sanitized;
  }

  /**
   * Check if a shebang is valid and safe
   */
  private static isValidShebang(shebang: string): boolean {
    const validShebangs = [
      /^#!\/bin\/(ba)?sh$/,
      /^#!\/bin\/zsh$/,
      /^#!\/usr\/bin\/env\s+(bash|sh|zsh)$/,
      /^#!\/bin\/bash$/,
      /^#!\/usr\/bin\/bash$/,
      /^#!\/usr\/bin\/zsh$/,
    ];

    return validShebangs.some(pattern => pattern.test(shebang));
  }

  /**
   * Check if script contains only safe commands (whitelist approach)
   * This is more restrictive and can be used for high-security contexts
   */
  static isSafeScript(script: string): boolean {
    const safeCommands = [
      'echo', 'printf', 'cat', 'ls', 'pwd', 'cd', 'mkdir', 'touch',
      'cp', 'mv', 'date', 'whoami', 'hostname', 'uname', 'which',
      'env', 'export', 'source', 'alias', 'unalias', 'type', 'read',
      'if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for',
      'while', 'do', 'done', 'function', 'return', 'local', 'declare',
      'true', 'false', 'test'
    ];

    // List of explicitly unsafe commands
    const unsafeCommands = [
      'curl', 'wget', 'nc', 'netcat', 'ssh', 'scp', 'rsync', 'ftp',
      'telnet', 'nmap', 'ping', 'traceroute', 'dig', 'nslookup',
      'git', 'svn', 'hg', 'apt', 'apt-get', 'yum', 'brew', 'npm',
      'pip', 'gem', 'cargo', 'docker', 'kubectl', 'terraform',
      'rm', 'dd', 'mkfs', 'fdisk', 'mount', 'umount', 'kill', 'pkill',
      'sudo', 'su', 'chown', 'chmod', 'systemctl', 'service'
    ];

    // Extract potential commands (simple tokenization)
    // This regex finds words that could be commands (not in quotes, not variables)
    const commandPattern = /(?:^|\s|;|\||&&|\|\|)([a-zA-Z][\w-]*)/g;
    const matches = [...script.matchAll(commandPattern)];
    
    for (const match of matches) {
      const cmd = match[1].toLowerCase();
      
      // Explicitly check for unsafe commands first
      if (unsafeCommands.includes(cmd)) {
        return false;
      }
      
      // Skip if it's a safe command
      if (safeCommands.includes(cmd)) continue;
      
      // Skip common shell constructs
      if (['[', ']', '[[', ']]', '{', '}'].includes(cmd)) continue;
      
      // Allow variable-like names but be more restrictive
      // Only allow if it truly looks like a variable (no hyphens, etc)
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(match[1]) && !cmd.includes('-')) {
        continue;
      }
      
      // Otherwise, it's not safe
      return false;
    }

    return true;
  }
}

export default ScriptValidator;