#!/usr/bin/env node

// Test script for session persistence
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const PERSISTENCE_DIR = path.join(os.homedir(), '.macos-shell');
const SESSIONS_DIR = path.join(PERSISTENCE_DIR, 'sessions');
const PROCESSES_DIR = path.join(PERSISTENCE_DIR, 'processes');

async function checkPersistenceDirectories() {
  console.log('\n📁 Checking persistence directories...');
  
  try {
    // Check if directories exist
    const persistenceExists = await fs.stat(PERSISTENCE_DIR).then(() => true).catch(() => false);
    const sessionsExists = await fs.stat(SESSIONS_DIR).then(() => true).catch(() => false);
    const processesExists = await fs.stat(PROCESSES_DIR).then(() => true).catch(() => false);
    
    console.log(`✓ Persistence directory: ${persistenceExists ? 'EXISTS' : 'MISSING'} - ${PERSISTENCE_DIR}`);
    console.log(`✓ Sessions directory: ${sessionsExists ? 'EXISTS' : 'MISSING'} - ${SESSIONS_DIR}`);
    console.log(`✓ Processes directory: ${processesExists ? 'EXISTS' : 'MISSING'} - ${PROCESSES_DIR}`);
    
    if (sessionsExists) {
      const sessions = await fs.readdir(SESSIONS_DIR);
      console.log(`\n📄 Found ${sessions.length} session files:`);
      for (const file of sessions) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(SESSIONS_DIR, file), 'utf-8');
          const session = JSON.parse(content);
          console.log(`  - ${file}: ${session.name} (created: ${session.created})`);
        }
      }
    }
    
    if (processesExists) {
      const processes = await fs.readdir(PROCESSES_DIR);
      console.log(`\n📄 Found ${processes.length} process files:`);
      for (const file of processes) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(PROCESSES_DIR, file), 'utf-8');
          const process = JSON.parse(content);
          console.log(`  - ${file}: ${process.command} (status: ${process.status})`);
        }
      }
    }
  } catch (error) {
    console.error('Error checking persistence:', error);
  }
}

async function main() {
  console.log('🔍 Testing macos-shell MCP server persistence...');
  
  // Check persistence directories
  await checkPersistenceDirectories();
  
  console.log('\n✅ Persistence check complete!');
  console.log('Note: Sessions are saved when created/updated, and loaded on server startup.');
}

main().catch(console.error);
