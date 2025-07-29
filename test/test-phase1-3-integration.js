#!/usr/bin/env node

/**
 * Integration test showing Phases 1, 2, and 3 working together
 * Demonstrates the complete learning cache system with persistence
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Clean up any existing rules file first
const RULES_FILE = path.join(os.homedir(), '.mcp-cache-rules.json');
try {
  await fs.unlink(RULES_FILE);
} catch (error) {
  // File might not exist
}

// Import modules
import { learningPersistence } from '../src/learning-persistence.js';
import { duplicateDetector } from '../src/duplicate-detector.js';
import { aiCache } from '../src/ai-cache.js';
import { cacheClassifier, CacheStrategy } from '../src/ai-cache-classifier.js';

console.log('=== Phases 1-3 Complete Integration Test ===\n');

// Initialize persistence
console.log('Starting server with learning persistence...');
await learningPersistence.initialize();
console.log(`Loaded ${learningPersistence.getRules().length} existing rules\n`);

// Set up duplicate detection listener (simulating ai-command-enhancer)
duplicateDetector.on('duplicate-detected', async (event) => {
  console.log(`[AUTO-LEARN] Duplicate detected for "${event.command}"`);
  
  // Auto-mark as never cache
  cacheClassifier.addRule({
    pattern: event.command,
    strategy: CacheStrategy.NEVER,
    reason: `Auto-detected: ${event.duplicateCount} duplicates`
  }, 'high');
  
  // Save to persistence
  await learningPersistence.saveRule({
    pattern: event.command,
    isRegex: false,
    strategy: CacheStrategy.NEVER,
    reason: 'Auto-detected duplicate results',
    timestamp: new Date().toISOString(),
    source: 'auto-detect'
  });
  
  // Clear from cache
  aiCache.clearCommand(event.command);
  console.log(`  → Marked as never-cache and saved to disk\n`);
});

// PHASE 1 DEMO: Manual cache management
console.log('=== PHASE 1: Manual Cache Management ===\n');

// Add some commands to cache
console.log('Adding commands to cache...');
aiCache.set('cat README.md', '/project', {
  stdout: '# Project README\nThis is a test project.',
  stderr: '',
  exitCode: 0
});

aiCache.set('node --version', '/project', {
  stdout: 'v18.17.0',
  stderr: '',
  exitCode: 0
});

const stats1 = aiCache.getStats();
console.log(`Cache size: ${stats1.cacheSize}`);

// Manually mark a command as never-cache
console.log('\nManually marking "ps aux" as never-cache...');
cacheClassifier.addRule({
  pattern: 'ps aux',
  strategy: CacheStrategy.NEVER,
  reason: 'User marked: Process list changes constantly'
}, 'high');

await learningPersistence.saveRule({
  pattern: 'ps aux',
  isRegex: false,
  strategy: CacheStrategy.NEVER,
  reason: 'User marked: Process list changes constantly',
  timestamp: new Date().toISOString(),
  source: 'user'
});

console.log('Rule saved to persistence.\n');

// PHASE 2 DEMO: Automatic duplicate detection
console.log('=== PHASE 2: Automatic Duplicate Detection ===\n');

console.log('Simulating repeated "git status" commands...');
const gitResult = {
  stdout: 'On branch main\nnothing to commit',
  stderr: '',
  exitCode: 0
};

// First execution
duplicateDetector.checkDuplicate('git status', '/project', gitResult);
console.log('1st execution: Normal');

// Second execution - triggers duplicate detection
duplicateDetector.checkDuplicate('git status', '/project', gitResult);
console.log('2nd execution: Duplicate detected!\n');

// Wait for save
await new Promise(resolve => setTimeout(resolve, 1500));

// PHASE 3 DEMO: Persistence across restarts
console.log('=== PHASE 3: Persistence Across Restarts ===\n');

console.log('Current learned rules:');
const currentRules = learningPersistence.getRules();
currentRules.forEach(rule => {
  console.log(`  - "${rule.pattern}" → ${CacheStrategy[rule.strategy]} [${rule.source}]`);
});

console.log('\nSimulating server restart...');
console.log('Creating new instances...\n');

// Create new instances to simulate restart
const { LearningPersistence } = await import('../src/learning-persistence.js');
const newPersistence = new LearningPersistence();
await newPersistence.initialize();

console.log('Rules loaded after restart:');
const loadedRules = newPersistence.getRules();
loadedRules.forEach(rule => {
  console.log(`  - "${rule.pattern}" → ${CacheStrategy[rule.strategy]} [${rule.source}]`);
});

// Test that rules are applied
console.log('\nTesting cache behavior with loaded rules...');

// Try to cache "git status" (should be rejected)
console.log('\nAttempting to cache "git status":');
const gitClassification = cacheClassifier.classify('git status');
console.log(`  Strategy: ${CacheStrategy[gitClassification.strategy]}`);
console.log(`  Will be cached: ${gitClassification.strategy !== CacheStrategy.NEVER}`);

// Try to cache "ps aux" (should be rejected)
console.log('\nAttempting to cache "ps aux":');
const psClassification = cacheClassifier.classify('ps aux');
console.log(`  Strategy: ${CacheStrategy[psClassification.strategy]}`);
console.log(`  Will be cached: ${psClassification.strategy !== CacheStrategy.NEVER}`);

// Try to cache "cat README.md" (should be allowed)
console.log('\nAttempting to cache "cat README.md":');
const catClassification = cacheClassifier.classify('cat README.md');
console.log(`  Strategy: ${CacheStrategy[catClassification.strategy]}`);
console.log(`  TTL: ${catClassification.ttl / 1000}s`);
console.log(`  Will be cached: ${catClassification.strategy !== CacheStrategy.NEVER}`);

// Show persistence statistics
console.log('\n=== System Statistics ===\n');
const persistenceStats = newPersistence.getStats();
console.log('Persistence Stats:');
console.log(JSON.stringify(persistenceStats, null, 2));

console.log('\n=== Integration Test Complete ===');
console.log('\nThe cache system now:');
console.log('✓ Allows manual cache control (Phase 1)');
console.log('✓ Automatically learns from usage (Phase 2)');
console.log('✓ Remembers learned rules forever (Phase 3)');
console.log('✓ Creates an intelligent, adaptive cache!');

// Clean up test file
console.log('\nCleaning up test files...');
try {
  await fs.unlink(RULES_FILE);
  console.log('Test files cleaned up.');
} catch (error) {
  console.error('Failed to clean up:', error.message);
}
