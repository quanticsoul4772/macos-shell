#!/usr/bin/env node

/**
 * Test the smart caching fix
 * Run this after rebuilding to verify status commands aren't cached
 */

import { cacheClassifier, CacheStrategy } from '../build/ai-cache-classifier.js';

console.log('Testing Smart Cache Classifier...\n');

// Test status commands (should NEVER cache)
const statusCommands = [
  'git status',
  'ls -la', 
  'docker ps',
  'ps aux',
  'df -h'
];

console.log('Status Commands (should NEVER cache):');
statusCommands.forEach(cmd => {
  const result = cacheClassifier.classify(cmd);
  const pass = result.strategy === CacheStrategy.NEVER ? '✅' : '❌';
  console.log(`${pass} "${cmd}" -> ${result.strategy} (${result.reason})`);
});

console.log('\nCacheable Commands:');

// Test cacheable commands
const cacheableCommands = [
  { cmd: 'pwd', expected: CacheStrategy.SHORT },
  { cmd: 'cat package.json', expected: CacheStrategy.MEDIUM },
  { cmd: 'cat README.md', expected: CacheStrategy.LONG },
  { cmd: 'node --version', expected: CacheStrategy.PERMANENT }
];

cacheableCommands.forEach(({ cmd, expected }) => {
  const result = cacheClassifier.classify(cmd);
  const pass = result.strategy === expected ? '✅' : '❌';
  const ttl = result.ttl / 1000;
  console.log(`${pass} "${cmd}" -> ${result.strategy} (${ttl}s TTL)`);
});

console.log('\nAll tests completed!');
