# Testing Improvement Plan for macOS Shell MCP Server

## Current State Analysis

### Coverage Metrics
- **Overall Coverage**: 71.82% (Critical Gap)
- **Test Files**: 2 out of 60 source files (3.3%)
- **Total Tests**: 29 tests (insufficient)

### What's Currently Tested
1. `error-handler.ts` - 95.45% coverage [DONE]
2. `script-validator.ts` - 92.75% coverage [DONE]
3. `logger.ts` - 39.21% coverage [WARNING] (incidental)

### Critical Testing Gaps

#### Core Server Components (0% Coverage) [CRITICAL]
- `server.ts` - Main server initialization
- `session-manager.ts` - Session orchestration
- `background-process.ts` - Process lifecycle

#### AI Components (0% Coverage) [CRITICAL]
- `ai-cache.ts` - Command caching (383 lines)
- `ai-dedup.ts` - Request deduplication
- `ai-monitor.ts` - Performance monitoring
- `ai-integration.ts` - Feature coordination

#### Tool Implementations (0% Coverage) [CRITICAL]
- 35 MCP tools across 7 modules
- Command execution tools
- Session management tools
- Background process tools
- SSH functionality

## Priority Testing Roadmap

### Phase 1: Critical Core (Week 1)
Priority: **URGENT**

#### Session Manager Tests
```typescript
// src/session-manager.test.ts
- Session creation/deletion
- Persistence and restoration
- Environment variable management
- Working directory operations
- Concurrent session handling
```

#### Command Execution Tests
```typescript
// src/tools/command-tools.test.ts
- Command execution with timeout
- Error handling and recovery
- Output truncation
- Environment injection
- Working directory context
```

#### Background Process Tests
```typescript
// src/background-process.test.ts
- Process spawning and lifecycle
- Output buffering (CircularBuffer)
- Process termination scenarios
- Orphan detection
- Resource monitoring
```

### Phase 2: AI Components (Week 2)
Priority: **HIGH**

#### AI Cache Tests
```typescript
// src/ai-cache.test.ts
- Cache hit/miss scenarios
- TTL expiration logic
- Pattern-based caching rules
- Cache invalidation
- Statistics tracking
```

#### AI Deduplication Tests
```typescript
// src/ai-dedup.test.ts
- Duplicate detection within window
- Request merging
- Timeout handling
- Concurrent request handling
```

#### AI Monitor Tests
```typescript
// src/ai-monitor.test.ts
- Performance metrics collection
- Statistics calculation
- Resource usage tracking
- Alert thresholds
```

### Phase 3: Tool Coverage (Week 3)
Priority: **MEDIUM**

#### Tool Implementation Tests
- Session tools (create, list, close)
- Process tools (list, kill, output)
- Cache management tools
- System monitoring tools
- SSH interactive tools

### Phase 4: Integration & E2E (Week 4)
Priority: **MEDIUM**

#### Integration Tests
```typescript
// test/integration/server.integration.test.ts
- Full request/response cycle
- Tool registration and execution
- Session persistence across restarts
- Error propagation
- Concurrent request handling
```

## Implementation Strategy

### 1. Test Infrastructure Setup

#### Mock Utilities
```typescript
// test/mocks/index.ts
export const mockExeca = {
  command: jest.fn(),
  commandSync: jest.fn()
};

export const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn()
};

export const mockNodePty = {
  spawn: jest.fn()
};
```

#### Test Helpers
```typescript
// test/helpers/index.ts
export function createMockSession() { /* ... */ }
export function createMockProcess() { /* ... */ }
export function createMockServer() { /* ... */ }
```

### 2. Coverage Goals

| Component | Target | Priority |
|-----------|--------|----------|
| Core Server | 90% | Critical |
| AI Components | 85% | High |
| Tools | 80% | Medium |
| Utilities | 85% | Medium |
| **Overall** | **85%** | - |

### 3. Testing Best Practices

