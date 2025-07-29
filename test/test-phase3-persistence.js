#!/usr/bin/env node

/**
 * Test script for Phase 3: Persistent Learning Storage
 * Tests that learned rules are saved and loaded correctly
 */

import { learningPersistence } from '../src/learning-persistence.js';
import { cacheClassifier, CacheStrategy } from '../src/ai-cache-classifier.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const RULES_FILE = path.join(os.homedir(), '.mcp-cache-rules.json');
const BACKUP_FILE = path.join(os.homedir(), '.mcp-cache-rules.backup.json');

console.log('=== Phase 3 Persistence Test ===\n');

// Clean up any existing rules file for testing
try {
  await fs.unlink(RULES_FILE);
  await fs.unlink(BACKUP_FILE);
} catch (error) {
  // Files might not exist, that's OK
}

console.log('Test 1: Initialize with no existing rules...');
await learningPersistence.initialize();
let stats = learningPersistence.getStats();
console.log(`Rules loaded: ${stats.totalRules}`);
console.log('');

console.log('Test 2: Save some rules...');

// Save user rule
await learningPersistence.saveRule({
  pattern: 'git status',
  isRegex: false,
  strategy: CacheStrategy.NEVER,
  reason: 'User marked: Shows current state',
  timestamp: new Date().toISOString(),
  source: 'user'
});

// Save auto-detected rule
await learningPersistence.saveRule({
  pattern: 'docker ps',
  isRegex: false,
  strategy: CacheStrategy.NEVER,
  reason: 'Auto-detected duplicate results',
  timestamp: new Date().toISOString(),
  source: 'auto-detect'
});

// Save regex rule
await learningPersistence.saveRule({
  pattern: '^ls\\s+-',
  isRegex: true,
  strategy: CacheStrategy.NEVER,
  reason: 'User marked: Directory listings change',
  timestamp: new Date().toISOString(),
  source: 'user'
});

// Wait for debounced save
await new Promise(resolve => setTimeout(resolve, 1500));

console.log('Rules saved. Checking file existence...');
try {
  const fileStats = await fs.stat(RULES_FILE);
  console.log(`Rules file exists: ${RULES_FILE} (${fileStats.size} bytes)`);
} catch (error) {
  console.error('Rules file not found!');
}
console.log('');

console.log('Test 3: Simulate restart - create new instance...');
// Create new instance to simulate restart
const learningPersistence2 = new (await import('../src/learning-persistence.js')).LearningPersistence();
await learningPersistence2.initialize();

const loadedRules = learningPersistence2.getRules();
console.log(`Rules loaded after restart: ${loadedRules.length}`);
loadedRules.forEach(rule => {
  console.log(`  - "${rule.pattern}" (${rule.isRegex ? 'regex' : 'exact'}) → ${CacheStrategy[rule.strategy]} [${rule.source}]`);
});
console.log('');

console.log('Test 4: Update existing rule (hit count)...');
// Save the same rule again - should update hit count
await learningPersistence2.saveRule({
  pattern: 'git status',
  isRegex: false,
  strategy: CacheStrategy.NEVER,
  reason: 'User marked: Shows current state',
  timestamp: new Date().toISOString(),
  source: 'user'
});

// Wait for save
await new Promise(resolve => setTimeout(resolve, 1500));

const updatedRules = learningPersistence2.getRules();
const gitStatusRule = updatedRules.find(r => r.pattern === 'git status');
console.log(`Git status rule hit count: ${gitStatusRule?.hitCount}`);
console.log('');

console.log('Test 5: Test statistics...');
const finalStats = learningPersistence2.getStats();
console.log(JSON.stringify(finalStats, null, 2));
console.log('');

console.log('Test 6: Backup file creation...');
// Force another save to create backup
await learningPersistence2.saveRule({
  pattern: 'pwd',
  isRegex: false,
  strategy: CacheStrategy.SHORT,
  reason: 'Test backup',
  timestamp: new Date().toISOString(),
  source: 'user'
});

await new Promise(resolve => setTimeout(resolve, 1500));

try {
  const backupStats = await fs.stat(BACKUP_FILE);
  console.log(`Backup file exists: ${BACKUP_FILE} (${backupStats.size} bytes)`);
} catch (error) {
  console.error('Backup file not found!');
}

console.log('Test 7: Remove a rule...');
const removed = await learningPersistence2.removeRule('pwd', false);
console.log(`Rule removed: ${removed}`);

await new Promise(resolve => setTimeout(resolve, 1500));

const afterRemoval = learningPersistence2.getRules();
console.log(`Rules after removal: ${afterRemoval.length}`);

console.log('\n=== Phase 3 Tests Complete ===');

// Clean up test files
console.log('\nCleaning up test files...');
try {
  await fs.unlink(RULES_FILE);
  await fs.unlink(BACKUP_FILE);
  console.log('Test files cleaned up.');
} catch (error) {
  console.error('Failed to clean up test files:', error.message);
}
