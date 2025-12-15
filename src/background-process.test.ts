// background-process.test.ts
// Tests for CircularBuffer and background process types

import { CircularBuffer, ProcessStatus, OutputLine } from './background-process.js';

describe('CircularBuffer', () => {
  let buffer: CircularBuffer;

  beforeEach(() => {
    buffer = new CircularBuffer(5); // Small buffer for testing
  });

  describe('add and getLines', () => {
    it('should add lines to buffer', () => {
      const line: OutputLine = {
        timestamp: new Date(),
        type: 'stdout',
        content: 'test output',
        lineNumber: 1
      };

      buffer.add(line);

      expect(buffer.getTotalLines()).toBe(1);
      expect(buffer.getBufferSize()).toBe(1);

      const lines = buffer.getLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].content).toBe('test output');
    });

    it('should overwrite oldest lines when buffer is full', () => {
      // Fill buffer beyond capacity
      for (let i = 0; i < 10; i++) {
        buffer.add({
          timestamp: new Date(),
          type: 'stdout',
          content: `line ${i}`,
          lineNumber: i + 1
        });
      }

      // Total lines should be 10, but buffer only holds 5
      expect(buffer.getTotalLines()).toBe(10);
      expect(buffer.getBufferSize()).toBe(5);

      // Should only get the last 5 lines
      const lines = buffer.getLines();
      expect(lines).toHaveLength(5);
      expect(lines[0].content).toBe('line 5');
      expect(lines[4].content).toBe('line 9');
    });

    it('should return empty array for overwritten lines', () => {
      // Add 10 lines to 5-line buffer
      for (let i = 0; i < 10; i++) {
        buffer.add({
          timestamp: new Date(),
          type: 'stdout',
          content: `line ${i}`,
          lineNumber: i + 1
        });
      }

      // Try to get lines from position 0 (these have been overwritten)
      const lines = buffer.getLines(undefined, 0);
      expect(lines).toEqual([]);
    });

    it('should get lines from specific position', () => {
      for (let i = 0; i < 3; i++) {
        buffer.add({
          timestamp: new Date(),
          type: 'stdout',
          content: `line ${i}`,
          lineNumber: i + 1
        });
      }

      // Get lines from position 1 (should get lines 1 and 2)
      const lines = buffer.getLines(undefined, 1);
      expect(lines).toHaveLength(2);
      expect(lines[0].content).toBe('line 1');
      expect(lines[1].content).toBe('line 2');
    });

    it('should get specific count of lines', () => {
      for (let i = 0; i < 5; i++) {
        buffer.add({
          timestamp: new Date(),
          type: 'stdout',
          content: `line ${i}`,
          lineNumber: i + 1
        });
      }

      const lines = buffer.getLines(2);
      expect(lines).toHaveLength(2);
      expect(lines[0].content).toBe('line 3');
      expect(lines[1].content).toBe('line 4');
    });

    it('should handle getBufferSize correctly', () => {
      expect(buffer.getBufferSize()).toBe(0);

      buffer.add({
        timestamp: new Date(),
        type: 'stdout',
        content: 'test',
        lineNumber: 1
      });

      expect(buffer.getBufferSize()).toBe(1);
    });
  });

  describe('waitForLines', () => {
    it('should return immediately if lines are available', async () => {
      buffer.add({
        timestamp: new Date(),
        type: 'stdout',
        content: 'line 0',
        lineNumber: 1
      });

      const lines = await buffer.waitForLines(0, 1000);
      expect(lines).toHaveLength(1);
      expect(lines[0].content).toBe('line 0');
    });

    it('should wait for new lines to be added', async () => {
      // Start waiting
      const promise = buffer.waitForLines(0, 2000);

      // Add a line after a short delay
      setTimeout(() => {
        buffer.add({
          timestamp: new Date(),
          type: 'stdout',
          content: 'new line',
          lineNumber: 1
        });
      }, 100);

      const lines = await promise;
      expect(lines).toHaveLength(1);
      expect(lines[0].content).toBe('new line');
    });

    it('should timeout if no lines are added', async () => {
      const lines = await buffer.waitForLines(0, 100);
      expect(lines).toEqual([]);
    });

    it('should notify multiple waiters', async () => {
      const promise1 = buffer.waitForLines(0, 2000);
      const promise2 = buffer.waitForLines(0, 2000);

      setTimeout(() => {
        buffer.add({
          timestamp: new Date(),
          type: 'stdout',
          content: 'new line',
          lineNumber: 1
        });
      }, 100);

      const [lines1, lines2] = await Promise.all([promise1, promise2]);
      expect(lines1).toHaveLength(1);
      expect(lines2).toHaveLength(1);
    });

    it('should clean up timeout on successful wait', async () => {
      const promise = buffer.waitForLines(0, 5000);

      setTimeout(() => {
        buffer.add({
          timestamp: new Date(),
          type: 'stdout',
          content: 'line',
          lineNumber: 1
        });
      }, 50);

      await promise;

      // Verify waiters array is cleared
      expect((buffer as any).waiters).toHaveLength(0);
    });
  });

  describe('notifyWaiters', () => {
    it('should notify waiters when condition is met', async () => {
      const promise = buffer.waitForLines(0, 2000);

      // This should trigger notifyWaiters
      buffer.add({
        timestamp: new Date(),
        type: 'stdout',
        content: 'line',
        lineNumber: 1
      });

      const lines = await promise;
      expect(lines).toHaveLength(1);
    });

    it('should not notify waiters if condition not met', async () => {
      // Add initial line
      buffer.add({
        timestamp: new Date(),
        type: 'stdout',
        content: 'line 0',
        lineNumber: 1
      });

      // Wait for lines after position 1 (nothing available)
      const promise = buffer.waitForLines(1, 200);

      // Don't add any more lines

      const lines = await promise;
      expect(lines).toEqual([]); // Should timeout
    });

    it('should remove notified waiters from list', async () => {
      const promise1 = buffer.waitForLines(0, 2000);
      const promise2 = buffer.waitForLines(1, 2000);

      // Add line to satisfy first waiter only
      buffer.add({
        timestamp: new Date(),
        type: 'stdout',
        content: 'line 0',
        lineNumber: 1
      });

      await promise1;

      // First waiter should be removed, second should remain
      expect((buffer as any).waiters).toHaveLength(1);

      // Add another line to satisfy second waiter
      buffer.add({
        timestamp: new Date(),
        type: 'stdout',
        content: 'line 1',
        lineNumber: 2
      });

      await promise2;

      // All waiters should be cleared
      expect((buffer as any).waiters).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('should clear all buffer data', () => {
      for (let i = 0; i < 3; i++) {
        buffer.add({
          timestamp: new Date(),
          type: 'stdout',
          content: `line ${i}`,
          lineNumber: i + 1
        });
      }

      expect(buffer.getTotalLines()).toBe(3);

      buffer.clear();

      expect(buffer.getTotalLines()).toBe(0);
      expect(buffer.getBufferSize()).toBe(0);
      expect(buffer.getLines()).toEqual([]);
    });
  });

  describe('getTotalLines', () => {
    it('should track total lines added including overwritten ones', () => {
      for (let i = 0; i < 10; i++) {
        buffer.add({
          timestamp: new Date(),
          type: 'stdout',
          content: `line ${i}`,
          lineNumber: i + 1
        });
      }

      // Total lines = 10 even though buffer only holds 5
      expect(buffer.getTotalLines()).toBe(10);
      expect(buffer.getBufferSize()).toBe(5);
    });
  });
});

describe('ProcessStatus', () => {
  it('should have correct status values', () => {
    expect(ProcessStatus.STARTING).toBe('starting');
    expect(ProcessStatus.RUNNING).toBe('running');
    expect(ProcessStatus.STOPPED).toBe('stopped');
    expect(ProcessStatus.FAILED).toBe('failed');
    expect(ProcessStatus.KILLED).toBe('killed');
    expect(ProcessStatus.ORPHANED).toBe('orphaned');
  });
});
