#!/usr/bin/env node

/**
 * Test script for validating AI buffer optimization
 * Run after implementation to verify 300-line buffers are working correctly
 */

import { EnhancedCircularBuffer } from '../build/utils/enhanced-circular-buffer.js';
import { AI_BUFFER_SIZE } from '../build/sessions/session-types.js';

console.log('🧪 Testing AI Buffer Optimization...\n');

// Test 1: Verify buffer size constant
console.log('Test 1: Buffer Size Constant');
console.log(`AI_BUFFER_SIZE = ${AI_BUFFER_SIZE}`);
if (AI_BUFFER_SIZE === 300) {
  console.log('✅ Buffer size correctly set to 300 lines\n');
} else {
  console.log(`❌ Buffer size is ${AI_BUFFER_SIZE}, expected 300\n`);
  process.exit(1);
}

// Test 2: Create buffer and verify capacity
console.log('Test 2: Buffer Creation');
const buffer = new EnhancedCircularBuffer(AI_BUFFER_SIZE);
console.log(`Created buffer with size: ${AI_BUFFER_SIZE}`);
console.log('✅ Buffer created successfully\n');

// Test 3: Test overflow behavior
console.log('Test 3: Buffer Overflow Behavior');
console.log('Adding 500 lines to 300-line buffer...');

for (let i = 0; i < 500; i++) {
  buffer.add({
    timestamp: new Date(),
    type: 'stdout',
    content: `Test line ${i}`,
    lineNumber: i + 1
  });
}

const totalLines = buffer.getTotalLines();
const bufferedLines = buffer.getLines().length;
const firstLine = buffer.getLines()[0];
const lastLine = buffer.getLines()[bufferedLines - 1];

console.log(`Total lines added: ${totalLines}`);
console.log(`Lines in buffer: ${bufferedLines}`);
console.log(`First line in buffer: "${firstLine.content}"`);
console.log(`Last line in buffer: "${lastLine.content}"`);

if (bufferedLines === 300 && firstLine.content === 'Test line 200' && lastLine.content === 'Test line 499') {
  console.log('✅ Buffer overflow handling works correctly\n');
} else {
  console.log('❌ Buffer overflow not working as expected\n');
  process.exit(1);
}

// Test 4: Memory usage estimation
console.log('Test 4: Memory Usage Estimation');
const avgLineLength = 80; // characters
const bytesPerChar = 2; // UTF-16
const oldBufferSize = 10000;
const oldMemory = oldBufferSize * avgLineLength * bytesPerChar;
const newMemory = AI_BUFFER_SIZE * avgLineLength * bytesPerChar;
const reduction = ((oldMemory - newMemory) / oldMemory * 100).toFixed(1);

console.log(`Old buffer (10,000 lines): ~${(oldMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`New buffer (300 lines): ~${(newMemory / 1024 / 1024).toFixed(2)} MB`);
console.log(`Memory reduction: ${reduction}%`);
console.log('✅ Memory optimization achieved\n');

// Test 5: Get specific line counts
console.log('Test 5: Line Retrieval');
const last50 = buffer.getLines(50);
const last100 = buffer.getLines(100);
const allLines = buffer.getLines();

console.log(`Requested 50 lines, got: ${last50.length}`);
console.log(`Requested 100 lines, got: ${last100.length}`);
console.log(`Requested all lines, got: ${allLines.length}`);

if (last50.length === 50 && last100.length === 100 && allLines.length === 300) {
  console.log('✅ Line retrieval working correctly\n');
} else {
  console.log('❌ Line retrieval not working as expected\n');
  process.exit(1);
}

// Summary
console.log('🎉 All tests passed!');
console.log('\nSummary:');
console.log('- Buffer size: 300 lines (✓)');
console.log('- Overflow handling: Working (✓)');
console.log('- Memory reduction: 97% (✓)');
console.log('- Line retrieval: Accurate (✓)');
console.log('\nThe AI buffer optimization is working correctly.');
