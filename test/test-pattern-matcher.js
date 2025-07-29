// Unit tests for PatternMatcher
// Run with: node test/test-pattern-matcher.js

import { PatternMatcher, PatternType, createPatternMatcher } from '../build/pattern-matcher.js';

// Test utilities
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function createMockLines(contents) {
  return contents.map((content, index) => ({
    timestamp: new Date(),
    type: 'stdout',
    content: content,
    lineNumber: index + 1
  }));
}

// Test text pattern matching
function testTextMatching() {
  console.log('\n=== Testing Text Pattern Matching ===');
  const matcher = createPatternMatcher(PatternType.TEXT);
  
  // Test 1: Basic text search
  const lines = createMockLines([
    'Server started successfully',
    'ERROR: Database connection failed',
    'Info: Processing request',
    'ERROR: Timeout occurred',
    'Server stopped'
  ]);
  
  const matches = matcher.matchMultiple(lines, 'ERROR');
  assert(matches.length === 2, 'Should find 2 ERROR lines');
  assert(matches[0].line.lineNumber === 2, 'First match should be line 2');
  assert(matches[1].line.lineNumber === 4, 'Second match should be line 4');
  console.log('✓ Basic text search works');
  
  // Test 2: Case-insensitive search
  const caseMatches = matcher.matchMultiple(lines, 'error', { caseSensitive: false });
  assert(caseMatches.length === 2, 'Case-insensitive should find 2 matches');
  console.log('✓ Case-insensitive search works');
  
  // Test 3: Inverted matching
  const nonErrorLines = matcher.matchMultiple(lines, 'ERROR', { invertMatch: true });
  assert(nonErrorLines.length === 3, 'Should find 3 non-ERROR lines');
  console.log('✓ Inverted matching works');
  
  // Test 4: Max matches limit
  const limitedMatches = matcher.matchMultiple(lines, 'ERROR', { maxMatches: 1 });
  assert(limitedMatches.length === 1, 'Should respect maxMatches limit');
  console.log('✓ Max matches limit works');
  
  // Test 5: Match details
  const singleMatch = matcher.match('Hello ERROR world', 'ERROR');
  assert(singleMatch !== null, 'Should find match');
  assert(singleMatch.matchedText === 'ERROR', 'Should capture matched text');
  assert(singleMatch.startIndex === 6, 'Should have correct start index');
  assert(singleMatch.endIndex === 11, 'Should have correct end index');
  console.log('✓ Match details are correct');
}

// Test regex pattern matching
function testRegexMatching() {
  console.log('\n=== Testing Regex Pattern Matching ===');
  const matcher = createPatternMatcher(PatternType.REGEX);
  
  // Test 1: Basic regex
  const lines = createMockLines([
    'User 123 logged in',
    'User 456 logged out',
    'System message',
    'User 789 session expired'
  ]);
  
  const userMatches = matcher.matchMultiple(lines, 'User \\d+');
  assert(userMatches.length === 3, 'Should find 3 user lines');
  console.log('✓ Basic regex matching works');
  
  // Test 2: Capture groups
  const logLine = 'Request to /api/users completed in 1523ms';
  const match = matcher.match(logLine, 'Request to (.+) completed in (\\d+)ms', {
    extractGroups: true
  });
  
  assert(match !== null, 'Should find match');
  assert(match.captureGroups['1'] === '/api/users', 'Should capture endpoint');
  assert(match.captureGroups['2'] === '1523', 'Should capture duration');
  console.log('✓ Capture groups work');
  
  // Test 3: Complex patterns
  const ipLines = createMockLines([
    'Connection from 192.168.1.1',
    'Invalid IP: 999.999.999.999',
    'Request from 10.0.0.1',
    'Local connection from ::1'
  ]);
  
  const ipPattern = '\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\b';
  const ipMatches = matcher.matchMultiple(ipLines, ipPattern);
  assert(ipMatches.length === 3, 'Should find 3 valid IPs');
  console.log('✓ Complex regex patterns work');
  
  // Test 4: Pattern validation
  const validation = matcher.validate('(.*)*');
  assert(validation.valid === true, 'Should validate dangerous but valid pattern');
  assert(validation.complexity > 50, 'Should have high complexity score');
  console.log('✓ Pattern validation works');
  
  // Test 5: Invalid regex
  try {
    matcher.match('test', '[invalid');
    assert(false, 'Should throw on invalid regex');
  } catch (e) {
    assert(e.message.includes('Invalid regex'), 'Should have proper error message');
    console.log('✓ Invalid regex handling works');
  }
}

