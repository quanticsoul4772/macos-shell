import { searchOutputLines, formatOutputLines } from './process-search.js';
import { OutputLine } from '../../background-process.js';

function makeLine(lineNumber: number, content: string, type: 'stdout' | 'stderr' = 'stdout'): OutputLine {
  return { lineNumber, content, type, timestamp: new Date() };
}

describe('process-search', () => {
  const sampleLines: OutputLine[] = [
    makeLine(1, 'Starting server on port 3000'),
    makeLine(2, 'Connected to database'),
    makeLine(3, 'Error: connection refused'),
    makeLine(4, 'Retrying connection...'),
    makeLine(5, 'Connected successfully'),
    makeLine(6, 'Listening for requests'),
  ];

  describe('searchOutputLines', () => {
    it('should return all lines when no search is provided', () => {
      const result = searchOutputLines(sampleLines);
      expect(result.filteredLines).toEqual(sampleLines);
      expect(result.searchInfo).toBe('');
    });

    it('should return all lines when search is undefined', () => {
      const result = searchOutputLines(sampleLines, {});
      expect(result.filteredLines).toEqual(sampleLines);
    });

    it('should filter by case-insensitive text search', () => {
      const result = searchOutputLines(sampleLines, { search: 'connected' });
      expect(result.filteredLines).toHaveLength(2);
      expect(result.filteredLines[0].content).toBe('Connected to database');
      expect(result.filteredLines[1].content).toBe('Connected successfully');
    });

    it('should filter by case-sensitive text search', () => {
      const result = searchOutputLines(sampleLines, {
        search: 'connected',
        caseSensitive: true,
      });
      expect(result.filteredLines).toHaveLength(0);
    });

    it('should filter by regex search', () => {
      const result = searchOutputLines(sampleLines, {
        search: 'port \\d+',
        searchType: 'regex',
      });
      expect(result.filteredLines).toHaveLength(1);
      expect(result.filteredLines[0].content).toContain('port 3000');
    });

    it('should handle case-insensitive regex', () => {
      const result = searchOutputLines(sampleLines, {
        search: 'error',
        searchType: 'regex',
        caseSensitive: false,
      });
      expect(result.filteredLines).toHaveLength(1);
      expect(result.filteredLines[0].content).toContain('Error');
    });

    it('should handle case-sensitive regex', () => {
      const result = searchOutputLines(sampleLines, {
        search: 'error',
        searchType: 'regex',
        caseSensitive: true,
      });
      expect(result.filteredLines).toHaveLength(0);
    });

    it('should return error info for invalid regex', () => {
      const result = searchOutputLines(sampleLines, {
        search: '[invalid',
        searchType: 'regex',
      });
      expect(result.filteredLines).toHaveLength(0);
      expect(result.searchInfo).toContain('Invalid regex');
    });

    it('should support inverted matching', () => {
      const result = searchOutputLines(sampleLines, {
        search: 'connect',
        invertMatch: true,
      });
      // Lines NOT containing "connect": "Starting server..." and "Listening for requests"
      expect(result.filteredLines).toHaveLength(2);
      expect(result.searchInfo).toContain('inverted');
    });

    it('should include context lines', () => {
      const result = searchOutputLines(sampleLines, {
        search: 'Error',
        showContext: 1,
      });
      // Line 3 matches, context includes line 2 and line 4
      expect(result.filteredLines).toHaveLength(3);
      expect(result.filteredLines[0].lineNumber).toBe(2);
      expect(result.filteredLines[1].lineNumber).toBe(3);
      expect(result.filteredLines[2].lineNumber).toBe(4);
      expect(result.searchInfo).toContain('Context: 1 line');
    });

    it('should handle context at boundaries', () => {
      const result = searchOutputLines(sampleLines, {
        search: 'Starting',
        showContext: 2,
      });
      // Line 1 matches, context goes up to line 3
      expect(result.filteredLines).toHaveLength(3);
      expect(result.filteredLines[0].lineNumber).toBe(1);
    });

    it('should track matched line numbers', () => {
      const result = searchOutputLines(sampleLines, { search: 'Error' });
      expect(result.actualMatchedLineNumbers.has(3)).toBe(true);
      expect(result.matchedIndices.has(2)).toBe(true); // index 2
    });
  });

  describe('formatOutputLines', () => {
    const lines: OutputLine[] = [
      makeLine(1, 'hello', 'stdout'),
      makeLine(2, 'warning', 'stderr'),
      makeLine(3, 'world', 'stdout'),
    ];

    it('should format lines with standard formatting', () => {
      const output = formatOutputLines(lines);
      expect(output).toBe(
        '[1] [OUT] hello\n[2] [ERR] warning\n[3] [OUT] world'
      );
    });

    it('should add visual indicators with context search', () => {
      const matched = new Set([1, 3]);
      const output = formatOutputLines(lines, matched, 1, true);
      expect(output).toContain('>>> hello');
      expect(output).toContain('    warning'); // not matched, indented
      expect(output).toContain('>>> world');
    });

    it('should use standard formatting without search context', () => {
      const output = formatOutputLines(lines, undefined, 0, false);
      expect(output).not.toContain('>>>');
    });
  });
});
