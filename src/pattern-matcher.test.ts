import { PatternMatcher, PatternType, createPatternMatcher } from './pattern-matcher';
import { OutputLine } from './background-process';
import { jest } from '@jest/globals';

describe('PatternMatcher', () => {
  describe('Text Pattern Matching', () => {
    let matcher: PatternMatcher;

    beforeEach(() => {
      matcher = createPatternMatcher(PatternType.TEXT);
    });

    it('should validate text patterns', () => {
      expect(matcher.validate('test')).toEqual({ valid: true, complexity: 1 });
      expect(matcher.validate('')).toEqual({ valid: false, error: 'Pattern cannot be empty' });
      expect(matcher.validate('a'.repeat(1001))).toEqual({ 
        valid: false, 
        error: 'Pattern too long (max 1000 characters)' 
      });
    });

    it('should match text patterns case-sensitive', () => {
      const result = matcher.match('Hello World', 'World', { caseSensitive: true });
      
      expect(result).toBeDefined();
      expect(result?.matchedText).toBe('World');
      expect(result?.startIndex).toBe(6);
      expect(result?.endIndex).toBe(11);
    });

    it('should match text patterns case-insensitive', () => {
      const result = matcher.match('Hello World', 'world', { caseSensitive: false });
      
      expect(result).toBeDefined();
      expect(result?.matchedText).toBe('World');
    });

    it('should return null for non-matching text', () => {
      const result = matcher.match('Hello World', 'Goodbye');
      expect(result).toBeNull();
    });

    it('should handle inverted matching', () => {
      const result = matcher.match('Hello World', 'Goodbye', { invertMatch: true });
      expect(result).toBeDefined(); // Should match because pattern is NOT found
      
      const result2 = matcher.match('Hello World', 'World', { invertMatch: true });
      expect(result2).toBeNull(); // Should not match because pattern IS found
    });

    it('should match multiple lines', () => {
      const lines: OutputLine[] = [
        { timestamp: new Date(), type: 'stdout', content: 'Line with test', lineNumber: 1 },
        { timestamp: new Date(), type: 'stdout', content: 'Line without', lineNumber: 2 },
        { timestamp: new Date(), type: 'stdout', content: 'Another test line', lineNumber: 3 },
      ];

      const matches = matcher.matchMultiple(lines, 'test');
      
      expect(matches).toHaveLength(2);
      expect(matches[0].line.lineNumber).toBe(1);
      expect(matches[1].line.lineNumber).toBe(3);
    });

    it('should respect maxMatches option', () => {
      const lines: OutputLine[] = Array(10).fill(null).map((_, i) => ({
        timestamp: new Date(),
        type: 'stdout' as const,
        content: 'test line',
        lineNumber: i
      }));

      const matches = matcher.matchMultiple(lines, 'test', { maxMatches: 3 });
      expect(matches).toHaveLength(3);
    });
  });

  describe('Regex Pattern Matching', () => {
    let matcher: PatternMatcher;

    beforeEach(() => {
      matcher = createPatternMatcher(PatternType.REGEX);
    });

    it('should validate regex patterns', () => {
      expect(matcher.validate('\\d+')).toEqual({ valid: true, complexity: expect.any(Number) });
      expect(matcher.validate('[a-z]+')).toEqual({ valid: true, complexity: expect.any(Number) });
      expect(matcher.validate('[invalid')).toEqual({ 
        valid: false, 
        error: expect.stringContaining('Invalid regex') 
      });
    });

    it('should detect dangerous regex patterns', () => {
      // Nested quantifiers
      const dangerous = '(a+)+b';
      const result = matcher.validate(dangerous);
      expect(result.complexity).toBeGreaterThan(50);
      
      // Multiple unbounded wildcards
      const dangerous2 = '.*.*.*.*';
      const result2 = matcher.validate(dangerous2);
      expect(result2.complexity).toBeGreaterThan(20);
    });

    it('should match regex patterns', () => {
      const result = matcher.match('Error code: 404', '\\d+');
      
      expect(result).toBeDefined();
      expect(result?.matchedText).toBe('404');
    });

    it('should extract capture groups', () => {
      const result = matcher.match(
        'Request to /api/users completed in 1523ms',
        'Request to (.+) completed in (\\d+)ms',
        { extractGroups: true }
      );
      
      expect(result).toBeDefined();
      expect(result?.captureGroups).toEqual({
        '1': '/api/users',
        '2': '1523'
      });
    });

    it('should handle case-insensitive regex', () => {
      const result = matcher.match('ERROR: Something failed', 'error', { caseSensitive: false });
      expect(result).toBeDefined();
      
      const result2 = matcher.match('ERROR: Something failed', 'error', { caseSensitive: true });
      expect(result2).toBeNull();
    });

    it('should cache compiled regex patterns', () => {
      // First call compiles the regex
      matcher.match('test 123', '\\d+');
      
      const statsBefore = matcher.getCacheStats();
      expect(statsBefore.size).toBe(1);
      
      // Second call should use cached regex
      matcher.match('test 456', '\\d+');
      
      const statsAfter = matcher.getCacheStats();
      expect(statsAfter.size).toBe(1); // Same size, reused pattern
    });

    it('should clear cache', () => {
      matcher.match('test', '\\w+');
      expect(matcher.getCacheStats().size).toBe(1);
      
      matcher.clearCache();
      expect(matcher.getCacheStats().size).toBe(0);
    });

    it('should handle regex execution errors', () => {
      // Invalid regex that passes initial validation but fails during execution
      // This is a contrived example - in reality, most errors are caught during validation
      expect(() => {
        matcher.match('test', '(?!');
      }).toThrow('Invalid regex');
    });
  });

  describe('Glob Pattern Matching', () => {
    let matcher: PatternMatcher;

    beforeEach(() => {
      matcher = createPatternMatcher(PatternType.GLOB);
    });

    it('should validate glob patterns', () => {
      expect(matcher.validate('*.txt')).toEqual({ valid: true, complexity: 2 });
      expect(matcher.validate('file?.log')).toEqual({ valid: true, complexity: 2 });
      expect(matcher.validate('[!a-z]*')).toEqual({ valid: true, complexity: 2 });
    });

    it('should match glob patterns with *', () => {
      const result = matcher.match('test.txt', '*.txt');
      expect(result).toBeDefined();
      
      const result2 = matcher.match('test.log', '*.txt');
      expect(result2).toBeNull();
    });

    it('should match glob patterns with ?', () => {
      const result = matcher.match('file1.txt', 'file?.txt');
      expect(result).toBeDefined();
      
      const result2 = matcher.match('file12.txt', 'file?.txt');
      expect(result2).toBeNull(); // ? matches single character only
    });

    it('should match glob patterns with character classes', () => {
      const result = matcher.match('file1.txt', 'file[0-9].txt');
      expect(result).toBeDefined();
      
      const result2 = matcher.match('fileA.txt', 'file[0-9].txt');
      expect(result2).toBeNull();
    });

    it('should match glob patterns with negated character classes', () => {
      const result = matcher.match('fileA.txt', 'file[!0-9].txt');
      expect(result).toBeDefined();
      
      const result2 = matcher.match('file1.txt', 'file[!0-9].txt');
      expect(result2).toBeNull();
    });

    it('should convert complex glob patterns correctly', () => {
      const patterns = [
        { glob: '*.log.*', test: 'error.log.1', shouldMatch: true },
        { glob: '*.log.*', test: 'error.txt.1', shouldMatch: false },
        { glob: 'log-[0-9][0-9][0-9][0-9]-*.txt', test: 'log-2024-01.txt', shouldMatch: true },
        { glob: 'log-[0-9][0-9][0-9][0-9]-*.txt', test: 'log-abc-01.txt', shouldMatch: false },
      ];

      patterns.forEach(({ glob, test, shouldMatch }) => {
        const result = matcher.match(test, glob);
        if (shouldMatch) {
          expect(result).toBeDefined();
        } else {
          expect(result).toBeNull();
        }
      });
    });
  });

  describe('Context Matching', () => {
    it('should match with context lines', () => {
      const matcher = createPatternMatcher(PatternType.TEXT);
      const lines: OutputLine[] = [
        { timestamp: new Date(), type: 'stdout', content: 'Line 1', lineNumber: 1 },
        { timestamp: new Date(), type: 'stdout', content: 'Line 2', lineNumber: 2 },
        { timestamp: new Date(), type: 'stdout', content: 'Match this', lineNumber: 3 },
        { timestamp: new Date(), type: 'stdout', content: 'Line 4', lineNumber: 4 },
        { timestamp: new Date(), type: 'stdout', content: 'Line 5', lineNumber: 5 },
      ];

      const results = matcher.matchWithContext(lines, 'Match', { contextLines: 2 });
      
      expect(results).toHaveLength(1);
      expect(results[0].contextBefore).toHaveLength(2);
      expect(results[0].contextBefore[0].content).toBe('Line 1');
      expect(results[0].contextBefore[1].content).toBe('Line 2');
      expect(results[0].contextAfter).toHaveLength(2);
      expect(results[0].contextAfter[0].content).toBe('Line 4');
      expect(results[0].contextAfter[1].content).toBe('Line 5');
    });

    it('should handle context at boundaries', () => {
      const matcher = createPatternMatcher(PatternType.TEXT);
      const lines: OutputLine[] = [
        { timestamp: new Date(), type: 'stdout', content: 'Match at start', lineNumber: 1 },
        { timestamp: new Date(), type: 'stdout', content: 'Line 2', lineNumber: 2 },
      ];

      const results = matcher.matchWithContext(lines, 'Match', { contextLines: 3 });
      
      expect(results).toHaveLength(1);
      expect(results[0].contextBefore).toHaveLength(0); // No lines before
      expect(results[0].contextAfter).toHaveLength(1); // Only one line after
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty line content', () => {
      const matcher = createPatternMatcher(PatternType.TEXT);
      const result = matcher.match('', 'test');
      expect(result).toBeNull();
    });

    it('should handle special characters in text matching', () => {
      const matcher = createPatternMatcher(PatternType.TEXT);
      const specialChars = '.*+?[]{}()|\\^$';
      const result = matcher.match(`Text with ${specialChars}`, specialChars);
      expect(result).toBeDefined();
      expect(result?.matchedText).toBe(specialChars);
    });

    it('should handle very long lines', () => {
      const matcher = createPatternMatcher(PatternType.TEXT);
      const longLine = 'a'.repeat(10000) + 'needle' + 'b'.repeat(10000);
      const result = matcher.match(longLine, 'needle');
      expect(result).toBeDefined();
      expect(result?.startIndex).toBe(10000);
    });

    it('should throw error for invalid pattern during match', () => {
      const matcher = createPatternMatcher(PatternType.TEXT);
      expect(() => {
        matcher.match('test', '');
      }).toThrow('Pattern cannot be empty');
    });

    it('should handle multiple matches in regex with global flag', () => {
      const matcher = createPatternMatcher(PatternType.REGEX);
      const line = 'test1 test2 test3';
      const result = matcher.match(line, 'test\\d');
      
      expect(result).toBeDefined();
      expect(result?.matchedText).toBe('test1'); // First match
    });

    it('should handle undefined capture groups', () => {
      const matcher = createPatternMatcher(PatternType.REGEX);
      const result = matcher.match(
        'test string',
        '(test)|(other)',
        { extractGroups: true }
      );
      
      expect(result).toBeDefined();
      expect(result?.captureGroups).toEqual({
        '1': 'test'
        // Group 2 is undefined and should not be included
      });
    });

    it('should handle patterns with line breaks', () => {
      const matcher = createPatternMatcher(PatternType.TEXT);
      const multiline = 'First line\nSecond line\nThird line';
      const result = matcher.match(multiline, 'Second line');
      
      expect(result).toBeDefined();
      expect(result?.matchedText).toBe('Second line');
    });

    it('should respect capacity limit in pattern cache', () => {
      const matcher = createPatternMatcher(PatternType.REGEX);
      
      // Add patterns up to and beyond capacity (100)
      for (let i = 0; i < 150; i++) {
        matcher.match('test', `pattern${i}`);
      }
      
      const stats = matcher.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(stats.capacity);
    });
  });

  describe('Demo Functions', () => {
    it('should demonstrate text matching', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const { demonstrateTextMatching } = require('./pattern-matcher');
      
      demonstrateTextMatching();
      
      expect(consoleSpy).toHaveBeenCalledWith('Text matches:', expect.any(Number));
      consoleSpy.mockRestore();
    });

    it('should demonstrate regex matching', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const { demonstrateRegexMatching } = require('./pattern-matcher');
      
      demonstrateRegexMatching();
      
      expect(consoleSpy).toHaveBeenCalledWith('Endpoint:', '/api/users');
      expect(consoleSpy).toHaveBeenCalledWith('Duration:', '1523');
      consoleSpy.mockRestore();
    });

    it('should demonstrate glob matching', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const { demonstrateGlobMatching } = require('./pattern-matcher');
      
      demonstrateGlobMatching();
      
      expect(consoleSpy).toHaveBeenCalledWith('Log files:', expect.arrayContaining(['server.log', 'error.log', 'access.log.1']));
      consoleSpy.mockRestore();
    });
  });
});
