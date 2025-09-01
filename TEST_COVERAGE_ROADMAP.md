# Test Coverage Improvement Roadmap

## Current Status
- **Coverage**: 8.85% (Target: 60%)
- **Tests**: 95 passing in 6 test files
- **Gap**: Need ~50-60 new test files

## Fixed Issues
1. ✅ Created ESM-compatible Jest configuration
2. ✅ Added mocks for external dependencies (execa, node-pty, ssh2)
3. ✅ Created test examples for core modules

## Phase 1: Foundation (Week 1) - Target 25% Coverage
Priority: Test modules without external dependencies

### High Priority Files to Test
1. **Pattern Matcher** (src/pattern-matcher.ts) ✅
   - Already created test file
   - Complexity: 54, Lines: 412
   
2. **AI Cache** (src/ai-cache.ts) ✅
   - Already created test file
   - Complexity: 51, Lines: 413
   
3. **Session Manager** (src/session-manager.ts) ✅
   - Already created test file
   - Lines: 348

### Next Files to Test
4. **AI Deduplication** (src/ai-dedup.ts)
   - No external deps
   - Lines: 264
   
5. **Output Analyzer** (src/output-analyzer.ts)
   - No external deps
   - Lines: 181
   
6. **Duplicate Detector** (src/duplicate-detector.ts)
   - No external deps
   - Lines: 143

## Phase 2: Utilities (Week 2) - Target 40% Coverage
Test remaining utility modules:

1. **Circuit Breaker** (src/utils/circuit-breaker.ts)
2. **Memory Manager** (src/utils/memory-manager.ts)
3. **Request Deduplicator** (src/utils/request-deduplicator.ts)
4. **Resource Cache** (src/utils/resource-cache.ts)
5. **System Guardian** (src/utils/system-guardian.ts)
6. **AI Metrics** (src/utils/ai-metrics.ts)

## Phase 3: Tool Modules (Week 3) - Target 50% Coverage
Test tool modules with mocked dependencies:

1. **Cache Management Tools** (src/tools/cache-management-tools.ts)
2. **Session Tools** (src/tools/session-tools.ts)
3. **System Tools** (src/tools/system-tools.ts)
4. **Environment Tools** (src/tools/command/environment-tools.ts)
5. **Navigation Tools** (src/tools/command/navigation-tools.ts)

## Phase 4: Complex Modules (Week 4) - Target 60%+
Test modules with complex dependencies:

1. **Command Executor** (src/tools/command/command-executor.ts)
   - Use mocked execa
   - Complexity: Very High
   
2. **Background Process Manager** (src/sessions/background-process-manager.ts)
   - Use mocked node-pty
   - Complexity: 52
   
3. **SSH Tools** (src/tools/interactive-ssh-tool.ts)
   - Use mocked ssh2
   - Lines: 186

## Testing Strategy

### 1. Unit Tests
- Test pure functions and classes
- Mock all external dependencies
- Focus on business logic

### 2. Integration Tests
Create integration tests that test multiple modules together:
```typescript
// Example: test/integration/command-flow.test.ts
describe('Command Execution Flow', () => {
  it('should execute command with caching', async () => {
    // Test cache -> dedup -> execute -> pattern flow
  });
});
```

### 3. Mock Strategy
All external deps are mocked in test/mocks/:
- execa → Mock command execution
- node-pty → Mock terminal sessions
- ssh2 → Mock SSH connections

### 4. Test Helpers
Create test utilities:
```typescript
// test/helpers/test-utils.ts
export const createMockSession = () => {...}
export const createMockCommand = () => {...}
export const waitForAsync = () => {...}
```

## Quick Start Commands

```bash
# Run new tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch

# Run specific test file
npm test -- src/pattern-matcher.test.ts
```

## Common Test Patterns

### Testing Async Functions
```typescript
it('should handle async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

### Testing Event Emitters
```typescript
it('should emit events', (done) => {
  emitter.on('event', (data) => {
    expect(data).toBe('expected');
    done();
  });
  emitter.trigger();
});
```

### Testing with Mocks
```typescript
import { execa } from 'execa'; // Will use mock
jest.mocked(execa).mockResolvedValue({
  stdout: 'mocked output',
  stderr: '',
  exitCode: 0
});
```

## Troubleshooting

### ESM Issues
- Ensure NODE_OPTIONS='--experimental-vm-modules' is set
- Use .mjs extension for jest config
- Import with .js extensions in test files

### Mock Issues
- Mocks are in test/mocks/ directory
- Jest moduleNameMapper handles resolution
- Use jest.mocked() for type safety

### Coverage Issues
- Excluded files: types/, *.d.ts, *.test.ts
- Threshold: 60% lines, 50% branches/functions
- Use --coverage flag to generate report

## Success Metrics
- [ ] 25% coverage by end of Week 1
- [ ] 40% coverage by end of Week 2
- [ ] 50% coverage by end of Week 3
- [ ] 60%+ coverage by end of Week 4
- [ ] All critical paths tested
- [ ] CI/CD pipeline green

## Resources
- Jest ESM Docs: https://jestjs.io/docs/ecmascript-modules
- ts-jest ESM: https://kulshekhar.github.io/ts-jest/docs/guides/esm-support
- Mocking Guide: https://jestjs.io/docs/mock-functions
