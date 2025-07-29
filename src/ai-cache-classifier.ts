/**
 * AI Cache Classifier
 * Determines which commands should be cached and for how long
 */

export enum CacheStrategy {
  NEVER = 'never',           // Never cache (status commands)
  SHORT = 'short',           // 30 seconds (might change quickly)
  MEDIUM = 'medium',         // 5 minutes (changes occasionally)
  LONG = 'long',             // 30 minutes (rarely changes)
  PERMANENT = 'permanent'    // 1 hour (static content)
}

export interface CacheRule {
  pattern: RegExp | string;
  strategy: CacheStrategy;
  ttl?: number; // Override default TTL in milliseconds
  reason: string;
}

export class CacheClassifier {
  private rules: CacheRule[] = [
    // NEVER CACHE - Status/monitoring commands
    { pattern: /^git\s+(status|diff|log|branch|remote|fetch|pull|push)/, strategy: CacheStrategy.NEVER, reason: 'Git status commands need fresh data' },
    { pattern: /^ls(\s|$)/, strategy: CacheStrategy.NEVER, reason: 'Directory listings need to be current' },
    { pattern: /^docker\s+(ps|stats|logs|events|top)/, strategy: CacheStrategy.NEVER, reason: 'Docker status needs real-time data' },
    { pattern: /^ps\s/, strategy: CacheStrategy.NEVER, reason: 'Process status must be current' },
    { pattern: /^top|htop|btop/, strategy: CacheStrategy.NEVER, reason: 'System monitoring needs real-time data' },
    { pattern: /^df\s/, strategy: CacheStrategy.NEVER, reason: 'Disk usage changes' },
    { pattern: /^du\s/, strategy: CacheStrategy.NEVER, reason: 'Directory sizes change' },
    { pattern: /^free|vmstat|iostat/, strategy: CacheStrategy.NEVER, reason: 'Memory/IO stats need current data' },
    { pattern: /^netstat|ss|lsof/, strategy: CacheStrategy.NEVER, reason: 'Network connections change' },
    { pattern: /^date(\s|$)/, strategy: CacheStrategy.NEVER, reason: 'Time always changes' },
    { pattern: /^uptime/, strategy: CacheStrategy.NEVER, reason: 'Uptime always increases' },
    { pattern: /^tail\s+-f/, strategy: CacheStrategy.NEVER, reason: 'Following logs needs real-time' },
    { pattern: /^journalctl/, strategy: CacheStrategy.NEVER, reason: 'System logs need current entries' },
    { pattern: /^find\s/, strategy: CacheStrategy.NEVER, reason: 'File searches need current state' },
    { pattern: /^npm\s+(ls|list|outdated)/, strategy: CacheStrategy.NEVER, reason: 'Package listings might change' },
    { pattern: /^yarn\s+(list|outdated)/, strategy: CacheStrategy.NEVER, reason: 'Package listings might change' },
    { pattern: /^pnpm\s+(ls|list|outdated)/, strategy: CacheStrategy.NEVER, reason: 'Package listings might change' },
    { pattern: /^ping\s/, strategy: CacheStrategy.NEVER, reason: 'Network tests need real results' },
    { pattern: /^curl\s/, strategy: CacheStrategy.NEVER, reason: 'HTTP requests need fresh data' },
    { pattern: /^wget\s/, strategy: CacheStrategy.NEVER, reason: 'Downloads need fresh data' },
    { pattern: /watch\s+/, strategy: CacheStrategy.NEVER, reason: 'Watch commands monitor changes' },

    // SHORT CACHE (30 seconds) - May change quickly
    { pattern: /^pwd$/, strategy: CacheStrategy.SHORT, ttl: 30000, reason: 'Working directory might change' },
    { pattern: /^whoami$/, strategy: CacheStrategy.SHORT, ttl: 30000, reason: 'User context might change' },
    { pattern: /^env(\s|$)/, strategy: CacheStrategy.SHORT, ttl: 30000, reason: 'Environment might change' },
    { pattern: /^which\s/, strategy: CacheStrategy.SHORT, ttl: 30000, reason: 'PATH might change' },

    // MEDIUM CACHE (5 minutes) - Changes occasionally  
    { pattern: /^cat\s+.*\.(json|yml|yaml|toml|ini|conf|cfg)/, strategy: CacheStrategy.MEDIUM, ttl: 300000, reason: 'Config files change occasionally' },
    { pattern: /^npm\s+(run|test|build)/, strategy: CacheStrategy.MEDIUM, ttl: 300000, reason: 'Build outputs are semi-stable' },
    { pattern: /^yarn\s+(run|test|build)/, strategy: CacheStrategy.MEDIUM, ttl: 300000, reason: 'Build outputs are semi-stable' },
    { pattern: /^git\s+(show|rev-parse|describe)/, strategy: CacheStrategy.MEDIUM, ttl: 300000, reason: 'Git object data is semi-stable' },

    // LONG CACHE (30 minutes) - Rarely changes
    { pattern: /^cat\s+.*\.(md|txt|log)$/, strategy: CacheStrategy.LONG, reason: 'Documentation rarely changes' },
    { pattern: /^head\s+/, strategy: CacheStrategy.LONG, reason: 'File headers rarely change' },
    { pattern: /^file\s+/, strategy: CacheStrategy.LONG, reason: 'File types dont change' },
    { pattern: /^wc\s+/, strategy: CacheStrategy.LONG, reason: 'File stats are stable' },
    { pattern: /^git\s+config/, strategy: CacheStrategy.LONG, reason: 'Git config is stable' },
    { pattern: /^npm\s+config/, strategy: CacheStrategy.LONG, reason: 'NPM config is stable' },

    // PERMANENT CACHE (1 hour) - Static content
    { pattern: /^uname/, strategy: CacheStrategy.PERMANENT, reason: 'System info is static' },
    { pattern: /^hostname/, strategy: CacheStrategy.PERMANENT, reason: 'Hostname is static' },
    { pattern: /^sw_vers/, strategy: CacheStrategy.PERMANENT, reason: 'macOS version is static' },
    { pattern: /^node\s+--version/, strategy: CacheStrategy.PERMANENT, reason: 'Node version is static' },
    { pattern: /^npm\s+--version/, strategy: CacheStrategy.PERMANENT, reason: 'NPM version is static' },
    { pattern: /^python\s+--version/, strategy: CacheStrategy.PERMANENT, reason: 'Python version is static' },
    { pattern: /^ruby\s+--version/, strategy: CacheStrategy.PERMANENT, reason: 'Ruby version is static' },
    { pattern: /^go\s+version/, strategy: CacheStrategy.PERMANENT, reason: 'Go version is static' },
    { pattern: /^java\s+--version/, strategy: CacheStrategy.PERMANENT, reason: 'Java version is static' },
    { pattern: /^.*\s+--help$/, strategy: CacheStrategy.PERMANENT, reason: 'Help text is static' },
    { pattern: /^man\s+/, strategy: CacheStrategy.PERMANENT, reason: 'Man pages are static' },
  ];

