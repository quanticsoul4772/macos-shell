// ai-monitor.test.ts
// Tests for AI performance monitoring

import { jest } from '@jest/globals';

// Mock dependencies
jest.mock('./ai-cache.js', () => ({
  aiCache: {
    getStats: jest.fn()
  }
}));

jest.mock('./ai-dedup.js', () => ({
  aiDedup: {
    getStats: jest.fn()
  }
}));

jest.mock('./ai-error-handler.js', () => ({
  aiErrorHandler: {
    getStats: jest.fn()
  }
}));

jest.mock('./utils/logger.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn()
  }))
}));

describe('AI Monitor', () => {
  let mockLogger: any;
  let aiCache: any;
  let aiDedup: any;
  let aiErrorHandler: any;
  let startMonitoring: any;

  beforeEach(async () => {
    // Clear all timers
    jest.useFakeTimers();
    jest.resetModules();

    // Import mocked modules
    const cacheModule = await import('./ai-cache.js');
    const dedupModule = await import('./ai-dedup.js');
    const errorModule = await import('./ai-error-handler.js');
    const loggerModule = await import('./utils/logger.js');

    aiCache = cacheModule.aiCache;
    aiDedup = dedupModule.aiDedup;
    aiErrorHandler = errorModule.aiErrorHandler;
    
    mockLogger = {
      info: jest.fn()
    };
    (loggerModule.getLogger as jest.Mock).mockReturnValue(mockLogger);

    // Set up default mock return values
    (aiCache.getStats as jest.Mock).mockReturnValue({
      hitRate: 85.5,
      cacheSize: 150,
      topPatterns: [
        ['ls -la', 10],
        ['git status', 8],
        ['npm test', 5],
        ['pwd', 3]
      ]
    });

    (aiDedup.getStats as jest.Mock).mockReturnValue({
      dedupRate: 92.3
    });

    (aiErrorHandler.getStats as jest.Mock).mockReturnValue({
      recoveryRate: 78.9
    });

    // Import the module after mocks are set up
    const monitorModule = await import('./ai-monitor.js');
    startMonitoring = monitorModule.startMonitoring;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('startMonitoring', () => {
    it('should log startup message', () => {
      startMonitoring();

      expect(mockLogger.info).toHaveBeenCalledWith('Starting performance monitoring...');
    });

    it('should set up interval for monitoring', () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');

      startMonitoring();

      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        60000 // Every minute
      );
    });

    it('should log stats every minute', () => {
      startMonitoring();

      // Fast-forward time by 1 minute
      jest.advanceTimersByTime(60000);

      // Check that stats were collected
      expect(aiCache.getStats).toHaveBeenCalled();
      expect(aiDedup.getStats).toHaveBeenCalled();
      expect(aiErrorHandler.getStats).toHaveBeenCalled();

      // Check that stats were logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI Optimization Stats',
        undefined,
        expect.objectContaining({
          cacheHitRate: '85.5%',
          cacheSize: 150,
          commandsDedupedRate: '92.3%',
          errorsRecoveredRate: '78.9%',
          topPatterns: ['ls -la', 'git status', 'npm test']
        })
      );
    });

    it('should handle missing stats gracefully', () => {
      (aiCache.getStats as jest.Mock).mockReturnValue({
        hitRate: undefined,
        cacheSize: 0,
        topPatterns: undefined
      });

      (aiDedup.getStats as jest.Mock).mockReturnValue({
        dedupRate: undefined
      });

      (aiErrorHandler.getStats as jest.Mock).mockReturnValue({
        recoveryRate: undefined
      });

      startMonitoring();
      jest.advanceTimersByTime(60000);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI Optimization Stats',
        undefined,
        expect.objectContaining({
          cacheHitRate: '0.0%',
          cacheSize: 0,
          commandsDedupedRate: '0.0%',
          errorsRecoveredRate: '0.0%',
          topPatterns: []
        })
      );
    });

    it('should format percentages to one decimal place', () => {
      (aiCache.getStats as jest.Mock).mockReturnValue({
        hitRate: 45.678,
        cacheSize: 100,
        topPatterns: []
      });

      (aiDedup.getStats as jest.Mock).mockReturnValue({
        dedupRate: 33.333
      });

      (aiErrorHandler.getStats as jest.Mock).mockReturnValue({
        recoveryRate: 99.999
      });

      startMonitoring();
      jest.advanceTimersByTime(60000);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI Optimization Stats',
        undefined,
        expect.objectContaining({
          cacheHitRate: '45.7%',
          commandsDedupedRate: '33.3%',
          errorsRecoveredRate: '100.0%'
        })
      );
    });

    it('should only show top 3 patterns', () => {
      (aiCache.getStats as jest.Mock).mockReturnValue({
        hitRate: 50,
        cacheSize: 100,
        topPatterns: [
          ['pattern1', 20],
          ['pattern2', 15],
          ['pattern3', 10],
          ['pattern4', 5],
          ['pattern5', 2]
        ]
      });

      startMonitoring();
      jest.advanceTimersByTime(60000);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI Optimization Stats',
        undefined,
        expect.objectContaining({
          topPatterns: ['pattern1', 'pattern2', 'pattern3']
        })
      );
    });

    it('should continue logging stats periodically', () => {
      startMonitoring();

      // Fast-forward time by 3 minutes
      jest.advanceTimersByTime(60000);
      jest.advanceTimersByTime(60000);
      jest.advanceTimersByTime(60000);

      // Should have been called 4 times (startup + 3 intervals)
      expect(mockLogger.info).toHaveBeenCalledTimes(4);
      
      // Stats should be collected 3 times (once per interval)
      expect(aiCache.getStats).toHaveBeenCalledTimes(3);
      expect(aiDedup.getStats).toHaveBeenCalledTimes(3);
      expect(aiErrorHandler.getStats).toHaveBeenCalledTimes(3);
    });

    it('should handle empty top patterns', () => {
      (aiCache.getStats as jest.Mock).mockReturnValue({
        hitRate: 0,
        cacheSize: 0,
        topPatterns: []
      });

      startMonitoring();
      jest.advanceTimersByTime(60000);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI Optimization Stats',
        undefined,
        expect.objectContaining({
          topPatterns: []
        })
      );
    });

    it('should handle null/undefined values in top patterns', () => {
      (aiCache.getStats as jest.Mock).mockReturnValue({
        hitRate: 50,
        cacheSize: 100,
        topPatterns: null as any
      });

      startMonitoring();
      jest.advanceTimersByTime(60000);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'AI Optimization Stats',
        undefined,
        expect.objectContaining({
          topPatterns: []
        })
      );
    });
  });
});
