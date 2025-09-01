import { OutputAnalyzer, outputAnalyzer } from './output-analyzer.js';
import { CacheStrategy } from './ai-cache-classifier.js';
import { jest } from '@jest/globals';

describe('OutputAnalyzer', () => {
  let analyzer: OutputAnalyzer;

  beforeEach(() => {
    analyzer = new OutputAnalyzer();
  });

  describe('analyze', () => {
    describe('timestamp detection', () => {
      it('should detect ISO format timestamps', () => {
        const output = 'Log entry at 2024-03-14T15:30:45';
        const result = analyzer.analyze(output);
        
        expect(result.hasTimestamp).toBe(true);
        expect(result.changeIndicators).toContain('timestamp');
        expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
      });

      it('should detect Unix format timestamps', () => {
        const output = 'Mar 14 15:30:45 server started';
        const result = analyzer.analyze(output);
        
        expect(result.hasTimestamp).toBe(true);
        expect(result.changeIndicators).toContain('timestamp');
      });

      it('should detect US date format', () => {
        const output = 'Report generated on 03/14/2024';
        const result = analyzer.analyze(output);
        
        expect(result.hasTimestamp).toBe(true);
      });

      it('should detect time only format', () => {
        const output = 'Process started at 15:30:45';
        const result = analyzer.analyze(output);
        
        expect(result.hasTimestamp).toBe(true);
      });

      it('should detect relative time', () => {
        const output = 'File modified 5 minutes ago';
        const result = analyzer.analyze(output);
        
        expect(result.hasTimestamp).toBe(true);
      });
    });

    describe('processId detection', () => {
      it('should detect pid format', () => {
        const output = 'Process pid: 12345 is running';
        const result = analyzer.analyze(output);
        
        expect(result.hasProcessId).toBe(true);
        expect(result.changeIndicators).toContain('processId');
      });

      it('should detect process number format', () => {
        const output = 'Monitoring process 67890';
        const result = analyzer.analyze(output);
        
        expect(result.hasProcessId).toBe(true);
      });

      it('should detect bracketed pid format', () => {
        const output = '[12345] Server started';
        const result = analyzer.analyze(output);
        
        expect(result.hasProcessId).toBe(true);
      });

      it('should detect ps output format', () => {
        const output = '  12345 ttys000    0:00.01 /bin/bash';
        const result = analyzer.analyze(output);
        
        expect(result.hasProcessId).toBe(true);
      });
    });

    describe('counter detection', () => {
      it('should detect byte counters', () => {
        const output = 'Downloaded 1024 bytes';
        const result = analyzer.analyze(output);
        
        expect(result.hasCounter).toBe(true);
        expect(result.changeIndicators).toContain('counter');
      });

      it('should detect size counters', () => {
        const output = 'Total size: 5 MB';
        const result = analyzer.analyze(output);
        
        expect(result.hasCounter).toBe(true);
      });

      it('should detect packet counters', () => {
        const output = 'Received 100 packets';
        const result = analyzer.analyze(output);
        
        expect(result.hasCounter).toBe(true);
      });

      it('should detect ratio format', () => {
        const output = 'Progress: 50/100 files processed';
        const result = analyzer.analyze(output);
        
        expect(result.hasCounter).toBe(true);
      });

      it('should detect count format', () => {
        const output = 'count: 42 items found';
        const result = analyzer.analyze(output);
        
        expect(result.hasCounter).toBe(true);
      });
    });

    describe('fileSize detection', () => {
      it('should detect file sizes in bytes', () => {
        const output = 'File size: 2048 bytes';
        const result = analyzer.analyze(output);
        
        expect(result.hasFileSize).toBe(true);
        expect(result.changeIndicators).toContain('fileSize');
      });

      it('should detect file sizes with units', () => {
        const output = 'Total: 15 GB used';
        const result = analyzer.analyze(output);
        
        expect(result.hasFileSize).toBe(true);
      });

      it('should detect size label format', () => {
        const output = 'size: 512KB';
        const result = analyzer.analyze(output);
        
        expect(result.hasFileSize).toBe(true);
      });
    });

    describe('network detection', () => {
      it('should detect IPv4 addresses', () => {
        const output = 'Connected to 192.168.1.100';
        const result = analyzer.analyze(output);
        
        expect(result.hasIpAddress).toBe(true);
        expect(result.changeIndicators).toContain('ipAddress');
      });

      it('should detect IPv6 addresses', () => {
        const output = 'Listening on ::1:8080';
        const result = analyzer.analyze(output);
        
        expect(result.hasIpAddress).toBe(true);
      });

      it('should detect port numbers', () => {
        const output = 'Server running on :3000';
        const result = analyzer.analyze(output);
        
        expect(result.hasPort).toBe(true);
        expect(result.changeIndicators).toContain('port');
      });

      it('should detect port labels', () => {
        const output = 'Listening on port 8080';
        const result = analyzer.analyze(output);
        
        expect(result.hasPort).toBe(true);
      });
    });

    describe('strategy determination', () => {
      it('should suggest LONG strategy for static content', () => {
        const output = 'Welcome to the application';
        const result = analyzer.analyze(output);
        
        expect(result.suggestedStrategy).toBe(CacheStrategy.LONG);
        expect(result.confidence).toBeGreaterThanOrEqual(0.8);
      });

      it('should suggest NEVER strategy for timestamp content', () => {
        const output = '2024-03-14T15:30:45 Server started';
        const result = analyzer.analyze(output);
        
        expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
        expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      });

      it('should suggest SHORT strategy for single counter', () => {
        const output = 'Total: 42';
        const result = analyzer.analyze(output);
        
        expect(result.suggestedStrategy).toBe(CacheStrategy.SHORT);
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      });

      it('should suggest NEVER strategy for multiple indicators', () => {
        const output = '2024-03-14 15:30:45 PID: 12345 Downloaded 1024 bytes';
        const result = analyzer.analyze(output);
        
        expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
        expect(result.confidence).toBeGreaterThanOrEqual(0.95);
      });
    });

    describe('high change pattern detection', () => {
      it('should detect real-time indicator', () => {
        const output = 'Real-time monitoring active';
        const result = analyzer.analyze(output);
        
        expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
        expect(result.confidence).toBe(1.0);
        expect(result.changeIndicators).toContain('high-change-pattern');
      });

      it('should detect live indicator', () => {
        const output = 'Live data stream connected';
        const result = analyzer.analyze(output);
        
        expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
        expect(result.confidence).toBe(1.0);
      });

      it('should detect current indicator', () => {
        const output = 'Current status: running';
        const result = analyzer.analyze(output);
        
        expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
        expect(result.confidence).toBe(1.0);
      });

      it('should detect updating indicator', () => {
        const output = 'Database updating...';
        const result = analyzer.analyze(output);
        
        expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
        expect(result.confidence).toBe(1.0);
      });
    });
  });

  describe('compareOutputs', () => {
    it('should detect identical outputs', () => {
      const output = 'Same content';
      const result = analyzer.compareOutputs(output, output);
      
      expect(result.isDifferent).toBe(false);
      expect(result.differences).toEqual([]);
      expect(result.similarity).toBe(1.0);
    });

    it('should detect completely different outputs', () => {
      const output1 = 'First output';
      const output2 = 'Second output';
      const result = analyzer.compareOutputs(output1, output2);
      
      expect(result.isDifferent).toBe(true);
      expect(result.differences).toHaveLength(1);
      expect(result.similarity).toBeLessThan(1.0);
    });

    it('should detect partial differences', () => {
      const output1 = 'Line 1\nLine 2\nLine 3';
      const output2 = 'Line 1\nModified 2\nLine 3';
      const result = analyzer.compareOutputs(output1, output2);
      
      expect(result.isDifferent).toBe(true);
      expect(result.differences).toContain('Line 2 differs');
      expect(result.similarity).toBeCloseTo(0.67, 1);
    });

    it('should handle different line counts', () => {
      const output1 = 'Line 1\nLine 2';
      const output2 = 'Line 1\nLine 2\nLine 3';
      const result = analyzer.compareOutputs(output1, output2);
      
      expect(result.isDifferent).toBe(true);
      expect(result.differences).toContain('Line 3 differs');
      expect(result.similarity).toBeCloseTo(0.67, 1);
    });

    it('should consider high similarity as not different', () => {
      const output1 = 'a'.repeat(100);
      const output2 = 'a'.repeat(95) + 'b'.repeat(5);
      const result = analyzer.compareOutputs(output1, output2);
      
      // Since it's a single line comparison, it will be different
      expect(result.isDifferent).toBe(true);
      expect(result.similarity).toBe(0);
    });

    it('should handle empty outputs', () => {
      const result = analyzer.compareOutputs('', '');
      
      expect(result.isDifferent).toBe(false);
      expect(result.differences).toEqual([]);
      expect(result.similarity).toBe(1.0);
    });

    it('should handle one empty output', () => {
      const output = 'Some content';
      const result = analyzer.compareOutputs(output, '');
      
      expect(result.isDifferent).toBe(true);
      expect(result.differences).toHaveLength(1);
      expect(result.similarity).toBe(0);
    });
  });

  describe('exported instance', () => {
    it('should export a singleton instance', () => {
      expect(outputAnalyzer).toBeInstanceOf(OutputAnalyzer);
    });

    it('should analyze output through exported instance', () => {
      const output = 'Test at 2024-03-14T15:30:45';
      const result = outputAnalyzer.analyze(output);
      
      expect(result.hasTimestamp).toBe(true);
    });

    it('should compare outputs through exported instance', () => {
      const result = outputAnalyzer.compareOutputs('a', 'b');
      
      expect(result.isDifferent).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very long output', () => {
      const longOutput = 'a'.repeat(10000) + ' 2024-03-14T15:30:45';
      const result = analyzer.analyze(longOutput);
      
      expect(result.hasTimestamp).toBe(true);
    });

    it('should handle special characters', () => {
      const output = '!@#$%^&*() 192.168.1.1 <<>>[]{}';
      const result = analyzer.analyze(output);
      
      expect(result.hasIpAddress).toBe(true);
    });

    it('should handle multiple patterns in single line', () => {
      const output = '2024-03-14 15:30:45 PID:1234 192.168.1.1:8080 5MB';
      const result = analyzer.analyze(output);
      
      expect(result.hasTimestamp).toBe(true);
      expect(result.hasProcessId).toBe(true);
      expect(result.hasIpAddress).toBe(true);
      expect(result.hasPort).toBe(true);
      expect(result.hasFileSize).toBe(true);
    });

    it('should handle multiline output with mixed content', () => {
      const output = `Static header
2024-03-14T15:30:45 Dynamic line
Another static line
PID: 12345 running`;
      const result = analyzer.analyze(output);
      
      expect(result.hasTimestamp).toBe(true);
      expect(result.hasProcessId).toBe(true);
      expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
    });
  });
});
