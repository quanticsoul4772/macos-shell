// Process Search Helper
// Handles search and filtering logic for process output

import { OutputLine } from '../../background-process.js';

export interface SearchOptions {
  search: string;
  searchType: 'text' | 'regex';
  caseSensitive: boolean;
  invertMatch: boolean;
  showContext: number;
}

export interface SearchResult {
  filteredLines: OutputLine[];
  searchInfo: string;
  matchedIndices: Set<number>;
  actualMatchedLineNumbers: Set<number>;
}

/**
 * Creates a matcher function based on search options
 */
function createMatcher(
  search: string,
  searchType: 'text' | 'regex',
  caseSensitive: boolean
): { matcher: (line: string) => boolean; info: string; error?: string } {
  if (searchType === 'regex') {
    try {
      const regexFlags = caseSensitive ? '' : 'i';
      const regex = new RegExp(search, regexFlags);
      
      return {
        matcher: (line: string) => regex.test(line),
        info: `/${search}/${regexFlags || 'no flags'} (regex)`
      };
    } catch (error: any) {
      return {
        matcher: () => false,
        info: '',
        error: `Invalid regex pattern '${search}': ${error.message}`
      };
    }
  }
  
  // Text search
  if (caseSensitive) {
    return {
      matcher: (line: string) => line.includes(search),
      info: `"${search}" (case-sensitive)`
    };
  }
  
  const searchLower = search.toLowerCase();
  return {
    matcher: (line: string) => line.toLowerCase().includes(searchLower),
    info: `"${search}" (case-insensitive)`
  };
}

/**
 * Applies search and filtering to output lines
 */
export function searchOutputLines(
  outputLines: OutputLine[],
  options?: Partial<SearchOptions>
): SearchResult {
  if (!options?.search) {
    return {
      filteredLines: outputLines,
      searchInfo: '',
      matchedIndices: new Set(),
      actualMatchedLineNumbers: new Set()
    };
  }
  
  const {
    search,
    searchType = 'text',
    caseSensitive = false,
    invertMatch = false,
    showContext = 0
  } = options;
  
  const originalCount = outputLines.length;
  const matchedIndices = new Set<number>();
  const actualMatchedLineNumbers = new Set<number>();
  
  // Create matcher
  const { matcher, info, error } = createMatcher(search, searchType, caseSensitive);
  
  if (error) {
    return {
      filteredLines: [],
      searchInfo: error,
      matchedIndices: new Set(),
      actualMatchedLineNumbers: new Set()
    };
  }
  
  let searchInfo = `\nSearch: ${info}`;
  
  // Find matching lines
  outputLines.forEach((line, index) => {
    const matches = matcher(line.content);
    
    // Track actual matches for visual indicators
    if (matches) {
      actualMatchedLineNumbers.add(line.lineNumber);
    }
    
    // Apply invert logic for filtering
    if (matches !== invertMatch) {
      matchedIndices.add(index);
    }
  });
  
  if (invertMatch) {
    searchInfo += ' [inverted]';
  }
  
  // Handle context lines
  let filteredLines: OutputLine[];
  
  if (showContext > 0 && matchedIndices.size > 0) {
    const expandedIndices = expandContextIndices(
      matchedIndices,
      outputLines.length,
      showContext
    );
    
    filteredLines = outputLines.filter((_, index) => expandedIndices.has(index));
    
    searchInfo += `\nContext: ${showContext} line${showContext > 1 ? 's' : ''} before/after`;
    searchInfo += `\nMatches: ${matchedIndices.size} lines (showing ${filteredLines.length} with context)`;
  } else {
    filteredLines = outputLines.filter((_, index) => matchedIndices.has(index));
    searchInfo += `\nMatches: ${filteredLines.length} of ${originalCount} lines`;
  }
  
  return {
    filteredLines,
    searchInfo,
    matchedIndices,
    actualMatchedLineNumbers
  };
}

/**
 * Expands indices to include context lines
 */
function expandContextIndices(
  matchedIndices: Set<number>,
  totalLines: number,
  contextSize: number
): Set<number> {
  const expandedIndices = new Set<number>();
  
  matchedIndices.forEach(index => {
    // Add the match itself
    expandedIndices.add(index);
    
    // Add context before
    for (let i = Math.max(0, index - contextSize); i < index; i++) {
      expandedIndices.add(i);
    }
    
    // Add context after
    for (let i = index + 1; i <= Math.min(totalLines - 1, index + contextSize); i++) {
      expandedIndices.add(i);
    }
  });
  
  return expandedIndices;
}

/**
 * Formats output lines with optional visual indicators
 */
export function formatOutputLines(
  lines: OutputLine[],
  actualMatchedLineNumbers?: Set<number>,
  showContext?: number,
  hasSearch?: boolean
): string {
  if (showContext && showContext > 0 && hasSearch && actualMatchedLineNumbers) {
    // Special formatting with visual indicators
    return lines.map(line => {
      const isMatch = actualMatchedLineNumbers.has(line.lineNumber);
      const prefix = `[${line.lineNumber}] ${line.type === 'stderr' ? '[ERR]' : '[OUT]'}`;
      
      if (isMatch) {
        return `${prefix} >>> ${line.content}`;
      } else {
        return `${prefix}     ${line.content}`;
      }
    }).join("\n");
  }
  
  // Standard formatting
  return lines.map(line => 
    `[${line.lineNumber}] ${line.type === 'stderr' ? '[ERR]' : '[OUT]'} ${line.content}`
  ).join("\n");
}
