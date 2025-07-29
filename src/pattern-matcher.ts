// Pattern Matcher - Proof of Concept Implementation
// This file demonstrates how the PatternMatcher class would work

import { OutputLine } from './background-process.js';
import { LRUCache } from './utils/lru-cache.js';

// Types and Enums
export enum PatternType {
  TEXT = "text",
  REGEX = "regex",
  GLOB = "glob"
}

export interface MatchOptions {
  caseSensitive?: boolean;
  invertMatch?: boolean;
  maxMatches?: number;
  extractGroups?: boolean;
  contextLines?: number;
}

export interface PatternMatch {
  line: OutputLine;
  matches: RegExpMatchArray | null;
  captureGroups?: Record<string, string>;
  matchedText?: string;
  startIndex?: number;
  endIndex?: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  complexity?: number; // For regex complexity scoring
}

/**
 * PatternMatcher - Central pattern matching engine
 * Supports text, regex, and glob pattern matching with safety features
 */
export class PatternMatcher {
  private compiledPatterns: LRUCache<string, RegExp>;
  private readonly maxRegexExecutionTime = 1000; // 1 second timeout
  private readonly maxPatternLength = 1000;
  
  constructor(private patternType: PatternType) {
    // Use LRU cache to prevent unbounded memory growth
    this.compiledPatterns = new LRUCache<string, RegExp>(100);
  }
  
  /**
   * Validate a pattern before use
   */
  validate(pattern: string): ValidationResult {
    if (!pattern || pattern.length === 0) {
      return { valid: false, error: "Pattern cannot be empty" };
    }
    
    if (pattern.length > this.maxPatternLength) {
      return { valid: false, error: `Pattern too long (max ${this.maxPatternLength} characters)` };
    }
    
    switch (this.patternType) {
      case PatternType.TEXT:
        // Text patterns are always valid
        return { valid: true, complexity: 1 };
        
      case PatternType.REGEX:
        try {
          // Test regex compilation
          new RegExp(pattern);
          
          // Check for dangerous patterns
          const complexity = this.calculateRegexComplexity(pattern);
          if (complexity > 100) {
            return { 
              valid: false, 
              error: "Pattern too complex - may cause performance issues",
              complexity 
            };
          }
          
          return { valid: true, complexity };
        } catch (e) {
          return { valid: false, error: `Invalid regex: ${e instanceof Error ? e.message : String(e)}` };
        }
        
      case PatternType.GLOB:
        // Convert glob to regex for validation
        const regexPattern = this.globToRegex(pattern);
        try {
          new RegExp(regexPattern);
          return { valid: true, complexity: 2 };
        } catch (e) {
          return { valid: false, error: `Invalid glob pattern: ${e instanceof Error ? e.message : String(e)}` };
        }
        
      default:
        return { valid: false, error: "Unknown pattern type" };
    }
  }
  
