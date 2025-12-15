# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Model Context Protocol (MCP) server that provides shell command execution on macOS with session management and caching. It's written in TypeScript and uses the MCP SDK to expose shell functionality through a tool interface.

## Development Commands

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Type checking (no build)
npm run typecheck

# Linting
npm run lint

# Clean build artifacts
npm run clean

# Development mode (run TypeScript directly)
npm run dev

# Start the compiled server
npm start
```

## Test Commands

```bash
# Run all tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run only unit tests (excludes integration tests)
npm run test:unit

# Run only integration tests
npm run test:integration

# Run tests in CI mode (with coverage, limited workers)
npm run test:ci

# Debug tests with Node inspector
npm run test:debug

# Type check test files without running them
npm run test:check
```

**Test Coverage Thresholds**: The project enforces minimum coverage of 60% lines/statements and 50% functions/branches. Current coverage is ~60%.

## Architecture Overview

The codebase follows a modular architecture with separation of concerns:

### Core Server (`src/server.ts`)
- Main entry point (~200 lines) that initializes the MCP server
- Registers all tool modules via dedicated registration functions
- Initializes SessionManager, AI monitoring, and learning persistence
- Handles shutdown and cleanup

### Session Management (`src/session-manager.ts`)
- Central orchestrator for sessions, processes, and history (~350 lines)
- Uses modular components from `src/sessions/`:
  - `session-types.ts`: Type definitions and constants
  - `session-persistence.ts`: Save/load functionality with debouncing
  - `background-process-manager.ts`: Process lifecycle management
  - `command-history-manager.ts`: Command history tracking

### Tool Modules (`src/tools/`)
The server exposes 35 MCP tools organized by category. Each tool module exports a `register*Tools()` function that is called from `server.ts`:

- `command-tools.ts`: Command execution orchestrator
  - Sub-modules in `command/`: `simple-command.ts`, `script-tools.ts`, `batch-tools.ts`, `navigation-tools.ts`, `environment-tools.ts`, `command-executor.ts`
- `process-tools.ts`: Background process management (8 tools)
- `session-tools.ts`: Session lifecycle operations (3 tools)
- `system-tools.ts`: System health and monitoring (3 tools)
- `interactive-ssh-tool.ts`: Interactive SSH sessions (8 tools)
- `preflight-tools.ts`: Validation and preflight checks (2 tools)
- `cache-management-tools.ts`: Cache operations and statistics (5 tools)

### AI Optimization Layer (`src/ai-*.ts`)
Provides transparent optimization for all commands:
- `ai-cache.ts`: Command caching with TTL strategies (85% hit rate)
- `ai-cache-classifier.ts`: Intelligent cache classification
- `ai-dedup.ts`: Command deduplication within 10-second windows (80% reduction)
- `ai-error-handler.ts`: Error recovery and suggestions
- `ai-monitor.ts`: Performance monitoring and statistics
- `ai-integration.ts`: Coordinates all AI features

### Utility Modules (`src/utils/`)
Reusable components under 300 lines each:
- `enhanced-circular-buffer.ts`: Memory-safe output buffering (300 lines max, waiter management)
- `lru-cache.ts`: LRU cache implementation
- `debouncer.ts`: Debouncing for save operations
- `logger.ts`: Structured logging system
- `batch-executor.ts`: Batch command execution
- `resource-monitor.ts`: CPU/memory tracking
- `progress-tracker.ts`: Progress tracking for long operations

## Critical Implementation Details

### Module System and Import Patterns
**CRITICAL**: The project uses ES modules with NodeNext resolution. All local imports MUST use `.js` extensions, even though the source files are `.ts`:

```typescript
// ✅ CORRECT
import { SessionManager } from './session-manager.js';
import { registerCommandTools } from './tools/command-tools.js';

