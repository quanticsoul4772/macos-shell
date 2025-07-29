#!/usr/bin/env node

// Test script for native SSH implementation
import { NativeSSHManager } from '../build/utils/native-ssh-manager.js';

async function testNativeSSH() {
  console.log('Testing Native SSH Implementation');
  console.log('=================================\n');
  
  const manager = new NativeSSHManager();
  
  // Test 1: Connect using SSH config (should auto-detect broala user and key)
  console.log('Test 1: Connect to 192.168.21.13 (using SSH config)');
  const startTime = Date.now();
  
  const result = await manager.startSession('192.168.21.13');
  
  if (result.error) {
    console.error(`Failed to connect: ${result.error}`);
    console.log(`Connection attempt took: ${result.connectionTime}ms`);
    process.exit(1);
  }
  
  console.log(`✓ Connected successfully!`);
  console.log(`  Session ID: ${result.sessionId}`);
  console.log(`  Connection time: ${result.connectionTime}ms`);
  
  // Wait for initial output
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Test 2: Send a command
  console.log('\nTest 2: Send command "hostname"');
  const sendResult = manager.sendInput(result.sessionId, 'hostname');
  
  if (!sendResult.success) {
    console.error(`Failed to send command: ${sendResult.error}`);
    manager.closeSession(result.sessionId);
    process.exit(1);
  }
  
  // Wait for output
  await new Promise(resolve => setTimeout(resolve, 200));
  
  const output = manager.getOutput(result.sessionId);
  console.log(`✓ Command sent successfully`);
  console.log(`  Output (last 10 lines):`);
  const lines = output.output.split('\n').slice(-10);
  lines.forEach(line => console.log(`    ${line}`));
  
  // Test 3: Multiple rapid commands
  console.log('\nTest 3: Multiple rapid commands');
  const commands = ['pwd', 'date', 'uptime', 'df -h | head -5'];
  
  for (const cmd of commands) {
    const cmdStart = Date.now();
    manager.sendInput(result.sessionId, cmd);
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`  ${cmd}: ${Date.now() - cmdStart}ms`);
  }
  
  // Test 4: List sessions
  console.log('\nTest 4: List sessions');
  const sessions = manager.listSessions();
  console.log(`✓ Found ${sessions.length} active session(s)`);
  sessions.forEach(session => {
    const runtime = (Date.now() - session.startTime.getTime()) / 1000;
    console.log(`  - ${session.user}@${session.host}:${session.port} (${session.status}, ${runtime.toFixed(1)}s)`);
  });
  
  // Test 5: Close session
  console.log('\nTest 5: Close session');
  const closeResult = manager.closeSession(result.sessionId);
  console.log(`✓ Session closed: ${closeResult.success}`);
  
  // Summary
  console.log('\n=================================');
  console.log('Test Summary:');
  console.log(`Total connection time: ${result.connectionTime}ms`);
  console.log(`Expected improvement: ${((4500 - result.connectionTime) / 4500 * 100).toFixed(1)}% faster`);
  
  process.exit(0);
}

// Run the test
testNativeSSH().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
