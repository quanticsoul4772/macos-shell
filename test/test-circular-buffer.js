import { CircularBuffer, OutputLine } from '../src/background-process.js';

// Test CircularBuffer implementation
function testCircularBuffer() {
  console.log("Testing CircularBuffer...\n");
  
  // Test 1: Basic functionality
  console.log("Test 1: Basic add and retrieve");
  const buffer = new CircularBuffer(5);
  
  for (let i = 1; i <= 3; i++) {
    buffer.add({
      timestamp: new Date(),
      type: 'stdout',
      content: `Line ${i}`,
      lineNumber: i
    });
  }
  
  const lines = buffer.getLines();
  console.log(`Added 3 lines, retrieved ${lines.length} lines`);
  lines.forEach(l => console.log(`  ${l.lineNumber}: ${l.content}`));
  
  // Test 2: Overflow behavior
  console.log("\nTest 2: Buffer overflow");
  for (let i = 4; i <= 8; i++) {
    buffer.add({
      timestamp: new Date(),
      type: 'stdout',
      content: `Line ${i}`,
      lineNumber: i
    });
  }
  
  const overflowLines = buffer.getLines();
  console.log(`Buffer size: ${buffer.getBufferSize()}, Total lines: ${buffer.getTotalLines()}`);
  console.log("Current buffer contents:");
  overflowLines.forEach(l => console.log(`  ${l.lineNumber}: ${l.content}`));
  
  // Test 3: Get specific lines
  console.log("\nTest 3: Get specific lines");
  const lastTwo = buffer.getLines(2);
  console.log("Last 2 lines:");
  lastTwo.forEach(l => console.log(`  ${l.lineNumber}: ${l.content}`));
  
  // Test 4: Clear buffer
  console.log("\nTest 4: Clear buffer");
  buffer.clear();
  console.log(`After clear - Total lines: ${buffer.getTotalLines()}, Buffer size: ${buffer.getBufferSize()}`);
  
  // Test 5: AI-optimized buffer
  console.log("\nTest 5: AI-optimized buffer performance");
  const aiBuffer = new CircularBuffer(300);
  const startTime = Date.now();
  
  for (let i = 1; i <= 1000; i++) {
    aiBuffer.add({
      timestamp: new Date(),
      type: i % 2 === 0 ? 'stdout' : 'stderr',
      content: `Log entry ${i}: ${Math.random()}`,
      lineNumber: i
    });
  }
  
  const elapsed = Date.now() - startTime;
  console.log(`Added 1,000 lines in ${elapsed}ms`);
  console.log(`Buffer maintains last ${aiBuffer.getBufferSize()} lines`);
  console.log(`Total lines processed: ${aiBuffer.getTotalLines()}`)
  
  const recent = aiBuffer.getLines(5);
  console.log("Last 5 lines:");
  recent.forEach(l => console.log(`  ${l.lineNumber}: ${l.content.substring(0, 30)}...`));
  
  console.log("\nAll tests completed!");
}

// Run tests
testCircularBuffer();