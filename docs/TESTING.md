# Testing Documentation - macOS Shell MCP Server

## Current Test Status

### Overall Metrics
- **Total Test Suites**: 41
- **Total Tests**: 712
- **Pass Rate**: 100% [PASSED]
- **Skipped Tests**: 0
- **Test Execution Time**: ~32 seconds

### Code Coverage
| Metric | Coverage | Target | Status |
|--------|----------|--------|--------|
| **Lines** | 60.62% | 60% | Achieved |
| **Statements** | 60.61% | 60% | Achieved |
| **Branches** | 52.84% | 50% | Achieved |
| **Functions** | 66.33% | 60% | Achieved |

## Test Architecture

### Test Organization
```
src/
├── ai-*.test.ts                 # AI component tests
├── tools/
│   ├── *.test.ts                # Tool implementation tests
│   └── command/
│       └── *.test.ts            # Command tool tests
├── sessions/
│   └── *.test.ts                # Session management tests
├── utils/
│   └── *.test.ts                # Utility function tests
└── *.test.ts                    # Core component tests
```

### Test Categories

#### 1. **Core Components** (11 test files)
- `session-manager.test.ts` - Session orchestration and lifecycle
- `ai-integration.test.ts` - AI feature coordination
- `output-analyzer.test.ts` - Output analysis and processing
- `pattern-matcher.test.ts` - Pattern matching logic
- `duplicate-detector.test.ts` - Duplicate detection algorithms
- `resource-monitor.test.ts` - Resource monitoring and tracking
- `learning-persistence.test.ts` - Learning data persistence

#### 2. **AI Components** (6 test files)
- `ai-cache.test.ts` - Command caching with TTL strategies
- `ai-dedup.test.ts` - Request deduplication logic
- `ai-error-handler.test.ts` - Error recovery and suggestions
- `ai-monitor.test.ts` - Performance monitoring
- `ai-cache-classifier.test.ts` - Cache classification logic
- `ai-integration.test.ts` - AI feature integration

#### 3. **Tool Implementations** (8 test files)
- `command-tools.test.ts` - Command execution tools
- `process-tools.test.ts` - Process management tools
- `session-tools.test.ts` - Session management tools
- `system-tools.test.ts` - System monitoring tools
- `cache-management-tools.test.ts` - Cache management tools
- `preflight-tools.test.ts` - Preflight validation tools
- Command sub-tools (batch, script, navigation, environment, simple)

#### 4. **Utilities** (14 test files)
- `enhanced-batch-executor.test.ts` - Batch execution with conditions
- `enhanced-circular-buffer.test.ts` - Circular buffer implementation
- `lru-cache.test.ts` - LRU cache implementation
- `debouncer.test.ts` - Debouncing logic
- `command-pool.test.ts` - Command pooling
- `memory-manager.test.ts` - Memory management
- `resource-cache.test.ts` - Resource caching
- `circuit-breaker.test.ts` - Circuit breaker pattern
- `request-deduplicator.test.ts` - Request deduplication
- `error-handler.test.ts` - Error handling utilities
- `script-validator.test.ts` - Script validation
- `input-validator.test.ts` - Input validation
- `batch-executor.test.ts` - Basic batch execution
- `system-guardian.test.ts` - System protection

#### 5. **Session Components** (2 test files)
- `background-process-manager.test.ts` - Background process lifecycle
- `command-history-manager.test.ts` - Command history tracking

## Testing Stack

### Dependencies
```json
{
  "devDependencies": {
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "@types/jest": "^29.5.14"
  }
}
```

### Jest Configuration
```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts'
  ],
  coverageThreshold: {
    global: {
      lines: 60,
      statements: 60,
      branches: 50,
      functions: 60
    }
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext'
      }
    }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  }
};
```

## Test Patterns and Best Practices

### Test Structure Template
```typescript
describe('ComponentName', () => {
  let component: ComponentType;
  let mockDependency: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDependency = jest.fn();
    component = new ComponentType(mockDependency);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('methodName', () => {
    it('should handle normal operation', async () => {
      // Arrange
      const input = 'test-input';
      const expected = 'expected-output';
      mockDependency.mockResolvedValue(expected);

      // Act
      const result = await component.method(input);

      // Assert
      expect(result).toBe(expected);
      expect(mockDependency).toHaveBeenCalledWith(input);
    });

    it('should handle error cases', async () => {
      // Test error scenarios
    });

    it('should handle edge cases', async () => {
      // Test boundary conditions
    });
  });
});
```

### Common Mock Patterns

#### Mocking External Dependencies
```typescript
// Mock execa
jest.mock('execa');
const mockExeca = execa as jest.MockedFunction<typeof execa>;

// Mock file system
jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn()
}));

// Mock with specific return values
mockExeca.mockResolvedValue({
  stdout: 'output',
  stderr: '',
  exitCode: 0
} as any);
```

#### Using Fake Timers
```typescript
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('should debounce calls', () => {
  const callback = jest.fn();
  const debounced = debounce(callback, 100);
  
  debounced();
  debounced();
  
  expect(callback).not.toHaveBeenCalled();
  
  jest.advanceTimersByTime(100);
  
  expect(callback).toHaveBeenCalledTimes(1);
});
```

## Coverage Analysis

### Well-Tested Components (>80% coverage)
- `error-handler.ts` - 95.45%
- `script-validator.ts` - 92.75%
- `enhanced-circular-buffer.ts` - 92.15%
- `input-validator.ts` - 92.62%
- `request-deduplicator.ts` - 90.26%
- `debouncer.ts` - 100%
- `lru-cache.ts` - 100%
- `enhanced-batch-executor.ts` - 81.13%

