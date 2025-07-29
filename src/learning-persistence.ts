import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CacheStrategy } from './ai-cache-classifier.js';
import logger from './utils/logger.js';

const LEARNED_RULES_FILE = path.join(os.homedir(), '.mcp-cache-rules.json');
const BACKUP_FILE = path.join(os.homedir(), '.mcp-cache-rules.backup.json');

export interface LearnedRule {
  pattern: string;
  isRegex: boolean;
  strategy: CacheStrategy;
  reason: string;
  timestamp: string;
  source: 'user' | 'auto-detect' | 'analysis';
  hitCount?: number;
  lastHit?: string;
}

export class LearningPersistence {
  private rules: LearnedRule[] = [];
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  
  async initialize(): Promise<void> {
    await this.loadRules();
  }
  
  /**
   * Load rules from disk
   */
  async loadRules(): Promise<void> {
    try {
      const content = await fs.readFile(LEARNED_RULES_FILE, 'utf8');
      this.rules = JSON.parse(content);
      
      logger.info({
        module: 'learning-persistence',
        action: 'load-rules',
        count: this.rules.length
      }, `Loaded ${this.rules.length} learned cache rules`);
      
      // Apply rules to classifier
      for (const rule of this.rules) {
        const pattern = rule.isRegex ? new RegExp(rule.pattern) : rule.pattern;
        const { cacheClassifier } = await import('./ai-cache-classifier.js');
        
        cacheClassifier.addRule({
          pattern,
          strategy: rule.strategy,
          reason: rule.reason
        }, 'high');
      }
    } catch (error: unknown) {
      const errorCode = (error as any)?.code;
      if (errorCode && errorCode !== 'ENOENT') {
        logger.error({
          module: 'learning-persistence',
          action: 'load-rules',
          error: error instanceof Error ? error.message : String(error)
        }, 'Failed to load learned rules');
      }
      // Start with empty rules if file doesn't exist
      this.rules = [];
    }
  }
  
  /**
   * Save a new rule
   */
  async saveRule(rule: Omit<LearnedRule, 'hitCount' | 'lastHit'>): Promise<void> {
    // Check if rule already exists
    const existingIndex = this.rules.findIndex(
      r => r.pattern === rule.pattern && r.isRegex === rule.isRegex
    );
    
    if (existingIndex >= 0) {
      // Update existing rule
      this.rules[existingIndex] = {
        ...rule,
        hitCount: (this.rules[existingIndex].hitCount || 0) + 1,
        lastHit: new Date().toISOString()
      };
    } else {
      // Add new rule
      this.rules.push({
        ...rule,
        hitCount: 0,
        lastHit: new Date().toISOString()
      });
    }
    
    // Limit to 1000 rules
    if (this.rules.length > 1000) {
      // Keep most recently used rules
      this.rules.sort((a, b) => {
        const aTime = new Date(a.lastHit || a.timestamp).getTime();
        const bTime = new Date(b.lastHit || b.timestamp).getTime();
        return bTime - aTime;
      });
      this.rules = this.rules.slice(0, 1000);
    }
    
    await this.debouncedSave();
  }
  
  /**
   * Save rules with debouncing
   */
  private async debouncedSave(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    
    this.saveDebounceTimer = setTimeout(async () => {
      await this.saveRules();
    }, 1000); // Save after 1 second of inactivity
  }
  
  /**
   * Save rules to disk
   */
  private async saveRules(): Promise<void> {
    try {
      // Create backup first
      try {
        await fs.copyFile(LEARNED_RULES_FILE, BACKUP_FILE);
      } catch (error) {
        // Ignore if original doesn't exist
      }
      
      // Write new rules
      await fs.writeFile(
        LEARNED_RULES_FILE,
        JSON.stringify(this.rules, null, 2)
      );
      
      logger.info({
        module: 'learning-persistence',
        action: 'save-rules',
        count: this.rules.length
      }, `Saved ${this.rules.length} learned cache rules`);
    } catch (error) {
      logger.error({
        module: 'learning-persistence',
        action: 'save-rules',
        error: error instanceof Error ? error.message : String(error)
      }, 'Failed to save learned rules');
    }
  }
  
  /**
   * Get all rules
   */
  getRules(): LearnedRule[] {
    return [...this.rules];
  }
  
  /**
   * Remove a rule
   */
  async removeRule(pattern: string, isRegex: boolean): Promise<boolean> {
    const initialLength = this.rules.length;
    this.rules = this.rules.filter(
      r => !(r.pattern === pattern && r.isRegex === isRegex)
    );
    
    if (this.rules.length < initialLength) {
      await this.debouncedSave();
      return true;
    }
    
    return false;
  }
  
  /**
   * Get statistics
   */
  getStats(): any {
    const bySource = {
      user: 0,
      'auto-detect': 0,
      analysis: 0
    };
    
    const byStrategy = {
      [CacheStrategy.NEVER]: 0,
      [CacheStrategy.SHORT]: 0,
      [CacheStrategy.MEDIUM]: 0,
      [CacheStrategy.LONG]: 0,
      [CacheStrategy.PERMANENT]: 0
    };
    
    for (const rule of this.rules) {
      bySource[rule.source]++;
      byStrategy[rule.strategy]++;
    }
    
    return {
      totalRules: this.rules.length,
      bySource,
      byStrategy,
      mostUsed: this.rules
        .sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0))
        .slice(0, 5)
        .map(r => ({
          pattern: r.pattern,
          hitCount: r.hitCount,
          source: r.source
        }))
    };
  }
}

export const learningPersistence = new LearningPersistence();
