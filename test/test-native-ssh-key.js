#!/usr/bin/env node
import { NativeSSHManager } from '../build/utils/native-ssh-manager.js';

async function testKeyAuth() {
  const manager = new NativeSSHManager();
  
  try {
    console.log('Testing key-based authentication...');
    console.time('Connection with key');
    
    const result = await manager.startSession(
      '192.168.21.13',
      22,
      'russ',
      '/Users/russellsmith/.ssh/id_rsa',
      undefined // no password needed
    );
    
    console.timeEnd('Connection with key');
    console.log('Connection result:', result);
    
    if (result.success && result.sessionId) {
      console.log('\nSending test command...');
      manager.sendInput(result.sessionId, 'echo "Native SSH with key auth works!"');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const output = manager.getOutput(result.sessionId);
      console.log('Output:', output.data);
      
      manager.closeSession(result.sessionId);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testKeyAuth();
