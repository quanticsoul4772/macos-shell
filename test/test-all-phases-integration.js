// Test All Phases Integration (1-4)
// Run with: node test/test-all-phases-integration.js

import { AICommandCache } from '../src/ai-cache.js';
import { cacheClassifier, CacheStrategy } from '../src/ai-cache-classifier.js';
import { duplicateDetector } from '../src/duplicate-detector.js';
import { outputAnalyzer } from '../src/output-analyzer.js';
import { learningPersistence } from '../src/learning-persistence.js';

console.log('Testing Complete Cache System Integration (Phases 1-4)\n');

// Initialize components
const aiCache = new AICommandCache();

// Simulate the complete flow
async function demonstrateCompleteSystem() {
  console.log('=== Demonstration: Complete Intelligent Cache System ===\n');
  
  // Scenario 1: Output Analysis (Phase 4) detects dynamic content
  console.log('1. Phase 4 - Output Analysis detects timestamp:');
  const dateOutput = 'Current time: 2025-01-06T15:30:45Z';
  const analysis = outputAnalyzer.analyze(dateOutput);
  console.log(`   Command output: "${dateOutput}"`);
  console.log(`   Analysis: ${analysis.changeIndicators.join(', ')}`);
  console.log(`   Confidence: ${analysis.confidence}`);
  console.log(`   Suggested: ${analysis.suggestedStrategy === CacheStrategy.NEVER ? 'NEVER cache' : 'cache ok'}`);
  
  // Simulate adding low-priority rule
  if (analysis.confidence > 0.8 && analysis.suggestedStrategy === CacheStrategy.NEVER) {
    cacheClassifier.addRule({
      pattern: 'date',
      strategy: CacheStrategy.NEVER,
      reason: `Output analysis: ${analysis.changeIndicators.join(', ')}`
    }, 'low');
    console.log('   → Added low-priority rule\n');
  }
  
  // Scenario 2: Duplicate Detection (Phase 2) confirms pattern
  console.log('2. Phase 2 - Duplicate Detection confirms:');
  const result1 = { stdout: 'Files: 42', stderr: '', exitCode: 0 };
  const result2 = { stdout: 'Files: 42', stderr: '', exitCode: 0 };
  
  // Simulate rapid executions
  duplicateDetector.checkDuplicate('count-files', '/tmp', result1);
  await new Promise(resolve => setTimeout(resolve, 100));
  const isDuplicate = duplicateDetector.checkDuplicate('count-files', '/tmp', result2);
  
  console.log(`   Command: count-files`);
  console.log(`   Duplicate detected: ${isDuplicate}`);
  if (isDuplicate) {
    // Simulate auto-learning
    await learningPersistence.saveRule({
      pattern: 'count-files',
      isRegex: false,
      strategy: CacheStrategy.NEVER,
      reason: 'Auto-detected duplicate results',
      timestamp: new Date().toISOString(),
      source: 'auto-detect'
    });
    console.log('   → Saved to persistent storage\n');
  }
  
  // Scenario 3: Manual Control (Phase 1)
  console.log('3. Phase 1 - Manual Cache Control:');
  console.log('   User marks "docker ps" as never-cache');
  await learningPersistence.saveRule({
    pattern: 'docker ps',
    isRegex: false,
    strategy: CacheStrategy.NEVER,
    reason: 'Container status changes frequently',
    timestamp: new Date().toISOString(),
    source: 'user'
  });
  console.log('   → Rule saved persistently\n');
  
  // Scenario 4: Persistence (Phase 3) - Simulate restart
  console.log('4. Phase 3 - Persistent Learning:');
  console.log('   Simulating server restart...');
  
  // Get current rules
  const rules = learningPersistence.getRules();
  console.log(`   Rules in storage: ${rules.length}`);
  rules.forEach(rule => {
    console.log(`   - ${rule.pattern} (${rule.source}): ${rule.reason}`);
  });
  
  // Show statistics
  const stats = learningPersistence.getStats();
  console.log('\n   Statistics:');
  console.log(`   - By source: user=${stats.bySource.user}, auto=${stats.bySource['auto-detect']}`);
  console.log(`   - Never cache: ${stats.byStrategy[CacheStrategy.NEVER]} rules`);
  
  // Demonstrate complete flow
  console.log('\n=== Complete Flow Example ===');
  console.log('Command: ps aux');
  console.log('1. Execute command → get output');
  
  const psOutput = `USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root         1  0.0  0.1  169352 11424 ?        Ss   10:15   0:02 /sbin/init
root       742  0.0  0.0  170812  8832 ?        Ss   10:15   0:00 /lib/systemd/systemd-journald`;
  
  console.log('2. Phase 4 analyzes output:');
  const psAnalysis = outputAnalyzer.analyze(psOutput);
  console.log(`   - Detected: ${psAnalysis.changeIndicators.join(', ')}`);
  console.log(`   - Strategy: ${psAnalysis.suggestedStrategy === CacheStrategy.NEVER ? 'NEVER' : 'CACHE'}`);
  
  console.log('3. Phase 2 monitors for duplicates');
  console.log('4. Phase 3 saves any learned patterns');
  console.log('5. Phase 1 allows manual override if needed');
  
  console.log('\n=== System Benefits ===');
  console.log('✓ Proactive: Detects dynamic content before caching');
  console.log('✓ Reactive: Learns from duplicate patterns');
  console.log('✓ Persistent: Remembers across restarts');
  console.log('✓ Controllable: Manual override always available');
  console.log('✓ Intelligent: Multi-layered decision making');
}

// Run demonstration
demonstrateCompleteSystem().catch(console.error);