  private defaultTTLs: Record<CacheStrategy, number> = {
    [CacheStrategy.NEVER]: 0,
    [CacheStrategy.SHORT]: 30 * 1000,        // 30 seconds
    [CacheStrategy.MEDIUM]: 5 * 60 * 1000,   // 5 minutes
    [CacheStrategy.LONG]: 30 * 60 * 1000,    // 30 minutes
    [CacheStrategy.PERMANENT]: 60 * 60 * 1000 // 1 hour
  };

  /**
   * Classify a command and determine cache strategy
   */
  classify(command: string): { strategy: CacheStrategy; ttl: number; reason: string } {
    // Normalize command
    const normalizedCommand = command.trim();

    // Check each rule in order
    for (const rule of this.rules) {
      const matches = typeof rule.pattern === 'string' 
        ? normalizedCommand === rule.pattern
        : rule.pattern.test(normalizedCommand);

      if (matches) {
        return {
          strategy: rule.strategy,
          ttl: rule.ttl || this.defaultTTLs[rule.strategy],
          reason: rule.reason
        };
      }
    }

    // Default: MEDIUM cache for unknown commands
    return {
      strategy: CacheStrategy.MEDIUM,
      ttl: this.defaultTTLs[CacheStrategy.MEDIUM],
      reason: 'Default cache strategy for unknown commands'
    };
  }

  /**
   * Check if a command should be cached
   */
  shouldCache(command: string): boolean {
    const { strategy } = this.classify(command);
    return strategy !== CacheStrategy.NEVER;
  }

  /**
   * Get TTL for a command
   */
  getTTL(command: string): number {
    const { ttl } = this.classify(command);
    return ttl;
  }

  /**
   * Add custom rule (for extensibility)
   */
  addRule(rule: CacheRule, priority: 'high' | 'low' = 'high'): void {
    if (priority === 'high') {
      this.rules.unshift(rule); // Add to beginning
    } else {
      this.rules.push(rule); // Add to end
    }
  }

  /**
   * Get classification reason (for debugging)
   */
  explainClassification(command: string): string {
    const { strategy, ttl, reason } = this.classify(command);
    const ttlText = ttl === 0 ? 'no cache' : `${ttl / 1000}s`;
    return `Command: "${command}" -> Strategy: ${strategy} (${ttlText}) - ${reason}`;
  }
}

// Export singleton
export const cacheClassifier = new CacheClassifier();
