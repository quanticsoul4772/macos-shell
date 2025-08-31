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

# Run tests
npm test

# Development mode (run TypeScript directly)
npm run dev

# Start the compiled server
npm start
```

## Architecture Overview

The codebase follows a modular architecture with separation of concerns:

### Core Server (`src/server.ts`)
- Main entry point that initializes the MCP server
- Registers all tool modules
- Handles shutdown and cleanup

### Session Management (`src/session-manager.ts`)
- Orchestrator for sessions, processes, and history
- Uses modular components from `src/sessions/`:
  - `session-types.ts`: Type definitions and constants
  - `session-persistence.ts`: Save/load functionality
  - `background-process-manager.ts`: Process lifecycle management
  - `command-history-manager.ts`: Command history tracking

### Tool Modules (`src/tools/`)
The server exposes 35 MCP tools organized by category:
- `command-tools.ts`: Command execution orchestrator with sub-modules in `command/`
- `process-tools.ts`: Background process management
- `session-tools.ts`: Session lifecycle operations
- `system-tools.ts`: System health and monitoring
- `interactive-ssh-tool.ts`: Interactive SSH sessions
- `preflight-tools.ts`: Validation and preflight checks
- `cache-management-tools.ts`: Cache operations and statistics

### AI Optimization Layer (`src/ai-*.ts`)
- `ai-cache.ts`: Command caching with TTL strategies
- `ai-dedup.ts`: Command deduplication within 10-second windows
- `ai-error-handler.ts`: Error recovery and suggestions
- `ai-monitor.ts`: Performance monitoring and statistics
- `ai-integration.ts`: Coordinates all AI features

### Utility Modules (`src/utils/`)
- `enhanced-circular-buffer.ts`: Memory-safe output buffering
- `lru-cache.ts`: LRU cache implementation
- `debouncer.ts`: Debouncing for save operations
- `logger.ts`: Logging system
- `batch-executor.ts`: Batch command execution

## Implementation Details

### Module System
- Uses ES modules with `.js` extensions in imports (required for NodeNext)
- TypeScript compiles to `build/` directory
- Target: ES2020, Module: NodeNext

### Session Persistence
- Sessions persist to `~/.macos-shell/sessions/` as JSON files
- Background processes tracked in `~/.macos-shell/processes/`
- Save debouncing to prevent excessive disk writes

### Background Process Management
- CircularBuffer stores last 300 lines per process
- Cleanup 5 seconds after process termination
- Orphan detection on server startup
- Resource monitoring for CPU and memory usage

### Caching Strategy
- Commands cached based on pattern matching
- Never cached: status commands (`git status`, `ls`, `docker ps`)
- Variable TTLs from 30 seconds to 1 hour based on command type
- Cache can be disabled with `MCP_DISABLE_CACHE=true`

### Error Handling
- All commands wrapped in try/catch blocks
- Typed errors with ExecaError
- Auto-correction for common errors (typos, missing dependencies)
- Suggestions for alternative commands

## Testing Approach

The project uses Jest with ts-jest for testing:
- Test files located alongside source files with `.test.ts` extension
- Configuration in `jest.config.js` for ES modules
- Run all tests: `npm test`
- Tests should be written for new tool implementations

## Common Development Tasks

### Adding a New Tool
1. Create tool handler in appropriate module under `src/tools/`
2. Register the tool in the module's export function
3. Follow existing patterns for parameter validation using Zod schemas
4. Add logging and error handling

### Modifying AI Features
- Cache strategies: Edit `src/ai-cache-classifier.ts`
- Error recovery: Update `src/ai-error-handler.ts`
- Performance metrics: Modify `src/ai-monitor.ts`

### Debugging
- Enable debug logging: `MCP_DEBUG=true`
- File logging: Set `MCP_LOG_FILE=/path/to/log`
- Monitor AI stats: Check stderr output every minute

## Conventions

### Import Statements
Always use `.js` extensions for local imports:
```typescript
import { SessionManager } from './session-manager.js';
```

### Tool Registration
Tools are registered in their respective modules:
```typescript
export function registerCommandTools(server: McpServer, sessionManager: SessionManager) {
  server.addTool({
    name: "tool_name",
    description: "...",
    inputSchema: zodSchema
  }, async (params) => {
    // Implementation
  });
}
```

### Error Response Format
Return errors in this format:
```typescript
return {
  error: true,
  message: "Error description",
  details: additionalInfo
};
```

### Session ID Handling
- Default session created automatically
- Sessions referenced by UUID or name
- Always validate session existence before operations