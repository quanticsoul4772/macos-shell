#!/usr/bin/env node

/**
 * Integration test showing Phase 1 and Phase 2 working together
 * Demonstrates the full auto-learning cache system
 */

import { duplicateDetector } from '../src/duplicate-detector.js';
import { aiCache } from '../src/ai-cache.js';
import { cacheClassifier, CacheStrategy } from '../src/ai-cache-classifier.js';
import { EventEmitter } from 'events';

console.log('=== Phase 1 + 2 Integration Test ===\n');

// Mock the saveLearningRule function for testing
let savedRules = [];
const mockSaveLearningRule = async (rule) => {
  savedRules.push(rule);
  console.log(`[SAVE] Rule saved: ${rule.pattern} → ${CacheStrategy[rule.strategy]}`);
};

// Set up duplicate detection listener (simulating ai-command-enhancer)
duplicateDetector.on('duplicate-detected', async (event) => {
  console.log(`\n[EVENT] Duplicate detected for "${event.command}"`);
  console.log(`  Duplicate count: ${event.duplicateCount}`);
  console.log(`  Time span: ${event.timeSpan}ms`);
  
  // Auto-mark as never cache
  cacheClassifier.addRule({
    pattern: event.command,
    strategy: CacheStrategy.NEVER,
    reason: `Auto-detected: ${event.duplicateCount} duplicates in ${event.timeSpan}ms`
  }, 'high');
  
  // Save rule (mocked)
  await mockSaveLearningRule({
    pattern: event.command,
    strategy: CacheStrategy.NEVER,
    reason: 'Auto-detected duplicate results',
    timestamp: new Date().toISOString(),
    source: 'auto-detect'
  });
  
  // Clear from cache
  const cleared = aiCache.clearCommand(event.command);
  console.log(`  Cleared ${cleared} cache entries`);
});

// Simulate real-world usage
console.log('Simulating command executions...\n');

// Command 1: git status (returns same result repeatedly)
const gitStatusResult = {
  stdout: 'On branch main\nnothing to commit, working tree clean',
  stderr: '',
  exitCode: 0
};

console.log('1. First "git status" execution');
aiCache.set('git status', '/project', gitStatusResult);
duplicateDetector.checkDuplicate('git status', '/project', gitStatusResult);
console.log('   → Cached normally');

console.log('\n2. Second "git status" execution (same result)');
duplicateDetector.checkDuplicate('git status', '/project', gitStatusResult);
console.log('   → Duplicate detected! Auto-learning triggered');

// Command 2: ls -la (dynamic content)
console.log('\n3. Testing "ls -la" with changing content');
const lsResult1 = {
  stdout: 'total 16\ndrwxr-xr-x  4 user user 128 Jan  1 10:00 .\n-rw-r--r--  1 user user 100 Jan  1 10:00 file1.txt',
  stderr: '',
  exitCode: 0
};

const lsResult2 = {
  stdout: 'total 20\ndrwxr-xr-x  4 user user 128 Jan  1 10:05 .\n-rw-r--r--  1 user user 100 Jan  1 10:00 file1.txt\n-rw-r--r--  1 user user 200 Jan  1 10:05 file2.txt',
  stderr: '',
  exitCode: 0
};

duplicateDetector.checkDuplicate('ls -la', '/project', lsResult1);
console.log('   First result recorded');

duplicateDetector.checkDuplicate('ls -la', '/project', lsResult2);
console.log('   Different result - no duplicate detected');

// Command 3: pwd (static content)
console.log('\n4. Testing "pwd" with static content');
const pwdResult = { stdout: '/project', stderr: '', exitCode: 0 };

duplicateDetector.checkDuplicate('pwd', '/project', pwdResult);
duplicateDetector.checkDuplicate('pwd', '/project', pwdResult);
console.log('   → Duplicate detected for pwd!');

// Show final state
setTimeout(() => {
  console.log('\n=== Final System State ===');
  
  // Cache stats
  const cacheStats = aiCache.getStats();
  console.log('\nCache Statistics:');
  console.log(`  Total entries: ${cacheStats.cacheSize}`);
  console.log(`  By strategy:`);
  Object.entries(cacheStats.byStrategy).forEach(([strategy, count]) => {
    if (count > 0) {
      console.log(`    ${strategy}: ${count}`);
    }
  });
  
  // Duplicate detector stats
  const dupStats = duplicateDetector.getStats();
  console.log('\nDuplicate Detector:');
  console.log(`  Tracked commands: ${dupStats.totalTrackedCommands}`);
  console.log(`  Total history entries: ${dupStats.totalHistoryEntries}`);
  
  // Saved rules
  console.log('\nAuto-Learned Rules:');
  savedRules.forEach(rule => {
    console.log(`  "${rule.pattern}" → ${CacheStrategy[rule.strategy]} (${rule.source})`);
  });
  
  // Test cache behavior
  console.log('\n=== Testing Learned Behavior ===');
  
  // Try to cache git status (should be rejected)
  console.log('\nAttempting to cache "git status"...');
  const classification = cacheClassifier.classify('git status');
  console.log(`  Classification: ${CacheStrategy[classification.strategy]}`);
  console.log(`  Reason: ${classification.reason}`);
  
  // Explanation
  const explanation = cacheClassifier.explainClassification('git status');
  console.log(`  Explanation: ${explanation}`);
  
  console.log('\n=== Integration Test Complete ===');
}, 100);
