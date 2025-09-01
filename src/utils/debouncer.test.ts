import { Debouncer } from './debouncer.js';

// Mock logger with proper structure
jest.mock('./logger.js', () => {
  const mockLogger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
  return {
    __esModule: true,
    default: mockLogger,
    getLogger: jest.fn(() => mockLogger),
  };
});

describe('Debouncer', () => {
  let debouncer: Debouncer<string>;
  let mockExecutor: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    mockExecutor = jest.fn().mockResolvedValue(undefined);
    debouncer = new Debouncer<string>(100, mockExecutor);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('schedule', () => {
    it('should execute after delay', async () => {
      debouncer.schedule('key1', 'value1');
      
      expect(mockExecutor).not.toHaveBeenCalled();
      
      jest.advanceTimersByTime(100);
      await Promise.resolve(); // Let promises resolve
      
      expect(mockExecutor).toHaveBeenCalledWith('key1', 'value1');
      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });

    it('should debounce multiple calls to same key', async () => {
      debouncer.schedule('key1', 'value1');
      debouncer.schedule('key1', 'value2');
      debouncer.schedule('key1', 'value3');
      
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      // Only the last value should be executed
      expect(mockExecutor).toHaveBeenCalledWith('key1', 'value3');
      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });

    it('should handle different keys independently', async () => {
      debouncer.schedule('key1', 'value1');
      
      jest.advanceTimersByTime(50);
      debouncer.schedule('key2', 'value2');
      
      jest.advanceTimersByTime(50);
      await Promise.resolve();
      
      // key1 should have executed
      expect(mockExecutor).toHaveBeenCalledWith('key1', 'value1');
      
      jest.advanceTimersByTime(50);
      await Promise.resolve();
      
      // key2 should have executed
      expect(mockExecutor).toHaveBeenCalledWith('key2', 'value2');
      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it('should handle executor errors gracefully', async () => {
      const error = new Error('Executor failed');
      mockExecutor.mockRejectedValueOnce(error);
      
      debouncer.schedule('key1', 'value1');
      
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve(); // Extra resolve for error handling
      
      expect(mockExecutor).toHaveBeenCalledWith('key1', 'value1');
      
      // Should clean up even after error
      expect(debouncer.hasPending('key1')).toBe(false);
    });
  });

  describe('flush', () => {
    it('should execute pending immediately for specific key', async () => {
      debouncer.schedule('key1', 'value1');
      debouncer.schedule('key2', 'value2');
      
      await debouncer.flush('key1');
      
      expect(mockExecutor).toHaveBeenCalledWith('key1', 'value1');
      expect(mockExecutor).toHaveBeenCalledTimes(1);
      
      // key2 should still be pending
      expect(debouncer.hasPending('key2')).toBe(true);
    });

    it('should flush all pending when no key specified', async () => {
      debouncer.schedule('key1', 'value1');
      debouncer.schedule('key2', 'value2');
      debouncer.schedule('key3', 'value3');
      
      await debouncer.flush();
      
      expect(mockExecutor).toHaveBeenCalledWith('key1', 'value1');
      expect(mockExecutor).toHaveBeenCalledWith('key2', 'value2');
      expect(mockExecutor).toHaveBeenCalledWith('key3', 'value3');
      expect(mockExecutor).toHaveBeenCalledTimes(3);
      
      expect(debouncer.hasPending()).toBe(false);
    });

    it('should handle flush with no pending items', async () => {
      await debouncer.flush();
      expect(mockExecutor).not.toHaveBeenCalled();
      
      await debouncer.flush('nonexistent');
      expect(mockExecutor).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('should cancel pending execution for specific key', async () => {
      debouncer.schedule('key1', 'value1');
      debouncer.schedule('key2', 'value2');
      
      debouncer.cancel('key1');
      
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      expect(mockExecutor).not.toHaveBeenCalledWith('key1', 'value1');
      expect(mockExecutor).toHaveBeenCalledWith('key2', 'value2');
      expect(mockExecutor).toHaveBeenCalledTimes(1);
    });

    it('should cancel all pending when no key specified', async () => {
      debouncer.schedule('key1', 'value1');
      debouncer.schedule('key2', 'value2');
      
      debouncer.cancel();
      
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      expect(mockExecutor).not.toHaveBeenCalled();
      expect(debouncer.hasPending()).toBe(false);
    });

    it('should handle cancel with no pending items', () => {
      debouncer.cancel();
      expect(debouncer.hasPending()).toBe(false);
      
      debouncer.cancel('nonexistent');
      expect(debouncer.hasPending()).toBe(false);
    });
  });

  describe('hasPending', () => {
    it('should check pending status for specific key', async () => {
      expect(debouncer.hasPending('key1')).toBe(false);
      
      debouncer.schedule('key1', 'value1');
      
      expect(debouncer.hasPending('key1')).toBe(true);
      expect(debouncer.hasPending('key2')).toBe(false);
      
      jest.advanceTimersByTime(100);
      await Promise.resolve(); // Wait for async execution to complete
      
      expect(debouncer.hasPending('key1')).toBe(false);
    });

    it('should check if any pending when no key specified', async () => {
      expect(debouncer.hasPending()).toBe(false);
      
      debouncer.schedule('key1', 'value1');
      expect(debouncer.hasPending()).toBe(true);
      
      debouncer.schedule('key2', 'value2');
      expect(debouncer.hasPending()).toBe(true);
      
      jest.advanceTimersByTime(100);
      await Promise.resolve(); // Wait for async execution to complete
      
      expect(debouncer.hasPending()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle immediate reschedule after execution', async () => {
      debouncer.schedule('key1', 'value1');
      
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      expect(mockExecutor).toHaveBeenCalledTimes(1);
      
      // Schedule again immediately
      debouncer.schedule('key1', 'value2');
      
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      
      expect(mockExecutor).toHaveBeenCalledWith('key1', 'value2');
      expect(mockExecutor).toHaveBeenCalledTimes(2);
    });

    it('should handle zero delay', async () => {
      const zeroDebouncer = new Debouncer<string>(0, mockExecutor);
      
      zeroDebouncer.schedule('key1', 'value1');
      
      jest.advanceTimersByTime(0);
      await Promise.resolve();
      
      expect(mockExecutor).toHaveBeenCalledWith('key1', 'value1');
    });
  });
});
