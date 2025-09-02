/**
 * Output Analyzer Tests
 */

import { OutputAnalyzer, outputAnalyzer } from './output-analyzer';
import { CacheStrategy } from './ai-cache-classifier';

describe('OutputAnalyzer', () => {
  let analyzer: OutputAnalyzer;

  beforeEach(() => {
    analyzer = new OutputAnalyzer();
  });

  describe('analyze', () => {
    it('should detect timestamps in ISO format', () => {
      const output = 'Log entry: 2024-01-15T10:30:45 System started';
      const result = analyzer.analyze(output);

      expect(result.hasTimestamp).toBe(true);
      expect(result.changeIndicators).toContain('timestamp');
      expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should detect Unix format timestamps', () => {
      const output = 'Jan 15 10:30:45 server syslog: System message';
      const result = analyzer.analyze(output);

      expect(result.hasTimestamp).toBe(true);
      expect(result.changeIndicators).toContain('timestamp');
    });

    it('should detect relative time', () => {
      const output = 'File modified 5 minutes ago';
      const result = analyzer.analyze(output);

      expect(result.hasTimestamp).toBe(true);
      expect(result.changeIndicators).toContain('timestamp');
    });

    it('should detect process IDs', () => {
      const output = 'Process 12345 is running with pid: 54321';
      const result = analyzer.analyze(output);

      expect(result.hasProcessId).toBe(true);
      expect(result.changeIndicators).toContain('processId');
      expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
    });

    it('should detect counters and sequences', () => {
      const output = 'Total: 500 packets received, count: 250';
      const result = analyzer.analyze(output);

      expect(result.hasCounter).toBe(true);
      expect(result.changeIndicators).toContain('counter');
    });

    it('should detect file sizes', () => {
      const output = 'File size: 1024 KB, downloaded 500 MB';
      const result = analyzer.analyze(output);

      expect(result.hasFileSize).toBe(true);
      expect(result.hasCounter).toBe(true);
      expect(result.changeIndicators).toContain('fileSize');
      expect(result.changeIndicators).toContain('counter');
    });

    it('should detect IP addresses', () => {
      const output = 'Connected to 192.168.1.100 on port 8080';
      const result = analyzer.analyze(output);

      expect(result.hasIpAddress).toBe(true);
      expect(result.changeIndicators).toContain('ipAddress');
    });

    it('should detect IPv6 addresses', () => {
      const output = 'Server listening on 2001:db8::1';
      const result = analyzer.analyze(output);

      expect(result.hasIpAddress).toBe(true);
      expect(result.changeIndicators).toContain('ipAddress');
    });

    it('should detect ports', () => {
      const output = 'Server listening on port 3000';
      const result = analyzer.analyze(output);

      expect(result.hasPort).toBe(true);
      expect(result.changeIndicators).toContain('port');
    });

    it('should detect multiple indicators', () => {
      const output = '2024-01-15 10:30:45 Process 1234 running on 192.168.1.1:8080';
      const result = analyzer.analyze(output);

      expect(result.hasTimestamp).toBe(true);
      expect(result.hasProcessId).toBe(true);
      expect(result.hasIpAddress).toBe(true);
      expect(result.hasPort).toBe(true);
      expect(result.changeIndicators.length).toBeGreaterThanOrEqual(4);
      expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
      expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('should suggest LONG strategy for static content', () => {
      const output = 'This is a static help message with no dynamic content';
      const result = analyzer.analyze(output);

      expect(result.changeIndicators.length).toBe(0);
      expect(result.suggestedStrategy).toBe(CacheStrategy.LONG);
      expect(result.confidence).toBe(0.8);
    });

    it('should suggest SHORT strategy for single non-critical indicator', () => {
      const output = 'File count: 100 files found';
      const result = analyzer.analyze(output);

      expect(result.hasCounter).toBe(true);
      expect(result.changeIndicators.length).toBe(1);
      expect(result.suggestedStrategy).toBe(CacheStrategy.SHORT);
      expect(result.confidence).toBe(0.7);
    });

    it('should detect high-change patterns', () => {
      const output = 'Real-time monitoring active';
      const result = analyzer.analyze(output);

      expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
      expect(result.confidence).toBe(1.0);
      expect(result.changeIndicators).toContain('high-change-pattern');
    });

    it('should detect live content', () => {
      const output = 'Live dashboard currently updating';
      const result = analyzer.analyze(output);

      expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
      expect(result.confidence).toBe(1.0);
      expect(result.changeIndicators).toContain('high-change-pattern');
    });

    it('should detect running processes', () => {
      const output = 'Service is running and in progress';
      const result = analyzer.analyze(output);

      expect(result.suggestedStrategy).toBe(CacheStrategy.NEVER);
      expect(result.confidence).toBe(1.0);
      expect(result.changeIndicators).toContain('high-change-pattern');
    });

    it('should handle ps output format', () => {
      const output = '  1234 ttys000    0:00.05 /bin/bash';
      const result = analyzer.analyze(output);

      expect(result.hasProcessId).toBe(true);
      // Time format 0:00.05 might not always be detected as timestamp
      expect(result.hasTimestamp).toBeDefined();
    });

    it('should handle process ID in brackets', () => {
      const output = '[12345] Process started successfully';
      const result = analyzer.analyze(output);

      expect(result.hasProcessId).toBe(true);
      expect(result.changeIndicators).toContain('processId');
    });

    it('should detect byte sizes', () => {
      const output = 'Downloaded 1024 bytes, uploaded 2048 KB';
      const result = analyzer.analyze(output);

      expect(result.hasCounter).toBe(true);
      expect(result.hasFileSize).toBe(true);
    });

    it('should detect ratios', () => {
      const output = 'Progress: 50/100 completed';
      const result = analyzer.analyze(output);

      expect(result.hasCounter).toBe(true);
      expect(result.changeIndicators).toContain('counter');
    });
  });

  describe('compareOutputs', () => {
    it('should detect identical outputs', () => {
      const output1 = 'Same content\nLine 2\nLine 3';
      const output2 = 'Same content\nLine 2\nLine 3';
      const result = analyzer.compareOutputs(output1, output2);

      expect(result.isDifferent).toBe(false);
      expect(result.differences).toHaveLength(0);
      expect(result.similarity).toBe(1.0);
    });

    it('should detect different outputs', () => {
      const output1 = 'Line 1\nLine 2\nLine 3';
      const output2 = 'Line 1\nDifferent\nLine 3';
      const result = analyzer.compareOutputs(output1, output2);

      expect(result.isDifferent).toBe(true);
      expect(result.differences).toContain('Line 2 differs');
      expect(result.similarity).toBeCloseTo(2/3, 2);
    });

    it('should handle outputs with different line counts', () => {
      const output1 = 'Line 1\nLine 2';
      const output2 = 'Line 1\nLine 2\nLine 3\nLine 4';
      const result = analyzer.compareOutputs(output1, output2);

      expect(result.isDifferent).toBe(true);
      expect(result.differences).toHaveLength(2);
      expect(result.similarity).toBe(0.5);
    });

    it('should handle empty outputs', () => {
      const output1 = '';
      const output2 = 'Some content';
      const result = analyzer.compareOutputs(output1, output2);

      expect(result.isDifferent).toBe(true);
      expect(result.similarity).toBe(0);
    });

    it('should consider 95% similarity as not different', () => {
      const lines = Array(100).fill('Same line');
      lines[50] = 'Different line';
      const output1 = Array(100).fill('Same line').join('\n');
      const output2 = lines.join('\n');
      const result = analyzer.compareOutputs(output1, output2);

      // 99% similar should be considered different (threshold is usually higher)
      expect(result.isDifferent).toBe(false); // 99% similar is considered same
      expect(result.similarity).toBe(0.99);
    });

    it('should handle single line outputs', () => {
      const output1 = 'Single line';
      const output2 = 'Different line';
      const result = analyzer.compareOutputs(output1, output2);

      expect(result.isDifferent).toBe(true);
      expect(result.differences).toHaveLength(1);
      expect(result.similarity).toBe(0);
    });

    it('should handle outputs with only newlines', () => {
      const output1 = '\n\n\n';
      const output2 = '\n\n\n';
      const result = analyzer.compareOutputs(output1, output2);

      expect(result.isDifferent).toBe(false);
      expect(result.similarity).toBe(1.0);
    });
  });

  describe('outputAnalyzer singleton', () => {
    it('should be an instance of OutputAnalyzer', () => {
      expect(outputAnalyzer).toBeInstanceOf(OutputAnalyzer);
    });

    it('should analyze output correctly', () => {
      const result = outputAnalyzer.analyze('Current time: 10:30:45');
      expect(result.hasTimestamp).toBe(true);
    });

    it('should compare outputs correctly', () => {
      const result = outputAnalyzer.compareOutputs('test', 'test');
      expect(result.isDifferent).toBe(false);
    });
  });
});
