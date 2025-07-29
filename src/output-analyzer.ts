import { CacheStrategy } from './ai-cache-classifier.js';
import logger from './utils/logger.js';

interface AnalysisResult {
  hasTimestamp: boolean;
  hasProcessId: boolean;
  hasCounter: boolean;
  hasFileSize: boolean;
  hasIpAddress: boolean;
  hasPort: boolean;
  changeIndicators: string[];
  suggestedStrategy: CacheStrategy;
  confidence: number;
}

export class OutputAnalyzer {
  // Patterns for detecting dynamic content
  private patterns = {
    // Timestamps in various formats
    timestamp: [
      /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/,  // ISO format
      /\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}/,      // Unix format
      /\d{1,2}\/\d{1,2}\/\d{4}/,                  // US date
      /\d{2}:\d{2}:\d{2}/,                         // Time only
      /\d+\s*(seconds?|minutes?|hours?|days?)\s+ago/i  // Relative time
    ],
    
    // Process IDs
    processId: [
      /\bpid[:\s]+\d+/i,
      /\bprocess\s+\d+/i,
      /^\s*\d+\s+\w+/,  // ps output format
      /\[\d+\]/         // [12345] format
    ],
    
    // Counters and sequences
    counter: [
      /\b\d+\s*(bytes?|KB|MB|GB|TB)/i,
      /\b\d+\s*(packets?|messages?|items?|files?|processes?)/i,
      /count[:\s]+\d+/i,
      /total[:\s]+\d+/i,
      /\b\d+\s*\/\s*\d+/  // x/y format
    ],
    
    // File sizes
    fileSize: [
      /\b\d+\s*(bytes?|[KMGT]B?)\b/,
      /size[:\s]+\d+/i
    ],
    
    // Network indicators
    ipAddress: [
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
      /[0-9a-f:]+:[0-9a-f:]+/i  // IPv6
    ],
    
    port: [
      /:\d{2,5}\b/,
      /port\s+\d+/i
    ]
  };
  
  /**
   * Analyze command output for dynamic content
   */
  analyze(output: string): AnalysisResult {
    const result: AnalysisResult = {
      hasTimestamp: false,
      hasProcessId: false,
      hasCounter: false,
      hasFileSize: false,
      hasIpAddress: false,
      hasPort: false,
      changeIndicators: [],
      suggestedStrategy: CacheStrategy.MEDIUM,
      confidence: 0.5
    };
    
    // Check each pattern type
    for (const [type, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(output)) {
          const fieldName = `has${type.charAt(0).toUpperCase() + type.slice(1)}` as keyof AnalysisResult;
          (result as any)[fieldName] = true;
          result.changeIndicators.push(type);
          break;
        }
      }
    }
    
    // Determine suggested strategy based on indicators
    const indicatorCount = result.changeIndicators.length;
    
    if (indicatorCount === 0) {
      result.suggestedStrategy = CacheStrategy.LONG;
      result.confidence = 0.8;
    } else if (indicatorCount === 1) {
      if (result.hasTimestamp || result.hasProcessId) {
        result.suggestedStrategy = CacheStrategy.NEVER;
        result.confidence = 0.9;
      } else {
        result.suggestedStrategy = CacheStrategy.SHORT;
        result.confidence = 0.7;
      }
    } else if (indicatorCount >= 2) {
      result.suggestedStrategy = CacheStrategy.NEVER;
      result.confidence = 0.95;
    }
    
    // Check for specific high-change patterns
    if (this.hasHighChangePattern(output)) {
      result.suggestedStrategy = CacheStrategy.NEVER;
      result.confidence = 1.0;
      result.changeIndicators.push('high-change-pattern');
    }
    
    return result;
  }
  
  /**
   * Check for patterns that indicate changing data
   */
  private hasHighChangePattern(output: string): boolean {
    const highChangePatterns = [
      /\breal-time\b/i,
      /\blive\b/i,
      /\bcurrent\b/i,
      /\bnow\b/i,
      /\bactive\b/i,
      /\brunning\b/i,
      /\bin progress\b/i,
      /\bupdating\b/i
    ];
    
    return highChangePatterns.some(pattern => pattern.test(output));
  }
  
  /**
   * Compare two outputs for differences
   */
  compareOutputs(output1: string, output2: string): {
    isDifferent: boolean;
    differences: string[];
    similarity: number;
  } {
    if (output1 === output2) {
      return {
        isDifferent: false,
        differences: [],
        similarity: 1.0
      };
    }
    
    // Split into lines for comparison
    const lines1 = output1.split('\n');
    const lines2 = output2.split('\n');
    
    const differences: string[] = [];
    let matchingLines = 0;
    
    // Simple line-by-line comparison
    const maxLines = Math.max(lines1.length, lines2.length);
    for (let i = 0; i < maxLines; i++) {
      if (lines1[i] === lines2[i]) {
        matchingLines++;
      } else {
        differences.push(`Line ${i + 1} differs`);
      }
    }
    
    const similarity = matchingLines / maxLines;
    
    return {
      isDifferent: similarity < 0.95,
      differences,
      similarity
    };
  }
}

export const outputAnalyzer = new OutputAnalyzer();