### Components Needing Improvement (<50% coverage)
- [WARNING] `logger.ts` - 43.13% (logging infrastructure)
- [WARNING] `native-ssh-manager.ts` - 0% (SSH functionality)

### Coverage by Module
| Module | Files | Coverage | Notes |
|--------|-------|----------|-------|
| AI Components | 7 | 72% | Good coverage of core AI features |
| Tools | 10 | 65% | Solid tool implementation coverage |
| Utils | 15 | 68% | Well-tested utility functions |
| Sessions | 4 | 74% | Good session management coverage |
| Core | 5 | 58% | Core components adequately tested |

## Running Tests

### Basic Commands
```bash
# Run all tests
npm test

# Run tests with coverage
npm test -- --coverage

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- src/ai-cache.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="execute"

# Debug tests
node --inspect-brk ./node_modules/.bin/jest --runInBand
```

### Continuous Integration
```bash
# CI mode with coverage
npm test -- --ci --coverage --maxWorkers=50%

# Generate coverage reports
npm test -- --coverage --coverageReporters=html
open coverage/index.html
```

## Test Utilities

### Helper Functions
```typescript
// test/helpers/mock-helpers.ts
export function createMockSession(overrides = {}) {
  return {
    id: 'test-session',
    cwd: '/tmp',
    env: {},
    ...overrides
  };
}

export function createMockProcess(overrides = {}) {
  return {
    pid: 12345,
    command: 'test',
    status: 'running',
    ...overrides
  };
}
```

### Custom Matchers
```typescript
// test/matchers/custom-matchers.ts
expect.extend({
  toBeValidPath(received: string) {
    const pass = /^\//.test(received);
    return {
      pass,
      message: () => `Expected ${received} to be a valid absolute path`
    };
  }
});
```

## Test Writing Guidelines

### Do's
1. **Test behavior, not implementation** - Focus on what the code does, not how
2. **Use descriptive test names** - Test names should explain what is being tested
3. **Follow AAA pattern** - Arrange, Act, Assert
4. **Mock external dependencies** - Don't make real network/filesystem calls
5. **Test error cases** - Always test error paths and edge cases
6. **Keep tests focused** - One test should verify one behavior
7. **Use beforeEach/afterEach** - Ensure clean test state

### Don'ts
1. **Don't test implementation details** - Tests shouldn't break on refactoring
2. **Avoid testing private methods** - Test through public interfaces
3. **Don't share state between tests** - Each test should be independent
4. **Avoid complex test setup** - If setup is complex, refactor the code
5. **Don't ignore flaky tests** - Fix or remove unreliable tests
6. **Avoid testing third-party code** - Mock external libraries

## Test Maintainability

### Refactoring Tests
When refactoring tests:
1. Keep test intent clear
2. Extract common setup to helpers
3. Use factory functions for test data
4. Group related tests with describe blocks
5. Remove duplicate test logic

### Test Performance
To improve test performance:
1. Use `--maxWorkers=50%` for parallel execution
2. Mock heavy operations (file I/O, network)
3. Use `jest.isolateModules()` for module isolation
4. Leverage `beforeAll` for expensive setup
5. Consider `--runInBand` for debugging only

## Metrics and Goals

### Current Achievement
- **100% test pass rate** achieved
- **0 skipped tests** maintained
- **60%+ code coverage** reached
- **<35 second** test execution time

### Future Goals
| Goal | Target | Timeline |
|------|--------|----------|
| Line Coverage | 75% | Q1 2025 |
| Branch Coverage | 65% | Q1 2025 |
| Integration Tests | 20 tests | Q2 2025 |
| E2E Tests | 10 tests | Q2 2025 |
| Test Execution | <30s | Q1 2025 |

## Troubleshooting

### Common Issues

#### TypeScript Compilation Errors
```bash
# Clear build cache
rm -rf build/
npm run build

# Check TypeScript config
npx tsc --noEmit
```

#### Module Resolution Issues
```javascript
// Ensure .js extensions in imports
import { Component } from './component.js'; // CORRECT
import { Component } from './component';    // INCORRECT
```

#### Memory Leaks in Tests
```javascript
// Always clean up timers
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

// Clear mocks
afterEach(() => {
  jest.clearAllMocks();
});
```

## Resources

### Documentation
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [ts-jest Configuration](https://kulshekhar.github.io/ts-jest/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)

### Tools
- [Jest VSCode Extension](https://marketplace.visualstudio.com/items?itemName=Orta.vscode-jest)
- [Coverage Gutters](https://marketplace.visualstudio.com/items?itemName=ryanluker.vscode-coverage-gutters)

## Quick Reference

### Test Lifecycle Hooks
- `beforeAll()` - Run once before all tests
- `beforeEach()` - Run before each test
- `afterEach()` - Run after each test
- `afterAll()` - Run once after all tests

### Assertion Methods
- `toBe()` - Strict equality (===)
- `toEqual()` - Deep equality
- `toMatch()` - Regex matching
- `toThrow()` - Error throwing
- `resolves/rejects` - Promise assertions

### Mock Methods
- `jest.fn()` - Create mock function
- `jest.mock()` - Mock entire module
- `jest.spyOn()` - Spy on existing function
- `mockResolvedValue()` - Mock async success
- `mockRejectedValue()` - Mock async failure

---

*Last Updated: December 2024*
*Total Tests: 712 | Pass Rate: 100% | Coverage: 60.62%*