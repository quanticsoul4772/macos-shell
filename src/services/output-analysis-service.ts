// Output Analysis Service
// Intelligently analyzes command output to extract insights and patterns

import { getLogger } from '../utils/logger.js';

const logger = getLogger('OutputAnalysisService');

export interface CommandOutput {
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

export interface AnalysisContext {
  cwd: string;
  recent_commands?: string[];
}

export interface ExtractedPatterns {
  urls: string[];
  file_paths: string[];
  error_codes: string[];
  warnings: string[];
  process_ids: number[];
  ip_addresses: string[];
  ports: number[];
  git_hashes: string[];
  uuids: string[];
}

export interface ActionableItem {
  type: 'error' | 'warning' | 'info';
  message: string;
  suggested_action?: string;
}

export interface FollowupSuggestion {
  command: string;
  reasoning: string;
  confidence: number;
  auto_executable: boolean;
}

export interface OutputAnalysis {
  output_type: 'error' | 'warning' | 'success' | 'info';
  key_messages: string[];
  extracted_patterns: ExtractedPatterns;
  summary: string;
  actionable_items: ActionableItem[];
  follow_up_suggestions: FollowupSuggestion[];
  confidence: number;
}

/**
 * Output Analysis Service
 * Extracts patterns, insights, and suggestions from command output
 * FAIL-FAST: All operations throw on error
 */
export class OutputAnalysisService {
  private initialized = true;

  constructor() {
    logger.info('Output analysis service initialized');
  }

  /**
   * Analyze command output
   * FAIL-FAST: Throws if analysis fails
   */
  public async analyzeOutput(
    output: CommandOutput,
    context: AnalysisContext
  ): Promise<OutputAnalysis> {
    if (!this.initialized) {
      throw new Error('FATAL: Output analysis service not initialized');
    }

    try {
      logger.debug('Analyzing command output', {
        command: output.command.substring(0, 50),
        exitCode: output.exit_code,
        stdoutLength: output.stdout.length,
        stderrLength: output.stderr.length,
      });

      // Classify output type
      const outputType = this.classifyOutput(output);

      // Extract patterns
      const patterns = this.extractPatterns(output.stdout + '\n' + output.stderr);

      // Extract key messages
      const keyMessages = this.extractKeyMessages(output, outputType);

      // Generate summary
      const summary = this.generateSummary(output, outputType, patterns);

      // Identify actionable items
      const actionableItems = this.identifyActionableItems(output, patterns);

      // Suggest follow-up commands
      const followupSuggestions = await this.suggestFollowups(
        output,
        context,
        patterns,
        outputType
      );

      // Calculate confidence
      const confidence = this.calculateConfidence(output, patterns);

      const analysis: OutputAnalysis = {
        output_type: outputType,
        key_messages: keyMessages,
        extracted_patterns: patterns,
        summary,
        actionable_items: actionableItems,
        follow_up_suggestions: followupSuggestions,
        confidence,
      };

      logger.info('Output analysis completed', {
        command: output.command.substring(0, 50),
        outputType,
        patternsFound: Object.values(patterns).reduce((sum, arr) => sum + arr.length, 0),
        followupCount: followupSuggestions.length,
      });

      return analysis;
    } catch (error: any) {
      logger.error('FATAL: Failed to analyze output', {
        command: output.command.substring(0, 50),
        error: error.message,
      });
      throw new Error(`FATAL: Output analysis failed: ${error.message}`);
    }
  }

  /**
   * Extract structured patterns from output
   */
  public extractPatterns(output: string): ExtractedPatterns {
    const patterns: ExtractedPatterns = {
      urls: [],
      file_paths: [],
      error_codes: [],
      warnings: [],
      process_ids: [],
      ip_addresses: [],
      ports: [],
      git_hashes: [],
      uuids: [],
    };

    // URLs
    const urlPattern = /https?:\/\/[^\s]+/g;
    patterns.urls = Array.from(output.matchAll(urlPattern), m => m[0]);

    // File paths
    const filePathPattern = /(?:\/[\w.-]+)+|(?:\.\/[\w.-]+)+/g;
    patterns.file_paths = Array.from(output.matchAll(filePathPattern), m => m[0]);

    // Error codes
    const errorCodePattern = /E[A-Z]+|exit code \d+/g;
    patterns.error_codes = Array.from(output.matchAll(errorCodePattern), m => m[0]);

    // Warnings
    const warningPattern = /(?:warning|warn|caution):.*/gi;
    patterns.warnings = Array.from(output.matchAll(warningPattern), m => m[0].trim());

    // Process IDs
    const pidPattern = /(?:PID|pid|process):\s*(\d+)/gi;
    patterns.process_ids = Array.from(output.matchAll(pidPattern), m => parseInt(m[1]));

    // IP addresses
    const ipPattern = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
    patterns.ip_addresses = Array.from(output.matchAll(ipPattern), m => m[0]);

    // Ports
    const portPattern = /:(\d{2,5})\b/g;
    patterns.ports = Array.from(output.matchAll(portPattern), m => parseInt(m[1]))
      .filter(p => p > 0 && p < 65536);

    // Git hashes
    const gitHashPattern = /\b[0-9a-f]{7,40}\b/g;
    patterns.git_hashes = Array.from(output.matchAll(gitHashPattern), m => m[0])
      .filter(h => h.length >= 7 && h.length <= 40);

    // UUIDs
    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    patterns.uuids = Array.from(output.matchAll(uuidPattern), m => m[0]);

    return patterns;
  }

