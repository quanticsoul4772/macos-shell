# Testing

## Status

- 41 test suites, 712 tests, 100% pass rate
- Coverage: 60.62% lines, 52.84% branches, 66.33% functions
- Execution time: ~32 seconds

Coverage thresholds enforced in CI: 60% lines/statements, 50% branches/functions.

## Running tests

```bash
npm test                           # run all tests
npm run test:coverage              # run with coverage report
npm run test:watch                 # watch mode
npm run test:unit                  # unit tests only
npm run test:integration           # integration tests only
npm test -- src/ai-cache.test.ts   # single file
npm test -- --testNamePattern="cache"  # match pattern
npm run test:debug                 # debug with Node inspector
```

## Test organization

Tests live alongside source files with `.test.ts` extensions:

```
src/
  ai-*.test.ts               # AI component tests (6 files)
  session-manager.test.ts     # session orchestration
  tools/*.test.ts             # tool implementation tests (8 files)
  tools/command/*.test.ts     # command tool tests
  sessions/*.test.ts          # session management tests (2 files)
  utils/*.test.ts             # utility tests (14 files)
```

External dependency mocks are in `test/mocks/` (execa, node-pty, ssh2). Test setup is in `test/setup.ts`.

## Configuration

Jest with ts-jest for ESM support, configured in `jest.config.mjs`. Key settings:

- Preset: `ts-jest/presets/default-esm`
- Module mapper resolves `.js` imports to `.ts` source
- Coverage excludes `.d.ts`, `.test.ts`, and type-only files

## Writing tests

Follow the arrange-act-assert pattern. Mock external dependencies (execa, node-pty, ssh2) using the mocks in `test/mocks/`. Use `jest.useFakeTimers()` for time-dependent tests and clean up in `afterEach`.

```typescript
describe('ComponentName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should do the expected thing', async () => {
    const input = 'test';
    const result = await component.method(input);
    expect(result).toBe('expected');
  });
});
```