#### Test Structure Template
```typescript
describe('ComponentName', () => {
  let component: ComponentType;
  let mockDependency: jest.Mocked<DependencyType>;
  
  beforeEach(() => {
    jest.clearAllMocks();
    mockDependency = createMockDependency();
    component = new ComponentType(mockDependency);
  });
  
  describe('methodName', () => {
    it('should handle success case', async () => {
      // Arrange
      const input = createTestInput();
      mockDependency.method.mockResolvedValue(expectedOutput);
      
      // Act
      const result = await component.method(input);
      
      // Assert
      expect(result).toEqual(expectedResult);
      expect(mockDependency.method).toHaveBeenCalledWith(input);
    });
    
    it('should handle error case', async () => {
      // Test error scenarios
    });
    
    it('should handle edge case', async () => {
      // Test boundaries
    });
  });
});
```

### 4. CI/CD Integration

#### GitHub Actions Workflow
```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: macos-latest
    strategy:
      matrix:
        node-version: [18.x, 20.x]
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      
      - run: npm ci
      - run: npm run build
      - run: npm run test:ci
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

#### Package.json Scripts
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --coverage --maxWorkers=50%",
    "test:unit": "jest --testMatch='**/*.test.ts'",
    "test:integration": "jest --testMatch='**/*.integration.test.ts'",
    "test:debug": "node --inspect-brk ./node_modules/.bin/jest --runInBand"
  }
}
```

### 5. Required Dependencies

```bash
npm install --save-dev \
  @types/supertest \
  supertest \
  jest-mock-extended \
  @golevelup/ts-jest \
  jest-when \
  memfs \
  @types/jest \
  ts-jest
```

## Code Quality Prerequisites

### Refactoring Needs (Before Testing)
1. **Deep Nesting** (428 issues) - Flatten control flow
2. **God Classes** (11 files) - Split into smaller modules
3. **Long Methods** (65 issues) - Extract to smaller functions
4. **Too Many Parameters** (164 issues) - Use options objects

### Refactoring Priority
1. `ai-cache.ts` - Split into CacheStrategy, CacheStore, CacheStats
2. `session-manager.ts` - Extract persistence, process management
3. `command/batch.ts` - Simplify execution logic

## Testing Tools Configuration

### Jest Configuration Enhancement
```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/types/**'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 85,
      statements: 85
    }
  },
  testTimeout: 10000,
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts']
};
```

## Metrics & Success Criteria

### Week 1 Goals
- [ ] Core component tests (3 files)
- [ ] Coverage > 40%
- [ ] CI pipeline setup

### Week 2 Goals
- [ ] AI component tests (5 files)
- [ ] Coverage > 60%
- [ ] Integration tests started

### Week 3 Goals
- [ ] Tool implementation tests (7 files)
- [ ] Coverage > 75%
- [ ] E2E test framework

### Week 4 Goals
- [ ] Full integration suite
- [ ] Coverage > 85%
- [ ] Performance benchmarks

## Maintenance Plan

### Daily
- Run tests before commits
- Review coverage reports
- Fix failing tests immediately

### Weekly
- Review coverage trends
- Update test documentation
- Refactor tests as needed

### Monthly
- Audit test effectiveness
- Update coverage goals
- Performance regression testing

## Quick Start Commands

```bash
# Install testing dependencies
npm install --save-dev jest ts-jest @types/jest

# Run tests with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch

# Debug specific test
npm run test:debug -- --testNamePattern="SessionManager"

# Generate coverage report
npm run test:coverage -- --coverageReporters=html
open coverage/index.html
```

## Next Immediate Actions

1. **Today**: Create first 3 test files for core components
2. **Tomorrow**: Set up CI/CD pipeline
3. **This Week**: Achieve 40% coverage
4. **Next Week**: Complete AI component tests
5. **Month Goal**: Reach 85% overall coverage

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [MCP SDK Testing Guide](https://github.com/modelcontextprotocol/sdk)
- [TypeScript Testing Patterns](https://github.com/goldbergyoni/javascript-testing-best-practices)