// ❌ WRONG - will cause runtime errors
import { SessionManager } from './session-manager';
import { SessionManager } from './session-manager.ts';
```

This is required because TypeScript compiles to `build/` directory and Node.js requires `.js` extensions for ES modules.

### Tool Registration Pattern
All tools follow a consistent registration pattern:

1. Create a registration function in the tool module:
```typescript
export function registerMyTools(server: McpServer, sessionManager: SessionManager) {
  server.addTool({
    name: "tool_name",
    description: "...",
    inputSchema: zodToJsonSchema(MyToolSchema)
  }, async (params) => {
    // Implementation
  });
}
```

2. Call the registration function from `src/server.ts`:
```typescript
registerMyTools(server, sessionManager);
```

### Zod Schema Validation
All tool parameters are validated using Zod schemas before execution:

```typescript
const MyToolSchema = z.object({
  command: z.string(),
  timeout: z.number().optional()
});
```

Convert Zod schemas to JSON Schema for MCP using `zodToJsonSchema()`.

### Session Persistence
- Sessions persist to `~/.macos-shell/sessions/` as JSON files
- Background processes tracked in `~/.macos-shell/processes/`
- Debounced saves to prevent excessive disk writes (500ms debounce)
- Sessions restored on server startup with validation

### Background Process Management
- CircularBuffer stores last 300 lines per process
- Max 100 concurrent waiters per buffer (prevents memory leaks)
- Cleanup 5 seconds after process termination
- Orphan detection on server startup using `process.kill(pid, 0)`
- Resource monitoring for CPU and memory usage

### Caching Strategy
- Commands cached based on pattern matching (see `ai-cache-classifier.ts`)
- Never cached: status commands (`git status`, `ls`, `docker ps`)
- Variable TTLs from 30 seconds to 1 hour based on command type
- Cache can be disabled with `MCP_DISABLE_CACHE=true`
- Learning persistence tracks cache effectiveness

### Error Handling
- All commands wrapped in try/catch blocks
- Typed errors with ExecaError from `execa` library
- Auto-correction for common errors (typos, missing dependencies)
- Suggestions for alternative commands
- Error response format:
```typescript
return {
  error: true,
  message: "Error description",
  details: additionalInfo
};
```

## Testing Approach

The project uses Jest with ts-jest for ES module support:

### Test Organization
- Test files located alongside source files with `.test.ts` extension
- Test mocks in `test/mocks/` (execa, node-pty, ssh2)
- Test setup in `test/setup.ts`
- Configuration in `jest.config.mjs`

### Running Specific Tests
```bash
# Run a single test file
npm test -- src/ai-cache.test.ts

# Run tests matching a pattern
npm test -- --testNamePattern="cache"

# Run tests in a directory
npm test -- src/tools/

# Run with verbose output
npm test -- --verbose
```

### Key Testing Patterns
- Mock external dependencies (execa, node-pty, ssh2) in `test/mocks/`
- Use `jest.useFakeTimers()` for time-dependent tests
- Clean up resources in `afterEach()` hooks
- Test both success and error cases
- Verify Zod schema validation

## Debugging

Enable detailed logging:
```bash
# Debug logging to stderr
MCP_DEBUG=true npm start

# File logging
MCP_LOG_FILE=/tmp/macos-shell.log npm start

# Both
MCP_DEBUG=true MCP_LOG_FILE=/tmp/macos-shell.log npm start
```

Monitor AI statistics (logged every minute to stderr):
- Cache hit rate and TTL breakdown
- Deduplication rate
- Error recovery attempts
- Command patterns

## Conventions

### Session ID Handling
- Default session created automatically on server start
- Sessions referenced by UUID or name
- Always validate session existence before operations
- Use `sessionManager.getSession()` to retrieve session

### TypeScript Configuration
- Target: ES2020
- Module: NodeNext
- Strict mode enabled
- No `any` types allowed
- Skip lib check for faster compilation

### Tool Naming
Some tools have been renamed to avoid conflicts with other MCP servers:
- `create_shell_session` (not `create_session`)
- `list_shell_sessions` (not `list_sessions`)