// Test glob pattern matching
function testGlobMatching() {
  console.log('\n=== Testing Glob Pattern Matching ===');
  const matcher = createPatternMatcher(PatternType.GLOB);
  
  // Test 1: Star patterns
  const files = createMockLines([
    'server.log',
    'error.log',
    'access.log.1',
    'debug.txt',
    'readme.md',
    'test.log.gz'
  ]);
  
  const logMatches = matcher.matchMultiple(files, '*.log');
  assert(logMatches.length === 2, 'Should match .log files');
  console.log('✓ Basic glob * pattern works');
  
  // Test 2: Question mark pattern
  const match = matcher.match('log1.txt', 'log?.txt');
  assert(match !== null, 'Should match single character wildcard');
  
  const noMatch = matcher.match('log10.txt', 'log?.txt');
  assert(noMatch === null, 'Should not match multiple characters');
  console.log('✓ Glob ? pattern works');
  
  // Test 3: Character classes
  const classMatch = matcher.match('file1.txt', 'file[0-9].txt');
  assert(classMatch !== null, 'Should match character class');
  
  const negatedMatch = matcher.match('fileA.txt', 'file[!0-9].txt');
  assert(negatedMatch !== null, 'Should match negated character class');
  console.log('✓ Character classes work');
  
  // Test 4: Multiple wildcards
  const complexMatches = matcher.matchMultiple(files, '*.log*');
  assert(complexMatches.length === 4, 'Should match all log-related files');
  console.log('✓ Complex glob patterns work');
}

// Test context matching
function testContextMatching() {
  console.log('\n=== Testing Context Matching ===');
  const matcher = createPatternMatcher(PatternType.TEXT);
  
  const lines = createMockLines([
    'Line 1: Setup',
    'Line 2: Starting process',
    'Line 3: ERROR occurred',
    'Line 4: Stack trace line 1',
    'Line 5: Stack trace line 2',
    'Line 6: Recovery attempted',
    'Line 7: Process resumed'
  ]);
  
  const matches = matcher.matchWithContext(lines, 'ERROR', { contextLines: 2 });
  assert(matches.length === 1, 'Should find 1 match');
  
  const { contextBefore, contextAfter } = matches[0];
  assert(contextBefore.length === 2, 'Should have 2 lines before');
  assert(contextBefore[0].content === 'Line 1: Setup', 'First context line correct');
  assert(contextBefore[1].content === 'Line 2: Starting process', 'Second context line correct');
  
  assert(contextAfter.length === 2, 'Should have 2 lines after');
  assert(contextAfter[0].content === 'Line 4: Stack trace line 1', 'First after line correct');
  assert(contextAfter[1].content === 'Line 5: Stack trace line 2', 'Second after line correct');
  
  console.log('✓ Context matching works');
}

// Test performance and safety
function testPerformanceAndSafety() {
  console.log('\n=== Testing Performance and Safety ===');
  const matcher = createPatternMatcher(PatternType.REGEX);
  
  // Test 1: Pattern length limit
  const longPattern = 'a'.repeat(1001);
  const validation = matcher.validate(longPattern);
  assert(!validation.valid, 'Should reject overly long patterns');
  assert(validation.error.includes('too long'), 'Should have appropriate error');
  console.log('✓ Pattern length limit works');
  
  // Test 2: Complexity scoring
  const complexPattern = '(.*)*([a-z]+)*';
  const complexValidation = matcher.validate(complexPattern);
  assert(complexValidation.complexity > 50, 'Should detect high complexity');
  console.log('✓ Complexity scoring works');
  
  // Test 3: Cache functionality
  const lines = createMockLines(['test1', 'test2', 'test3']);
  
  // Run same pattern multiple times
  for (let i = 0; i < 5; i++) {
    matcher.matchMultiple(lines, 'test\\d+');
  }
  
  const stats = matcher.getCacheStats();
  assert(stats.size === 1, 'Should cache compiled patterns');
  assert(stats.patterns[0] === 'test\\d+:true', 'Should have correct cache key');
  console.log('✓ Pattern caching works');
  
  // Test 4: Cache clearing
  matcher.clearCache();
  const clearedStats = matcher.getCacheStats();
  assert(clearedStats.size === 0, 'Should clear cache');
  console.log('✓ Cache clearing works');
}

// Test empty and edge cases
function testEdgeCases() {
  console.log('\n=== Testing Edge Cases ===');
  const matcher = createPatternMatcher(PatternType.TEXT);
  
  // Test 1: Empty pattern
  try {
    matcher.match('test', '');
    assert(false, 'Should reject empty pattern');
  } catch (e) {
    assert(e.message.includes('empty'), 'Should have appropriate error');
    console.log('✓ Empty pattern rejection works');
  }
  
  // Test 2: Empty lines array
  const emptyMatches = matcher.matchMultiple([], 'test');
  assert(emptyMatches.length === 0, 'Should handle empty input');
  console.log('✓ Empty input handling works');
  
  // Test 3: Null/undefined handling
  const nullMatch = matcher.match('', 'test');
  assert(nullMatch === null, 'Should handle empty string');
  console.log('✓ Empty string handling works');
  
  // Test 4: Special characters in text search
  const specialLines = createMockLines([
    'Price is $100.00',
    'Regex pattern: .*',
    'Question?',
    'Path: C:\\Users\\test'
  ]);
  
  const dollarMatch = matcher.match('Price is $100.00', '$100');
  assert(dollarMatch !== null, 'Should handle special chars in text mode');
  console.log('✓ Special character handling works');
}

// Run all tests
async function runAllTests() {
  console.log('Starting PatternMatcher tests...');
  
  try {
    testTextMatching();
    testRegexMatching();
    testGlobMatching();
    testContextMatching();
    testPerformanceAndSafety();
    testEdgeCases();
    
    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
runAllTests();