  /**
   * Suggest follow-up commands based on output
   */
  public async suggestFollowups(
    output: CommandOutput,
    context: AnalysisContext,
    patterns: ExtractedPatterns,
    outputType: string
  ): Promise<FollowupSuggestion[]> {
    const suggestions: FollowupSuggestion[] = [];

    // Error-based suggestions
    if (outputType === 'error') {
      // Permission errors
      if (output.stderr.includes('Permission denied') || output.stderr.includes('EACCES')) {
        suggestions.push({
          command: `sudo ${output.command}`,
          reasoning: 'Permission error detected. Try with elevated privileges.',
          confidence: 0.7,
          auto_executable: false,
        });
      }

      // Command not found
      if (output.stderr.includes('command not found')) {
        const cmd = output.command.split(' ')[0];
        suggestions.push({
          command: `brew install ${cmd}`,
          reasoning: 'Command not found. Try installing with Homebrew.',
          confidence: 0.6,
          auto_executable: false,
        });
      }

      // Git errors
      if (output.command.startsWith('git')) {
        suggestions.push({
          command: 'git status',
          reasoning: 'Git command failed. Check repository status.',
          confidence: 0.8,
          auto_executable: true,
        });
      }

      // Docker errors
      if (output.command.startsWith('docker') && output.stderr.includes('Cannot connect')) {
        suggestions.push({
          command: 'docker ps',
          reasoning: 'Docker daemon not running. Check if Docker is started.',
          confidence: 0.9,
          auto_executable: true,
        });
      }
    }

    // Success-based suggestions
    if (outputType === 'success') {
      // Git clone
      if (output.command.startsWith('git clone')) {
        const repoPath = patterns.file_paths.find(p => !p.startsWith('http'));
        if (repoPath) {
          suggestions.push({
            command: `cd ${repoPath}`,
            reasoning: 'Repository cloned successfully. Navigate to directory.',
            confidence: 0.9,
            auto_executable: false,
          });
        }
      }

      // npm install
      if (output.command.includes('npm install')) {
        suggestions.push({
          command: 'npm start',
          reasoning: 'Dependencies installed. Ready to start application.',
          confidence: 0.7,
          auto_executable: false,
        });
      }

      // Docker build
      if (output.command.startsWith('docker build')) {
        const imageTag = output.command.match(/-t\s+([^\s]+)/)?.[1];
        if (imageTag) {
          suggestions.push({
            command: `docker run ${imageTag}`,
            reasoning: 'Image built successfully. Run the container.',
            confidence: 0.8,
            auto_executable: false,
          });
        }
      }
    }

    // Pattern-based suggestions
    if (patterns.process_ids.length > 0) {
      const pid = patterns.process_ids[0];
      suggestions.push({
        command: `ps -p ${pid}`,
        reasoning: `Check status of process ${pid}.`,
        confidence: 0.6,
        auto_executable: true,
      });
    }

    if (patterns.ports.length > 0) {
      const port = patterns.ports[0];
      suggestions.push({
        command: `lsof -i :${port}`,
        reasoning: `Check what's using port ${port}.`,
        confidence: 0.7,
        auto_executable: true,
      });
    }

    return suggestions.slice(0, 3); // Limit to top 3 suggestions
  }

  /**
   * Get analysis statistics
   */
  public getStats() {
    return {
      initialized: this.initialized,
    };
  }

