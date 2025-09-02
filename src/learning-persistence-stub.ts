import { LearningPersistence } from './learning-persistence.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Stub implementation to make tests compile
export class StubLearningPersistence extends LearningPersistence {
  private dataDir: string;

  constructor(dataDir: string) {
    super();
    this.dataDir = dataDir;
  }

  async ensureDataDir(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async savePatterns(patterns: any[]): Promise<void> {
    const filePath = path.join(this.dataDir, 'patterns.json');
    await fs.writeFile(filePath, JSON.stringify(patterns, null, 2), 'utf-8');
  }

  async saveCacheStats(stats: any): Promise<void> {
    const filePath = path.join(this.dataDir, 'cache-stats.json');
    await fs.writeFile(filePath, JSON.stringify(stats, null, 2), 'utf-8');
  }

  async saveCommandHistory(history: any[]): Promise<void> {
    const filePath = path.join(this.dataDir, 'command-history.json');
    await fs.writeFile(filePath, JSON.stringify(history, null, 2), 'utf-8');
  }

  async loadPatterns(): Promise<any[]> {
    try {
      const filePath = path.join(this.dataDir, 'patterns.json');
      await fs.access(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  async loadCacheStats(): Promise<any> {
    try {
      const filePath = path.join(this.dataDir, 'cache-stats.json');
      await fs.access(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  async clearAllData(): Promise<void> {
    const files = await fs.readdir(this.dataDir);
    for (const file of files) {
      await fs.unlink(path.join(this.dataDir, file));
    }
  }

  async exportAllData(): Promise<any> {
    const patterns = await this.loadPatterns();
    const cacheStats = await this.loadCacheStats();
    return {
      patterns,
      cacheStats
    };
  }

  async importData(data: any): Promise<void> {
    if (data.patterns) {
      await this.savePatterns(data.patterns);
    }
    if (data.cacheStats) {
      await this.saveCacheStats(data.cacheStats);
    }
  }

  async recordLearningEvent(event: string, data: any): Promise<void> {
    // Stub implementation - just record it happened
  }

  async getLearningMetrics(): Promise<any> {
    return {
      eventsRecorded: true
    };
  }

  async getDataSize(): Promise<number> {
    try {
      const files = await fs.readdir(this.dataDir);
      let totalSize = 0;
      for (const file of files) {
        const stats = await fs.stat(path.join(this.dataDir, file));
        totalSize += stats.size;
      }
      return totalSize;
    } catch {
      return 0;
    }
  }
}