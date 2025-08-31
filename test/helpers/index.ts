import { SessionManager } from '../../src/session-manager.js';
import { Session } from '../../src/session-manager.js';
import { BackgroundProcess } from '../../src/background-process.js';
import { v4 as uuidv4 } from 'uuid';

export function createMockSession(overrides?: Partial<Session>): Session {
  return {
    id: uuidv4(),
    name: 'test-session',
    cwd: '/tmp/test',
    env: {},
    commandCount: 0,
    createdAt: new Date(),
    lastUsedAt: new Date(),
    ...overrides
  };
}

export function createMockBackgroundProcess(overrides?: Partial<BackgroundProcess>): BackgroundProcess {
  return {
    id: uuidv4(),
    command: 'echo test',
    args: [],
    sessionId: 'test-session',
    startTime: new Date(),
    status: 'running',
    pid: 1234,
    name: 'test-process',
    ...overrides
  } as BackgroundProcess;
}

export function createTestSessionManager(): SessionManager {
  return new SessionManager();
}

export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Condition not met within ${timeout}ms`);
}

export function createTestEnvironment() {
  const originalEnv = process.env;
  
  return {
    setup() {
      process.env = { ...originalEnv, NODE_ENV: 'test' };
    },
    teardown() {
      process.env = originalEnv;
    }
  };
}