  /**
   * Match a single line against a pattern
   */
  match(line: string, pattern: string, options?: MatchOptions): PatternMatch | null {
    const validation = this.validate(pattern);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    
    const caseSensitive = options?.caseSensitive ?? true;
    let isMatch = false;
    let matches: RegExpMatchArray | null = null;
    let captureGroups: Record<string, string> | undefined;
    let matchedText: string | undefined;
    let startIndex: number | undefined;
    let endIndex: number | undefined;
    
    switch (this.patternType) {
      case PatternType.TEXT:
        // Simple text search
        const searchLine = caseSensitive ? line : line.toLowerCase();
        const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();
        const index = searchLine.indexOf(searchPattern);
        
        isMatch = index !== -1;
        if (isMatch) {
          matchedText = line.substring(index, index + pattern.length);
          startIndex = index;
          endIndex = index + pattern.length;
        }
        break;
        
      case PatternType.REGEX:
        // Regex matching with timeout protection
        const regex = this.getCompiledRegex(pattern, caseSensitive);
        
        try {
          // Use a timeout wrapper for regex execution
          const timeoutPromise = new Promise<RegExpMatchArray | null>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Regex execution timeout'));
            }, this.maxRegexExecutionTime);
            
            try {
              const result = line.match(regex);
              clearTimeout(timeout);
              resolve(result);
            } catch (e) {
              clearTimeout(timeout);
              reject(e);
            }
          });
          
          // For proof of concept, we'll use synchronous matching
          // In real implementation, this would be async
          matches = line.match(regex);
          isMatch = matches !== null;
          
          if (isMatch && matches && options?.extractGroups) {
            captureGroups = {};
            for (let i = 1; i < matches.length; i++) {
              if (matches[i] !== undefined) {
                captureGroups[i.toString()] = matches[i];
              }
            }
            matchedText = matches[0];
            startIndex = matches.index;
            endIndex = startIndex !== undefined ? startIndex + matches[0].length : undefined;
          }
        } catch (e) {
          throw new Error(`Regex matching failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        break;
        
      case PatternType.GLOB:
        // Convert glob to regex and match
        const globRegexPattern = this.globToRegex(pattern);
        const globRegex = this.getCompiledRegex(globRegexPattern, caseSensitive);
        matches = line.match(globRegex);
        isMatch = matches !== null;
        
        if (isMatch && matches) {
          matchedText = matches[0];
          startIndex = matches.index;
          endIndex = startIndex !== undefined ? startIndex + matches[0].length : undefined;
        }
        break;
    }
    
    // Handle inverted matching
    if (options?.invertMatch) {
      isMatch = !isMatch;
    }
    
    if (!isMatch) {
      return null;
    }
    
    // Create a mock OutputLine for the match
    // In real implementation, this would use the actual OutputLine
    const outputLine: OutputLine = {
      timestamp: new Date(),
      type: 'stdout',
      content: line,
      lineNumber: 0 // Would be provided by caller
    };
    
    return {
      line: outputLine,
      matches,
      captureGroups,
      matchedText,
      startIndex,
      endIndex
    };
  }
  
  /**
   * Match multiple lines against a pattern
   */
  matchMultiple(
    lines: OutputLine[], 
    pattern: string, 
    options?: MatchOptions
  ): PatternMatch[] {
    const results: PatternMatch[] = [];
    const maxMatches = options?.maxMatches ?? Infinity;
    
    for (const line of lines) {
      if (results.length >= maxMatches) {
        break;
      }
      
      const match = this.match(line.content, pattern, options);
      if (match) {
        // Update the line reference to the actual OutputLine
        match.line = line;
        results.push(match);
      }
    }
    
    return results;
  }
  
  /**
   * Match with context lines
   */
  matchWithContext(
    lines: OutputLine[],
    pattern: string,
    options?: MatchOptions
  ): Array<{
    match: PatternMatch;
    contextBefore: OutputLine[];
    contextAfter: OutputLine[];
  }> {
    const contextLines = options?.contextLines ?? 0;
    const matches = this.matchMultiple(lines, pattern, options);
    
    return matches.map(match => {
      const index = lines.findIndex(l => l.lineNumber === match.line.lineNumber);
      const contextBefore = lines.slice(
        Math.max(0, index - contextLines),
        index
      );
      const contextAfter = lines.slice(
        index + 1,
        Math.min(lines.length, index + 1 + contextLines)
      );
      
      return { match, contextBefore, contextAfter };
    });
  }
  
  /**
   * Get or compile a regex pattern
   */
  private getCompiledRegex(pattern: string, caseSensitive: boolean): RegExp {
    const key = `${pattern}:${caseSensitive}`;
    
    let regex = this.compiledPatterns.get(key);
    if (!regex) {
      const flags = caseSensitive ? 'g' : 'gi';
      regex = new RegExp(pattern, flags);
      this.compiledPatterns.set(key, regex);
    }
    
    return regex;
  }
  
  /**
   * Convert glob pattern to regex
   */
  private globToRegex(glob: string): string {
    // Escape regex special characters except glob ones
    let regex = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    
    // Convert glob patterns
    regex = regex
      .replace(/\*/g, '.*')      // * matches any characters
      .replace(/\?/g, '.')       // ? matches single character
      .replace(/\[!/g, '[^')     // [!...] becomes [^...]
      .replace(/\[/g, '[')       // Character classes
      .replace(/\]/g, ']');
    
    return `^${regex}$`;
  }
  
  /**
   * Calculate regex complexity for safety
   */
  private calculateRegexComplexity(pattern: string): number {
    let complexity = pattern.length;
    
    // Penalize potentially expensive operations
    const expensivePatterns = [
      /(\.\*){2,}/g,           // Multiple .* in sequence
      /(\.\+){2,}/g,           // Multiple .+ in sequence
      /(\[[^\]]+\]){3,}/g,     // Many character classes
      /(\([^)]+\)){5,}/g,      // Many capture groups
      /\\[dswDSW]\*/g,         // Unbounded character class matches
      /\{(\d+,|,\d+)\}/g,      // Large or unbounded quantifiers
    ];
    
    for (const expensive of expensivePatterns) {
      const matches = pattern.match(expensive);
      if (matches) {
        complexity += matches.length * 20;
      }
    }
    
    // Penalize nested quantifiers
    if (/(\*|\+|\{[^}]+\}){2,}/.test(pattern)) {
      complexity += 50;
    }
    
    return complexity;
  }
  
  /**
   * Clear pattern cache
   */
  clearCache(): void {
    this.compiledPatterns.clear();
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; capacity: number } {
    return {
      size: this.compiledPatterns.size(),
      capacity: 100
    };
  }
}

// Export factory function for creating matchers
export function createPatternMatcher(type: PatternType): PatternMatcher {
  return new PatternMatcher(type);
}

// Example usage functions
export function demonstrateTextMatching(): void {
  const matcher = createPatternMatcher(PatternType.TEXT);
  
  const lines: OutputLine[] = [
    { timestamp: new Date(), type: 'stdout', content: 'Server started successfully', lineNumber: 1 },
    { timestamp: new Date(), type: 'stdout', content: 'ERROR: Database connection failed', lineNumber: 2 },
    { timestamp: new Date(), type: 'stderr', content: 'Warning: Low memory', lineNumber: 3 },
  ];
  
  // Find all lines containing "ERROR"
  const matches = matcher.matchMultiple(lines, 'ERROR');
  console.log('Text matches:', matches.length);
}

export function demonstrateRegexMatching(): void {
  const matcher = createPatternMatcher(PatternType.REGEX);
  
  const line = 'Request to /api/users completed in 1523ms';
  const pattern = 'Request to (.+) completed in (\\d+)ms';
  
  const match = matcher.match(line, pattern, { extractGroups: true });
  if (match && match.captureGroups) {
    console.log('Endpoint:', match.captureGroups['1']); // /api/users
    console.log('Duration:', match.captureGroups['2']); // 1523
  }
}

export function demonstrateGlobMatching(): void {
  const matcher = createPatternMatcher(PatternType.GLOB);
  
  const files = [
    'server.log',
    'error.log',
    'access.log.1',
    'debug.txt',
    'readme.md'
  ];
  
  // Match all .log files
  const pattern = '*.log*';
  const matches = files.filter(file => 
    matcher.match(file, pattern) !== null
  );
  
  console.log('Log files:', matches);
}
