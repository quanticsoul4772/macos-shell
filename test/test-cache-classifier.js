#!/usr/bin/env node

/**
 * Test script to verify smart caching behavior
 * Shows how different commands are cached based on their purpose
 */

import { cacheClassifier } from '../src/ai-cache-classifier.js';

console.log('=== macOS Shell MCP - Smart Cache Classifier Test ===\n');

// Test commands
const testCommands = [
  // Status commands (should NEVER cache)
  'git status',
  'git diff',
  'ls -la',
  'docker ps',
  'ps aux | grep node',
  'df -h',
  'date',
  'tail -f /var/log/system.log',
  'npm ls',
  'curl https://api.github.com/status',
  
  // Short cache commands (30 seconds)
  'pwd',
  'whoami',
  'env | grep PATH',
  'which node',
  
  // Medium cache commands (5 minutes)
  'cat package.json',
  'cat .env',
  'npm run build',
  'git show HEAD',
  
  // Long cache commands (30 minutes)
  'cat README.md',
  'head -20 CHANGELOG.md',
  'wc -l src/*.ts',
  'git config --list',
  
  // Permanent cache commands (1 hour)
  'uname -a',
  'node --version',
  'npm --version',
  'git --help',
  'man ls',
];

console.log('Testing cache classification for common commands:\n');

testCommands.forEach(command => {
  const result = cacheClassifier.explainClassification(command);
  console.log(result);
});

console.log('\n=== Summary ===');
console.log('Status commands like "git status", "ls", "docker ps" are NEVER cached');
console.log('Static commands like "--version" and "--help" are cached for 1 hour');
console.log('Config files get medium caching (5 minutes)');
console.log('This ensures you always get fresh data when checking status!');
