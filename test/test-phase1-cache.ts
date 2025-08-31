#!/usr/bin/env tsx

/**
 * Test script for Phase 1: Cache Management Tools
 * Tests the basic functionality of the new cache management system
 */

import { aiCache } from '../src/ai-cache.js';
import { cacheClassifier, CacheStrategy } from '../src/ai-cache-classifier.js';

console.log('=== Phase 1 Cache Management Test ===\n');

// Test 1: Add some test data to cache
console.log('Test 1: Adding test data to cache...');
aiCache.set('ls -la', '/home/test', {
  stdout: 'total 8\ndrwxr-xr-x  2 user user 4096 Jan  1 12:00 .\ndrwxr-xr-x 10 user user 4096 Jan  1 11:00 ..',
  stderr: '',
  exitCode: 0
});

aiCache.set('git status', '/home/test', {
  stdout: 'On branch main\nnothing to commit, working tree clean',
  stderr: '',
  exitCode: 0
});

aiCache.set('pwd', '/home/test', {
  stdout: '/home/test',
  stderr: '',
  exitCode: 0
});

const stats1 = aiCache.getStats();
console.log(`Cache size after adding: ${stats1.cacheSize}`);
console.log('');

// Test 2: Clear specific command
console.log('Test 2: Clearing "git status" from cache...');
const cleared1 = aiCache.clearCommand('git status');
console.log(`Cleared ${cleared1} entries`);

const stats2 = aiCache.getStats();
console.log(`Cache size after clearing: ${stats2.cacheSize}`);
console.log('');

// Test 3: Clear by pattern
console.log('Test 3: Adding more commands and clearing by pattern...');
aiCache.set('ls', '/home/test', { stdout: 'file1 file2', stderr: '', exitCode: 0 });
aiCache.set('ls -a', '/home/test', { stdout: '. .. file1 file2', stderr: '', exitCode: 0 });
aiCache.set('ls -la', '/home/other', { stdout: 'different output', stderr: '', exitCode: 0 });

const stats3 = aiCache.getStats();
console.log(`Cache size before pattern clear: ${stats3.cacheSize}`);

const cleared2 = aiCache.clearPattern(/^ls/);
console.log(`Cleared ${cleared2} entries matching /^ls/`);

const stats4 = aiCache.getStats();
console.log(`Cache size after pattern clear: ${stats4.cacheSize}`);
console.log('');

// Test 4: Check classification
console.log('Test 4: Testing cache classification...');
const commands = ['git status', 'pwd', 'cat README.md', 'node --version'];
commands.forEach(cmd => {
  const classification = cacheClassifier.classify(cmd);
  const explanation = cacheClassifier.explainClassification(cmd);
  console.log(`Command: "${cmd}"`);
  console.log(`  Strategy: ${CacheStrategy[classification.strategy]}`);
  console.log(`  TTL: ${classification.ttl / 1000}s`);
  console.log(`  Explanation: ${explanation}`);
});

console.log('\n=== Phase 1 Tests Complete ===');
