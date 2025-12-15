// progress-tracker.test.ts
// Tests for progress tracking functionality

import { jest } from '@jest/globals';
import {
  ProgressTracker,
  ShellProgressReporter,
  BatchProgressReporter,
  BatchStage,
  extractToolContext,
  RequestMetadata,
  ToolContext
} from './progress-tracker.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Mock logger
jest.mock('./logger.js', () => ({
  getLogger: jest.fn().mockReturnValue({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })
}));

describe('ProgressTracker', () => {
  let mockServer: McpServer;
  let sendNotificationSpy: jest.MockedFunction<any>;

  beforeEach(() => {
    sendNotificationSpy = jest.fn(async () => {});
    mockServer = {
      sendNotification: sendNotificationSpy
    } as any;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with server and progress token', () => {
      const tracker = new ProgressTracker(mockServer, 'token-123', 'request-456');
      expect(tracker).toBeDefined();
      expect(tracker.getElapsedTime()).toBeGreaterThanOrEqual(0);
    });

    it('should initialize without server', () => {
      const tracker = new ProgressTracker(undefined, 'token-123');
      expect(tracker).toBeDefined();
    });

    it('should initialize without progress token', () => {
      const tracker = new ProgressTracker(mockServer, undefined);
      expect(tracker).toBeDefined();
    });
  });

  describe('update', () => {
    it('should send progress notification', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123', 'request-456');

      await tracker.update(50, 'Processing...');

      expect(sendNotificationSpy).toHaveBeenCalledWith('notifications/progress', {
        progressToken: 'token-123',
        progress: 50,
        total: 100,
        message: 'Processing...'
      });
    });

    it('should clamp progress to 0-100 range', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.update(-10, 'Test');
      expect(sendNotificationSpy).toHaveBeenCalledWith(
        'notifications/progress',
        expect.objectContaining({ progress: 0 })
      );

      await tracker.update(150, 'Test');
      expect(sendNotificationSpy).toHaveBeenCalledWith(
        'notifications/progress',
        expect.objectContaining({ progress: 100 })
      );
    });

    it('should throttle updates', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.update(10, 'First');
      jest.advanceTimersByTime(50); // Less than throttle threshold
      await tracker.update(20, 'Second');

      // Second update should be throttled
      expect(sendNotificationSpy).toHaveBeenCalledTimes(1);
    });

    it('should allow updates after throttle period', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.update(10, 'First');
      jest.advanceTimersByTime(150); // More than throttle threshold
      await tracker.update(20, 'Second');

      expect(sendNotificationSpy).toHaveBeenCalledTimes(2);
    });

    it('should always send 100% update', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.update(10, 'First');
      await tracker.update(100, 'Complete');

      // 100% should bypass throttling
      expect(sendNotificationSpy).toHaveBeenCalledTimes(2);
    });

    it('should not send notification without server', async () => {
      const tracker = new ProgressTracker(undefined, 'token-123');

      await tracker.update(50, 'Processing...');

      expect(sendNotificationSpy).not.toHaveBeenCalled();
    });

    it('should not send notification without progress token', async () => {
      const tracker = new ProgressTracker(mockServer, undefined);

      await tracker.update(50, 'Processing...');

      expect(sendNotificationSpy).not.toHaveBeenCalled();
    });

    it('should handle sendNotification errors gracefully', async () => {
      sendNotificationSpy.mockRejectedValueOnce(new Error('Network error'));
      const tracker = new ProgressTracker(mockServer, 'token-123');

      // Should not throw
      await expect(tracker.update(50, 'Processing...')).resolves.not.toThrow();
    });
  });

  describe('complete', () => {
    it('should send 100% progress with default message', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.complete();

      expect(sendNotificationSpy).toHaveBeenCalledWith(
        'notifications/progress',
        expect.objectContaining({
          progress: 100,
          message: 'Operation completed'
        })
      );
    });

    it('should send 100% progress with custom message', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.complete('Task finished successfully');

      expect(sendNotificationSpy).toHaveBeenCalledWith(
        'notifications/progress',
        expect.objectContaining({
          progress: 100,
          message: 'Task finished successfully'
        })
      );
    });
  });

  describe('error', () => {
    it('should send error notification', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.error('Something went wrong');

      expect(sendNotificationSpy).toHaveBeenCalledWith('notifications/progress', {
        progressToken: 'token-123',
        progress: 0,
        total: 100,
        message: 'Error: Something went wrong',
        error: true
      });
    });

    it('should not send error notification without server', async () => {
      const tracker = new ProgressTracker(undefined, 'token-123');

      await tracker.error('Error message');

      expect(sendNotificationSpy).not.toHaveBeenCalled();
    });

    it('should handle sendNotification errors gracefully', async () => {
      sendNotificationSpy.mockRejectedValueOnce(new Error('Network error'));
      const tracker = new ProgressTracker(mockServer, 'token-123');

      // Should not throw
      await expect(tracker.error('Error')).resolves.not.toThrow();
    });
  });

  describe('getElapsedTime', () => {
    it('should return elapsed time in milliseconds', () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      jest.advanceTimersByTime(1000);

      expect(tracker.getElapsedTime()).toBe(1000);
    });
  });

  describe('updateForLines', () => {
    it('should calculate progress based on lines processed', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.updateForLines(50, 100, 'Reading');

      expect(sendNotificationSpy).toHaveBeenCalledWith(
        'notifications/progress',
        expect.objectContaining({
          progress: 50,
          message: 'Reading: 50/100 lines'
        })
      );
    });

    it('should handle zero total lines', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.updateForLines(10, 0, 'Processing');

      expect(sendNotificationSpy).not.toHaveBeenCalled();
    });
  });

  describe('updateForFiles', () => {
    it('should calculate progress for files without filename', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.updateForFiles(3, 10);

      expect(sendNotificationSpy).toHaveBeenCalledWith(
        'notifications/progress',
        expect.objectContaining({
          progress: 30,
          message: 'Processing 3/10 files'
        })
      );
    });

    it('should include current filename when provided', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.updateForFiles(3, 10, 'test.txt');

      expect(sendNotificationSpy).toHaveBeenCalledWith(
        'notifications/progress',
        expect.objectContaining({
          progress: 30,
          message: 'Processing file 3/10: test.txt'
        })
      );
    });

    it('should handle zero total files', async () => {
      const tracker = new ProgressTracker(mockServer, 'token-123');

      await tracker.updateForFiles(5, 0, 'file.txt');

      expect(sendNotificationSpy).not.toHaveBeenCalled();
    });
  });
});

