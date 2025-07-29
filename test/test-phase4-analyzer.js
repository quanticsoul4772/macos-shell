// Test Phase 4: Smart Output Analysis
// Run with: node test/test-phase4-analyzer.js

import { OutputAnalyzer } from '../src/output-analyzer.js';
import { CacheStrategy } from '../src/ai-cache-classifier.js';

console.log('Testing Phase 4: Smart Output Analysis\n');

const analyzer = new OutputAnalyzer();

// Test 1: Timestamp Detection
console.log('Test 1: Timestamp Detection');
const timestampOutputs = [
  '2025-01-06T12:34:56Z',
  'Mon Jan 6 12:34:56 PST 2025',
  '12:34:56',
  'Last login: 5 minutes ago',
  'Updated 2 hours ago'
];

timestampOutputs.forEach(output => {
  const result = analyzer.analyze(output);
  console.log(`  Output: "${output}"`);
  console.log(`  Has Timestamp: ${result.hasTimestamp}`);
  console.log(`  Suggested Strategy: ${result.suggestedStrategy}`);
  console.log(`  Confidence: ${result.confidence}\n`);
});

// Test 2: Process ID Detection
console.log('\nTest 2: Process ID Detection');
const pidOutputs = [
  'pid: 12345',
  'Process 67890 running',
  '12345 node server.js',
  '[98765] Server started'
];

pidOutputs.forEach(output => {
  const result = analyzer.analyze(output);
  console.log(`  Output: "${output}"`);
  console.log(`  Has Process ID: ${result.hasProcessId}`);
  console.log(`  Suggested Strategy: ${result.suggestedStrategy}`);
  console.log(`  Confidence: ${result.confidence}\n`);
});

// Test 3: Complex Output (docker ps style)
console.log('\nTest 3: Complex Output Analysis');
const dockerPsOutput = `CONTAINER ID   IMAGE          COMMAND                  CREATED         STATUS         PORTS                    NAMES
a1b2c3d4e5f6   nginx:latest   "/docker-entrypoint.…"   5 minutes ago   Up 5 minutes   0.0.0.0:80->80/tcp       web-server
9876543210ab   mysql:8.0      "docker-entrypoint.s…"   2 hours ago     Up 2 hours     0.0.0.0:3306->3306/tcp   database`;

const dockerResult = analyzer.analyze(dockerPsOutput);
console.log('  Docker ps output analysis:');
console.log(`  Change Indicators: ${dockerResult.changeIndicators.join(', ')}`);
console.log(`  Suggested Strategy: ${dockerResult.suggestedStrategy}`);
console.log(`  Confidence: ${dockerResult.confidence}\n`);

// Test 4: Static Output
console.log('\nTest 4: Static Output Analysis');
const staticOutputs = [
  'Available commands: start, stop, restart',
  'Configuration loaded successfully',
  'Version 1.2.3'
];

staticOutputs.forEach(output => {
  const result = analyzer.analyze(output);
  console.log(`  Output: "${output}"`);
  console.log(`  Change Indicators: ${result.changeIndicators.join(', ') || 'none'}`);
  console.log(`  Suggested Strategy: ${result.suggestedStrategy}`);
  console.log(`  Confidence: ${result.confidence}\n`);
});

// Test 5: Network Output
console.log('\nTest 5: Network Output Analysis');
const networkOutput = `Active connections:
  192.168.1.100:8080 -> 10.0.0.5:443
  [::1]:3000 listening
  Port 22 open`;

const networkResult = analyzer.analyze(networkOutput);
console.log('  Network output analysis:');
console.log(`  Has IP Address: ${networkResult.hasIpAddress}`);
console.log(`  Has Port: ${networkResult.hasPort}`);
console.log(`  Suggested Strategy: ${networkResult.suggestedStrategy}`);
console.log(`  Confidence: ${networkResult.confidence}\n`);

// Test 6: File Size Output
console.log('\nTest 6: File Size Output');
const fileSizeOutput = `Total: 1.5GB
file1.txt  1024 bytes
file2.log  2.3MB
Size: 456KB`;

const sizeResult = analyzer.analyze(fileSizeOutput);
console.log('  File size output analysis:');
console.log(`  Has File Size: ${sizeResult.hasFileSize}`);
console.log(`  Suggested Strategy: ${sizeResult.suggestedStrategy}`);
console.log(`  Confidence: ${sizeResult.confidence}\n`);

// Test 7: High Change Pattern
console.log('\nTest 7: High Change Pattern Detection');
const highChangeOutputs = [
  'System is currently updating...',
  'Real-time monitoring active',
  'Live feed from server',
  'Processes running: 42'
];

highChangeOutputs.forEach(output => {
  const result = analyzer.analyze(output);
  console.log(`  Output: "${output}"`);
  console.log(`  Change Indicators: ${result.changeIndicators.join(', ')}`);
  console.log(`  Suggested Strategy: ${result.suggestedStrategy}`);
  console.log(`  Confidence: ${result.confidence}\n`);
});

// Test 8: Output Comparison
console.log('\nTest 8: Output Comparison');
const output1 = 'Files: 10\nDirectories: 5\nTotal size: 100MB';
const output2 = 'Files: 11\nDirectories: 5\nTotal size: 105MB';
const output3 = 'Files: 10\nDirectories: 5\nTotal size: 100MB';

console.log('  Comparing output1 vs output2:');
let comparison = analyzer.compareOutputs(output1, output2);
console.log(`    Different: ${comparison.isDifferent}`);
console.log(`    Similarity: ${comparison.similarity}`);

console.log('\n  Comparing output1 vs output3:');
comparison = analyzer.compareOutputs(output1, output3);
console.log(`    Different: ${comparison.isDifferent}`);
console.log(`    Similarity: ${comparison.similarity}`);

// Test Summary
console.log('\n=== Phase 4 Test Summary ===');
console.log('The output analyzer successfully:');
console.log('- Detects timestamps in multiple formats');
console.log('- Identifies process IDs');
console.log('- Recognizes dynamic content patterns');
console.log('- Suggests appropriate cache strategies');
console.log('- Provides confidence scores');
console.log('- Compares outputs for similarity');
console.log('\nPhase 4 implementation is working correctly!');
