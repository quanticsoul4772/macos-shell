import { jest } from '@jest/globals';

// Mock dependencies before import
jest.mock('./ai-cache.js', () => ({
  aiCache: {
    getStats: jest.fn(() => ({
      hitRate: 85.5,
      cacheSize: 42,
      topPatterns: [['git', 10], ['ls', 8], ['npm', 5], ['echo', 2]],
    })),
  },
}));

jest.mock('./ai-dedup.js', () => ({
  aiDedup: {
    getStats: jest.fn(() => ({
      dedupRate: 72.3,
    })),
  },
}));

jest.mock('./ai-error-handler.js', () => ({
  aiErrorHandler: {
    getStats: jest.fn(() => ({
      recoveryRate: 45.0,
    })),
  },
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('./utils/logger.js', () => ({
  getLogger: jest.fn(() => mockLogger),
}));

describe('AI Monitor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should log startup message', async () => {
    const { startMonitoring } = await import('./ai-monitor.js');
    startMonitoring();
    expect(mockLogger.info).toHaveBeenCalledWith('Starting performance monitoring...');
  });

  it('should collect and log stats every 60 seconds', async () => {
    const { startMonitoring } = await import('./ai-monitor.js');
    startMonitoring();

    jest.advanceTimersByTime(60000);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'AI Optimization Stats',
      undefined,
      expect.objectContaining({
        cacheHitRate: '85.5%',
        cacheSize: 42,
        commandsDedupedRate: '72.3%',
        errorsRecoveredRate: '45.0%',
        topPatterns: ['git', 'ls', 'npm'],
      })
    );
  });

  it('should handle zero/missing stats gracefully', async () => {
    const { aiCache } = await import('./ai-cache.js');
    (aiCache.getStats as jest.Mock).mockReturnValue({
      hitRate: 0,
      cacheSize: 0,
      topPatterns: undefined,
    });

    const { aiDedup } = await import('./ai-dedup.js');
    (aiDedup.getStats as jest.Mock).mockReturnValue({ dedupRate: undefined });

    const { aiErrorHandler } = await import('./ai-error-handler.js');
    (aiErrorHandler.getStats as jest.Mock).mockReturnValue({ recoveryRate: undefined });

    const { startMonitoring } = await import('./ai-monitor.js');
    startMonitoring();

    jest.advanceTimersByTime(60000);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'AI Optimization Stats',
      undefined,
      expect.objectContaining({
        cacheHitRate: '0.0%',
        commandsDedupedRate: '0.0%',
        errorsRecoveredRate: '0.0%',
        topPatterns: [],
      })
    );
  });
});