describe('extractToolContext', () => {
  it('should extract progress token and request ID', () => {
    const request = {
      _meta: {
        progressToken: 'token-123',
        requestId: 'request-456'
      }
    };
    const mockServer = {} as McpServer;

    const context = extractToolContext(request, mockServer);

    expect(context).toEqual({
      progressToken: 'token-123',
      requestId: 'request-456',
      server: mockServer
    });
  });

  it('should handle numeric progress token', () => {
    const request = {
      _meta: {
        progressToken: 12345,
        requestId: 'request-789'
      }
    };

    const context = extractToolContext(request);

    expect(context.progressToken).toBe('12345');
  });

  it('should handle missing metadata', () => {
    const request = {};

    const context = extractToolContext(request);

    expect(context).toEqual({
      progressToken: undefined,
      requestId: undefined,
      server: undefined
    });
  });

  it('should handle null request', () => {
    const context = extractToolContext(null);

    expect(context).toEqual({
      progressToken: undefined,
      requestId: undefined,
      server: undefined
    });
  });
});

describe('ShellProgressReporter', () => {
  let mockTracker: ProgressTracker;
  let updateSpy: jest.MockedFunction<any>;
  let completeSpy: jest.MockedFunction<any>;
  let getElapsedTimeSpy: jest.MockedFunction<any>;

  beforeEach(() => {
    updateSpy = jest.fn(async () => {});
    completeSpy = jest.fn(async () => {});
    getElapsedTimeSpy = jest.fn(() => 0);

    mockTracker = {
      update: updateSpy,
      complete: completeSpy,
      getElapsedTime: getElapsedTimeSpy
    } as any;
  });

  describe('reportOutputLine', () => {
    it('should track output lines and update progress', async () => {
      getElapsedTimeSpy.mockReturnValue(1000); // 1 second elapsed = 18% progress
      const reporter = new ShellProgressReporter(mockTracker, 5000);

      await reporter.reportOutputLine('line 1');

      // First line triggers update because it crosses 0% -> 18%
      expect(updateSpy).toHaveBeenCalledWith(
        18,
        expect.stringContaining('1 lines')
      );
    });

    it('should only update progress every 5%', async () => {
      const reporter = new ShellProgressReporter(mockTracker, 5000);

      getElapsedTimeSpy.mockReturnValue(100);
      await reporter.reportOutputLine('line 1');

      getElapsedTimeSpy.mockReturnValue(200);
      await reporter.reportOutputLine('line 2');

      // Progress hasn't changed by 5% yet
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('should update when progress increases by 5%', async () => {
      const reporter = new ShellProgressReporter(mockTracker, 1000);

      getElapsedTimeSpy.mockReturnValue(0);
      await reporter.reportOutputLine('line 1');

      getElapsedTimeSpy.mockReturnValue(600); // 54% progress
      await reporter.reportOutputLine('line 2');

      expect(updateSpy).toHaveBeenCalled();
    });

    it('should cap progress at 90%', async () => {
      getElapsedTimeSpy.mockReturnValue(10000); // Way past estimated duration
      const reporter = new ShellProgressReporter(mockTracker, 1000);

      await reporter.reportOutputLine('line 1');

      expect(updateSpy).toHaveBeenCalledWith(
        90,
        expect.any(String)
      );
    });
  });

  describe('reportErrorLine', () => {
    it('should track error lines', async () => {
      const reporter = new ShellProgressReporter(mockTracker);

      await reporter.reportErrorLine('error 1');

      expect(updateSpy).toHaveBeenCalledWith(
        expect.any(Number),
        'Warning: Error output detected'
      );
    });

    it('should only warn on first error line', async () => {
      const reporter = new ShellProgressReporter(mockTracker);

      await reporter.reportErrorLine('error 1');
      await reporter.reportErrorLine('error 2');

      expect(updateSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('reportStart', () => {
    it('should report command start', async () => {
      const reporter = new ShellProgressReporter(mockTracker);

      await reporter.reportStart('ls -la');

      expect(updateSpy).toHaveBeenCalledWith(0, 'Starting command: ls -la');
    });
  });

  describe('reportComplete', () => {
    it('should report successful completion', async () => {
      const reporter = new ShellProgressReporter(mockTracker);

      await reporter.reportOutputLine('line 1');
      await reporter.reportOutputLine('line 2');
      await reporter.reportComplete(0);

      expect(completeSpy).toHaveBeenCalledWith(
        'Command completed successfully (2 lines output)'
      );
    });

    it('should report failed completion', async () => {
      const reporter = new ShellProgressReporter(mockTracker);

      await reporter.reportComplete(1);

      expect(completeSpy).toHaveBeenCalledWith(
        'Command failed with exit code 1'
      );
    });
  });
});

describe('BatchProgressReporter', () => {
  let mockTracker: ProgressTracker;
  let updateSpy: jest.MockedFunction<any>;
  let completeSpy: jest.MockedFunction<any>;

  beforeEach(() => {
    updateSpy = jest.fn(async () => {});
    completeSpy = jest.fn(async () => {});

    mockTracker = {
      update: updateSpy,
      complete: completeSpy
    } as any;
  });

  describe('reportStage', () => {
    it('should report INIT stage at 0%', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 5);

      await reporter.reportStage(BatchStage.INIT);

      expect(updateSpy).toHaveBeenCalledWith(0, BatchStage.INIT);
    });

    it('should report VALIDATION stage at 10%', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 5);

      await reporter.reportStage(BatchStage.VALIDATION);

      expect(updateSpy).toHaveBeenCalledWith(10, BatchStage.VALIDATION);
    });

    it('should report EXECUTION stage at 20%', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 5);

      await reporter.reportStage(BatchStage.EXECUTION);

      expect(updateSpy).toHaveBeenCalledWith(20, BatchStage.EXECUTION);
    });

    it('should report COLLECTING stage at 90%', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 5);

      await reporter.reportStage(BatchStage.COLLECTING);

      expect(updateSpy).toHaveBeenCalledWith(90, BatchStage.COLLECTING);
    });

    it('should report COMPLETE stage at 100%', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 5);

      await reporter.reportStage(BatchStage.COMPLETE);

      expect(updateSpy).toHaveBeenCalledWith(100, BatchStage.COMPLETE);
    });
  });

  describe('reportCommandProgress', () => {
    it('should report starting command', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 10);

      await reporter.reportCommandProgress(0, 'echo test', 'starting');

      expect(updateSpy).toHaveBeenCalledWith(
        27, // 20 + (1/10) * 70
        'Executing command 1/10: echo test'
      );
    });

    it('should report completed command', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 10);

      await reporter.reportCommandProgress(4, 'ls -la', 'completed');

      expect(updateSpy).toHaveBeenCalledWith(
        55, // 20 + (5/10) * 70
        'Completed command 5/10'
      );
    });

    it('should report failed command', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 10);

      await reporter.reportCommandProgress(9, 'bad-cmd', 'failed');

      expect(updateSpy).toHaveBeenCalledWith(
        90, // 20 + (10/10) * 70
        'Failed command 10/10: bad-cmd'
      );
    });
  });

  describe('complete', () => {
    it('should report batch completion with success/failure counts', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 10);

      await reporter.complete(8, 2);

      expect(completeSpy).toHaveBeenCalledWith(
        'Batch complete: 8 succeeded, 2 failed'
      );
    });

    it('should handle all successful', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 5);

      await reporter.complete(5, 0);

      expect(completeSpy).toHaveBeenCalledWith(
        'Batch complete: 5 succeeded, 0 failed'
      );
    });

    it('should handle all failed', async () => {
      const reporter = new BatchProgressReporter(mockTracker, 5);

      await reporter.complete(0, 5);

      expect(completeSpy).toHaveBeenCalledWith(
        'Batch complete: 0 succeeded, 5 failed'
      );
    });
  });
});

describe('BatchStage enum', () => {
  it('should have all expected stages', () => {
    expect(BatchStage.INIT).toBe('Initializing batch operation');
    expect(BatchStage.VALIDATION).toBe('Validating commands');
    expect(BatchStage.EXECUTION).toBe('Executing commands');
    expect(BatchStage.COLLECTING).toBe('Collecting results');
    expect(BatchStage.COMPLETE).toBe('Batch operation complete');
  });
});
