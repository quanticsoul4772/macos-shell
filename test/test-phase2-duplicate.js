#!/usr/bin/env node

/**
 * Test script for Phase 2: Duplicate Detection System
 * Tests automatic detection of duplicate command results
 */

import { duplicateDetector } from '../src/duplicate-detector.js';
import { aiCache } from '../src/ai-cache.js';
import { cacheClassifier, CacheStrategy } from '../src/ai-cache-classifier.js';

console.log('=== Phase 2 Duplicate Detection Test ===\n');

// Test 1: Basic duplicate detection
console.log('Test 1: Basic duplicate detection...');

// Simulate command results
const result1 = {
  stdout: 'On branch main\nnothing to commit, working tree clean',
  stderr: '',
  exitCode: 0
};

// First execution - should not be duplicate
const isDup1 = duplicateDetector.checkDuplicate('git status', '/home/test', result1);
console.log(`First execution - is duplicate? ${isDup1}`);

// Second execution with same result - should trigger duplicate
const isDup2 = duplicateDetector.checkDuplicate('git status', '/home/test', result1);
console.log(`Second execution - is duplicate? ${isDup2}`);

// Wait a moment and do third execution
setTimeout(() => {
  const isDup3 = duplicateDetector.checkDuplicate('git status', '/home/test', result1);
  console.log(`Third execution - is duplicate? ${isDup3}`);
  console.log('');
  
  // Test 2: Different results should not trigger duplicate
  console.log('Test 2: Different results should not trigger duplicate...');
  
  const result2 = {
    stdout: 'On branch main\nChanges not staged for commit',
    stderr: '',
    exitCode: 0
  };
  
  const isDup4 = duplicateDetector.checkDuplicate('git status', '/home/test', result2);
  console.log(`Different result - is duplicate? ${isDup4}`);
  console.log('');
  
  // Test 3: Detection window test
  console.log('Test 3: Testing detection window (5 seconds)...');
  console.log('Adding duplicate result...');
  duplicateDetector.checkDuplicate('pwd', '/home/test', { stdout: '/home/test', stderr: '', exitCode: 0 });
  
  console.log('Waiting 6 seconds for detection window to expire...');
  setTimeout(() => {
    // After 6 seconds, should not be duplicate
    const isDupAfterWindow = duplicateDetector.checkDuplicate('pwd', '/home/test', { stdout: '/home/test', stderr: '', exitCode: 0 });
    console.log(`After detection window - is duplicate? ${isDupAfterWindow}`);
    console.log('');
    
    // Test 4: Get statistics
    console.log('Test 4: Duplicate detector statistics...');
    const stats = duplicateDetector.getStats();
    console.log(JSON.stringify(stats, null, 2));
    console.log('');
    
    // Test 5: Clear history
    console.log('Test 5: Clear history for specific command...');
    duplicateDetector.clearHistory('git status');
    const statsAfterClear = duplicateDetector.getStats();
    console.log(`Commands tracked after clearing 'git status': ${statsAfterClear.totalTrackedCommands}`);
    
    console.log('\n=== Phase 2 Tests Complete ===');
  }, 6000);
}, 100);
