import { jest } from '@jest/globals';

// Set test timeout
jest.setTimeout(10000);

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.MCP_DISABLE_CACHE = 'true';
process.env.MCP_DEBUG = 'false';

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

// Global test utilities
declare global {
  var testUtils: {
    delay: (ms: number) => Promise<void>;
  };
}

(global as any).testUtils = {
  delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
};