  /**
   * Classify output type
   */
  private classifyOutput(output: CommandOutput): 'error' | 'warning' | 'success' | 'info' {
    // Error: non-zero exit code or stderr with errors
    if (output.exit_code !== 0) {
      return 'error';
    }

    // Warning: stderr present but exit code 0
    if (output.stderr.length > 0 && output.stderr.toLowerCase().includes('warning')) {
      return 'warning';
    }

    // Success: exit code 0 with typical success indicators
    if (output.exit_code === 0) {
      const successWords = ['success', 'complete', 'done', 'finished', 'ok'];
      const hasSuccess = successWords.some(word =>
        output.stdout.toLowerCase().includes(word) ||
        output.stderr.toLowerCase().includes(word)
      );
      if (hasSuccess) {
        return 'success';
      }
    }

    return 'info';
  }

  /**
   * Extract key messages from output
   */
  private extractKeyMessages(output: CommandOutput, type: string): string[] {
    const messages: string[] = [];
    const combinedOutput = output.stdout + '\n' + output.stderr;
    const lines = combinedOutput.split('\n').filter(l => l.trim().length > 0);

    if (type === 'error') {
      // Extract error lines
      const errorLines = lines.filter(l =>
        l.toLowerCase().includes('error') ||
        l.toLowerCase().includes('fail') ||
        l.toLowerCase().includes('fatal')
      );
      messages.push(...errorLines.slice(0, 3));
    } else if (type === 'warning') {
      // Extract warning lines
      const warnLines = lines.filter(l => l.toLowerCase().includes('warn'));
      messages.push(...warnLines.slice(0, 3));
    } else {
      // Extract first and last few lines
      messages.push(...lines.slice(0, 2));
      if (lines.length > 5) {
        messages.push(...lines.slice(-2));
      }
    }

    return messages.slice(0, 5).map(m => m.trim());
  }

  /**
   * Generate summary of output
   */
  private generateSummary(
    output: CommandOutput,
    type: string,
    patterns: ExtractedPatterns
  ): string {
    const parts: string[] = [];

    // Command and result
    parts.push(`Command "${output.command}" ${type === 'error' ? 'failed' : 'completed'}`);

    // Duration
    if (output.duration_ms) {
      parts.push(`in ${output.duration_ms}ms`);
    }

    // Exit code
    if (output.exit_code !== 0) {
      parts.push(`with exit code ${output.exit_code}`);
    }

    // Pattern summary
    const patternCounts = Object.entries(patterns)
      .filter(([_, arr]) => arr.length > 0)
      .map(([key, arr]) => `${arr.length} ${key.replace('_', ' ')}`);

    if (patternCounts.length > 0) {
      parts.push(`. Found: ${patternCounts.join(', ')}`);
    }

    return parts.join(' ');
  }

  /**
   * Identify actionable items
   */
  private identifyActionableItems(
    output: CommandOutput,
    patterns: ExtractedPatterns
  ): ActionableItem[] {
    const items: ActionableItem[] = [];

    // Errors
    if (output.exit_code !== 0) {
      items.push({
        type: 'error',
        message: `Command failed with exit code ${output.exit_code}`,
        suggested_action: 'Check error messages in stderr for details',
      });
    }

    // Error codes
    for (const errorCode of patterns.error_codes) {
      items.push({
        type: 'error',
        message: `Error code detected: ${errorCode}`,
        suggested_action: 'Use error_solution_lookup tool to find solutions',
      });
    }

    // Warnings
    for (const warning of patterns.warnings.slice(0, 2)) {
      items.push({
        type: 'warning',
        message: warning,
      });
    }

    // Process IDs (informational)
    if (patterns.process_ids.length > 0) {
      items.push({
        type: 'info',
        message: `Process ID(s) detected: ${patterns.process_ids.join(', ')}`,
        suggested_action: 'Monitor process status with ps or top',
      });
    }

    return items.slice(0, 5);
  }

  /**
   * Calculate analysis confidence
   */
  private calculateConfidence(
    output: CommandOutput,
    patterns: ExtractedPatterns
  ): number {
    let confidence = 0.5; // Base confidence

    // More output = more confident
    const outputLength = output.stdout.length + output.stderr.length;
    if (outputLength > 1000) {
      confidence += 0.2;
    } else if (outputLength > 100) {
      confidence += 0.1;
    }

    // More patterns = more confident
    const patternCount = Object.values(patterns).reduce((sum, arr) => sum + arr.length, 0);
    confidence += Math.min(patternCount * 0.05, 0.3);

    return Math.min(confidence, 1.0);
  }
}

// Singleton instance
let outputAnalysisServiceInstance: OutputAnalysisService | null = null;

/**
 * Get the singleton output analysis service instance
 */
export function getOutputAnalysisService(): OutputAnalysisService {
  if (!outputAnalysisServiceInstance) {
    outputAnalysisServiceInstance = new OutputAnalysisService();
  }
  return outputAnalysisServiceInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetOutputAnalysisService(): void {
  outputAnalysisServiceInstance = null;
}
