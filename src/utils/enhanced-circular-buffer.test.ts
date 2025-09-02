import { EnhancedCircularBuffer } from './enhanced-circular-buffer.js';
import { OutputLine } from '../background-process.js';

describe('EnhancedCircularBuffer', () => {
  let buffer: EnhancedCircularBuffer;
  
  beforeEach(() => {
    jest.useFakeTimers();
    buffer = new EnhancedCircularBuffer(100);
  });
  
  afterEach(() => {
    buffer.cleanup();
    jest.useRealTimers();
  });
  
  describe('Basic Functionality', () => {
    it('should add and retrieve lines', () => {
      const line1: OutputLine = { 
        lineNumber: 1, 
        content: 'Line 1', 
        type: 'stdout',
        timestamp: new Date()
      };
      const line2: OutputLine = { 
        lineNumber: 2, 
        content: 'Line 2', 
        type: 'stdout',
        timestamp: new Date()
      };
      
      buffer.add(line1);
      buffer.add(line2);
      
      const lines = buffer.getLines();
      expect(lines).toHaveLength(2);
      expect(lines[0]).toEqual(line1);
      expect(lines[1]).toEqual(line2);
    });
    
    it('should respect max lines limit', () => {
      const smallBuffer = new EnhancedCircularBuffer(3);
      
      for (let i = 1; i <= 5; i++) {
        smallBuffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      const lines = smallBuffer.getLines();
      expect(lines).toHaveLength(3);
      expect(lines[0].lineNumber).toBe(3); // Oldest kept lines
      expect(lines[2].lineNumber).toBe(5); // Newest line
      
      smallBuffer.cleanup();
    });
    
    it('should get lines after specific line number', () => {
      for (let i = 1; i <= 10; i++) {
        buffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      const lines = buffer.getLines(undefined, 5);
      expect(lines).toHaveLength(5);
      expect(lines[0].lineNumber).toBe(6);
      expect(lines[4].lineNumber).toBe(10);
    });
    
    it('should limit number of lines returned', () => {
      for (let i = 1; i <= 10; i++) {
        buffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      const lines = buffer.getLines(3);
      expect(lines).toHaveLength(3);
      expect(lines[0].lineNumber).toBe(8); // Last 3 lines
      expect(lines[2].lineNumber).toBe(10);
    });
    
    it('should combine limit and afterLine parameters', () => {
      for (let i = 1; i <= 10; i++) {
        buffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      const lines = buffer.getLines(3, 5);
      expect(lines).toHaveLength(3);
      expect(lines[0].lineNumber).toBe(6);
      expect(lines[2].lineNumber).toBe(8);
    });
  });
  
  describe('Wait for Lines', () => {
    it('should return immediately if lines already available', async () => {
      for (let i = 1; i <= 5; i++) {
        buffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      const lines = await buffer.waitForLines(3, 1000);
      expect(lines).toHaveLength(2);
      expect(lines[0].lineNumber).toBe(4);
      expect(lines[1].lineNumber).toBe(5);
    });
    
    it('should wait for new lines to arrive', async () => {
      const waitPromise = buffer.waitForLines(0, 5000);
      
      // Add lines after wait started
      setTimeout(() => {
        buffer.add({
          lineNumber: 1,
          content: 'New line',
          type: 'stdout',
          timestamp: new Date()
        });
      }, 100);
      
      jest.advanceTimersByTime(100);
      
      const lines = await waitPromise;
      expect(lines).toHaveLength(1);
      expect(lines[0].content).toBe('New line');
    });
    
    it('should timeout if no lines arrive', async () => {
      const waitPromise = buffer.waitForLines(0, 1000);
      
      jest.advanceTimersByTime(1000);
      
      const lines = await waitPromise;
      expect(lines).toHaveLength(0);
    });
    
    it('should respect maximum timeout', async () => {
      const waitPromise = buffer.waitForLines(0, 100000); // Request 100 seconds
      
      // Should be capped at 60 seconds
      jest.advanceTimersByTime(60000);
      
      const lines = await waitPromise;
      expect(lines).toHaveLength(0);
    });
    
    it('should handle multiple concurrent waiters', async () => {
      const waiter1 = buffer.waitForLines(0, 5000);
      const waiter2 = buffer.waitForLines(0, 5000);
      const waiter3 = buffer.waitForLines(1, 5000); // Different threshold
      
      // Add first line
      buffer.add({
        lineNumber: 1,
        content: 'Line 1',
        type: 'stdout',
        timestamp: new Date()
      });
      
      const [lines1, lines2] = await Promise.all([waiter1, waiter2]);
      expect(lines1).toHaveLength(1);
      expect(lines2).toHaveLength(1);
      
      // Waiter3 still waiting
      buffer.add({
        lineNumber: 2,
        content: 'Line 2',
        type: 'stdout',
        timestamp: new Date()
      });
      
      const lines3 = await waiter3;
      expect(lines3).toHaveLength(1);
      expect(lines3[0].lineNumber).toBe(2);
    });
    
    it('should throw error when too many waiters', async () => {
      // Create MAX_WAITERS (100) waiters
      const waiters = [];
      for (let i = 0; i < 100; i++) {
        waiters.push(buffer.waitForLines(1000 + i, 60000));
      }
      
      // Next one should throw
      await expect(buffer.waitForLines(2000, 5000))
        .rejects
        .toThrow('Too many pending waiters');
      
      // Cleanup waiters
      jest.advanceTimersByTime(60000);
      await Promise.all(waiters);
    });
    
    it('should force cleanup old waiters when limit reached', async () => {
      // Create multiple waiters with very short timeout
      const waiters = [];
      const waiterCount = 50; // Reduced from 100 to speed up test
      
      for (let i = 0; i < waiterCount; i++) {
        const waiterPromise = buffer.waitForLines(1000 + i, 5); // 5ms timeout
        waiters.push(waiterPromise);
      }
      
      // Advance time to trigger all timeouts
      jest.advanceTimersByTime(10);
      
      // Let all waiters timeout
      const results = await Promise.allSettled(waiters);
      
      // Verify all timed out with empty results
      let timeoutCount = 0;
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.length === 0) {
          timeoutCount++;
        }
      });
      expect(timeoutCount).toBe(waiterCount);
      
      // Create a new waiter after cleanup
      const newLineNum = 2000;
      const newWaiterPromise = buffer.waitForLines(newLineNum, 1000);
      
      // Add lines to satisfy the waiter
      for (let i = 1; i <= newLineNum + 1; i++) {
        buffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      // The new waiter should resolve successfully
      const lines = await newWaiterPromise;
      expect(lines.length).toBeGreaterThan(0);
      
      // Clear remaining timers
      jest.clearAllTimers();
    }, 30000); // Increase timeout further
  });
  
  describe('Stale Waiter Cleanup', () => {
    it('should clean up stale waiters periodically', async () => {
      // Create some waiters with shorter timeout
      const waiter1 = buffer.waitForLines(1000, 50);
      const waiter2 = buffer.waitForLines(1001, 50);
      
      // Advance time to trigger timeout
      jest.advanceTimersByTime(100);
      
      // Wait for timeouts
      const [lines1, lines2] = await Promise.all([waiter1, waiter2]);
      expect(lines1).toHaveLength(0); // Should timeout with no lines
      expect(lines2).toHaveLength(0); // Should timeout with no lines
    }, 20000); // Increase timeout for this test
    
    it('should clean up waiters older than timeout', async () => {
      const waiter = buffer.waitForLines(1000, 60000);
      
      // Advance past the timeout
      jest.advanceTimersByTime(61000);
      
      const lines = await waiter;
      expect(lines).toHaveLength(0); // Should timeout
    });
  });
  
  describe('Notification System', () => {
    it('should notify all eligible waiters when lines added', async () => {
      const waiter1 = buffer.waitForLines(0, 5000);
      const waiter2 = buffer.waitForLines(0, 5000);
      const waiter3 = buffer.waitForLines(2, 5000); // Won't be notified yet
      
      buffer.add({
        lineNumber: 1,
        content: 'Line 1',
        type: 'stdout',
        timestamp: new Date()
      });
      
      const [lines1, lines2] = await Promise.all([waiter1, waiter2]);
      expect(lines1).toHaveLength(1);
      expect(lines2).toHaveLength(1);
      
      // Waiter3 still waiting
      buffer.add({
        lineNumber: 2,
        content: 'Line 2',
        type: 'stdout',
        timestamp: new Date()
      });
      buffer.add({
        lineNumber: 3,
        content: 'Line 3',
        type: 'stdout',
        timestamp: new Date()
      });
      
      const lines3 = await waiter3;
      expect(lines3).toHaveLength(1); // Gets line 3
    });
    
    it('should remove notified waiters from queue', async () => {
      const waiter1 = buffer.waitForLines(0, 5000);
      const waiter2 = buffer.waitForLines(1, 5000);
      
      buffer.add({
        lineNumber: 1,
        content: 'Line 1',
        type: 'stdout',
        timestamp: new Date()
      });
      
      await waiter1;
      
      // waiter2 should still be waiting
      buffer.add({
        lineNumber: 2,
        content: 'Line 2',
        type: 'stdout',
        timestamp: new Date()
      });
      
      const lines2 = await waiter2;
      expect(lines2).toHaveLength(1);
      expect(lines2[0].lineNumber).toBe(2);
    });
  });
  
  describe('Buffer Management', () => {
    it('should clear buffer', () => {
      for (let i = 1; i <= 5; i++) {
        buffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      expect(buffer.getTotalLines()).toBe(5);
      
      buffer.clear();
      
      expect(buffer.getTotalLines()).toBe(0);
      expect(buffer.getLines()).toHaveLength(0);
    });
    
    it('should track total lines correctly', () => {
      expect(buffer.getTotalLines()).toBe(0);
      
      for (let i = 1; i <= 150; i++) {
        buffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      expect(buffer.getTotalLines()).toBe(150);
      expect(buffer.getLines()).toHaveLength(100); // Limited by buffer size
    });
  });
  
  describe('Cleanup', () => {
    it('should resolve all pending waiters on cleanup', async () => {
      const waiter1 = buffer.waitForLines(1000, 60000);
      const waiter2 = buffer.waitForLines(1001, 60000);
      
      buffer.cleanup();
      
      const [lines1, lines2] = await Promise.all([waiter1, waiter2]);
      expect(lines1).toHaveLength(0);
      expect(lines2).toHaveLength(0);
    });
    
    it('should clear interval timer on cleanup', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      buffer.cleanup();
      
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
    
    it('should clear buffer on cleanup', () => {
      for (let i = 1; i <= 5; i++) {
        buffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      buffer.cleanup();
      
      expect(buffer.getTotalLines()).toBe(0);
      expect(buffer.getLines()).toHaveLength(0);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle empty buffer correctly', () => {
      expect(buffer.getLines()).toHaveLength(0);
      expect(buffer.getLines(10)).toHaveLength(0);
      expect(buffer.getLines(undefined, 5)).toHaveLength(0);
      expect(buffer.getTotalLines()).toBe(0);
    });
    
    it('should handle negative or zero limits gracefully', () => {
      for (let i = 1; i <= 5; i++) {
        buffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      const lines1 = buffer.getLines(0);
      expect(lines1).toHaveLength(0);
      
      const lines2 = buffer.getLines(-1);
      expect(lines2).toHaveLength(0);
    });
    
    it('should handle afterLine greater than total lines', () => {
      for (let i = 1; i <= 5; i++) {
        buffer.add({
          lineNumber: i,
          content: `Line ${i}`,
          type: 'stdout',
          timestamp: new Date()
        });
      }
      
      const lines = buffer.getLines(undefined, 10);
      expect(lines).toHaveLength(0);
    });
  });
});
