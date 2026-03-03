import { pathToFileURL } from 'url';

export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Mock external dependencies
    '^execa$': '<rootDir>/test/mocks/execa.ts',
    '^node-pty$': '<rootDir>/test/mocks/node-pty.ts',
    '^ssh2$': '<rootDir>/test/mocks/ssh2.ts',
    '^sqlite-vss$': '<rootDir>/test/mocks/sqlite-vss.ts',
    '^better-sqlite3$': '<rootDir>/test/mocks/better-sqlite3.ts',
    '^voyageai$': '<rootDir>/test/mocks/voyageai.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'esnext',
        target: 'es2022',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        skipLibCheck: true,
        downlevelIteration: true,
        isolatedModules: true,
      }
    }]
  },
  testMatch: [
    '<rootDir>/src/**/*.test.ts',
    '<rootDir>/test/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/types/**',
    // SSH integration code requires PTY/SSH2 connections, not unit-testable
    '!src/tools/helpers/ssh-*.ts',
    '!src/tools/interactive-ssh-tool.ts',
    '!src/tools/enhanced-ssh-tool.ts',
    '!src/utils/native-ssh-manager.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 60,
      statements: 60
    }
  },
  testTimeout: 10000,
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  // Handle node_modules that use ESM
  transformIgnorePatterns: [
    'node_modules/(?!(execa|node-pty|ssh2)/)'
  ],
};