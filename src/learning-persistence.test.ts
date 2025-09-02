import { StubLearningPersistence } from './learning-persistence-stub.js';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises');

describe('LearningPersistence', () => {
  let persistence: StubLearningPersistence;
  const testDataDir = '/tmp/test-learning';
  
  beforeEach(() => {
    jest.clearAllMocks();
    persistence = new StubLearningPersistence(testDataDir);
    
    // Mock fs methods
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.readFile as jest.Mock).mockResolvedValue('{}');
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.access as jest.Mock).mockRejectedValue(new Error('Not found'));
  });
  
  describe('Initialization', () => {
    it('should create instance with data directory', () => {
      expect(persistence).toBeDefined();
    });
    
    it('should ensure data directory exists', async () => {
      await persistence.ensureDataDir();
      expect(fs.mkdir).toHaveBeenCalledWith(
        testDataDir,
        expect.objectContaining({ recursive: true })
      );
    });
  });
  
  describe('Saving Data', () => {
    it('should save patterns data', async () => {
      const patterns = [
        { pattern: 'git add -> git commit', count: 10 },
        { pattern: 'npm install -> npm test', count: 5 }
      ];
      
      await persistence.savePatterns(patterns);
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('patterns.json'),
        expect.any(String),
        'utf-8'
      );
    });
    
    it('should save cache stats', async () => {
      const stats = {
        hits: 100,
        misses: 20,
        hitRate: 0.83
      };
      
      await persistence.saveCacheStats(stats);
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('cache-stats.json'),
        JSON.stringify(stats, null, 2),
        'utf-8'
      );
    });
    
    it('should save command history', async () => {
      const history = [
        { command: 'ls -la', timestamp: Date.now() },
        { command: 'git status', timestamp: Date.now() }
      ];
      
      await persistence.saveCommandHistory(history);
      
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });
  
  describe('Loading Data', () => {
    it('should load patterns data', async () => {
      const mockData = [{ pattern: 'test', count: 1 }];
      (fs.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockData));
      (fs.access as jest.Mock).mockResolvedValueOnce(undefined);
      
      const patterns = await persistence.loadPatterns();
      
      expect(patterns).toEqual(mockData);
    });
    
    it('should return empty array if patterns file not found', async () => {
      (fs.access as jest.Mock).mockRejectedValueOnce(new Error('ENOENT'));
      
      const patterns = await persistence.loadPatterns();
      
      expect(patterns).toEqual([]);
    });
    
    it('should load cache stats', async () => {
      const mockStats = { hits: 50, misses: 10 };
      (fs.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockStats));
      (fs.access as jest.Mock).mockResolvedValueOnce(undefined);
      
      const stats = await persistence.loadCacheStats();
      
      expect(stats).toEqual(mockStats);
    });
  });
  
  describe('Data Management', () => {
    it('should clear all data', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue(['file1.json', 'file2.json']);
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);
      
      await persistence.clearAllData();
      
      expect(fs.unlink).toHaveBeenCalledTimes(2);
    });
    
    it('should export all data', async () => {
      const mockPatterns = [{ pattern: 'test', count: 1 }];
      const mockStats = { hits: 100 };
      
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify(mockPatterns))
        .mockResolvedValueOnce(JSON.stringify(mockStats));
      
      const exported = await persistence.exportAllData();
      
      expect(exported).toHaveProperty('patterns');
      expect(exported).toHaveProperty('cacheStats');
    });
    
    it('should import data', async () => {
      const dataToImport = {
        patterns: [{ pattern: 'imported', count: 2 }],
        cacheStats: { hits: 200 }
      };
      
      await persistence.importData(dataToImport);
      
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
    });
  });
  
  describe('Metrics', () => {
    it('should track learning metrics', async () => {
      await persistence.recordLearningEvent('pattern_detected', { pattern: 'test' });
      
      const metrics = await persistence.getLearningMetrics();
      expect(metrics).toBeDefined();
    });
    
    it('should get data size', async () => {
      (fs.stat as jest.Mock).mockResolvedValue({ size: 1024 });
      (fs.readdir as jest.Mock).mockResolvedValue(['file1.json']);
      
      const size = await persistence.getDataSize();
      
      expect(size).toBeGreaterThan(0);
    });
  });
});
