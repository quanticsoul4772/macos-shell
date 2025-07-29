# macOS Shell MCP Server - Architecture Documentation

## Overview

The macOS Shell MCP Server has been refactored from a monolithic 1,910-line file into a modular architecture for AI usage patterns. This document details the current architecture, design decisions, and implementation patterns.

## Architecture Evolution

### Version 1.x - Monolithic (Legacy)
- Single 1,910-line server.ts file
- All 20+ tools in one file
- Difficult to maintain and test
- High cyclomatic complexity (30+)

### Version 2.x - Initial Modularization
- Split into tool modules
- Session manager extracted
- Background process management added
- Reduced to ~500 lines per module

### Version 3.x - AI-Optimized Architecture (Current)
- Modular architecture
- AI-specific optimizations
- Performance monitoring
- Caching and deduplication
- Memory management implementations
- **Buffer optimization**: 300-line buffers (97% memory reduction)

## Core Architecture Components

### 1. Main Server (`server.ts`)
- **Lines**: 192 (90% reduction from v1)
- **Responsibilities**:
  - MCP server initialization
  - Tool registration orchestration
  - Performance monitoring setup
  - Session manager initialization

### 2. Session Management

#### `session-manager.ts` (Refactored)
- **Lines**: 350 (was 712)
- **Orchestrates**:
  - Session lifecycle
  - Background process coordination
  - Persistence management

#### Session Modules (`src/sessions/`)
- `session-types.ts` (99 lines) - Core types and constants
- `session-persistence.ts` (342 lines) - Save/load functionality
- `background-process-manager.ts` (429 lines) - Process lifecycle
- `command-history-manager.ts` (212 lines) - History tracking

### 3. Tool Modules (`src/tools/`)

#### Command Tools (Refactored)
- `command-tools.ts` (83 lines) - Orchestrator
- `command/` subdirectory:
  - `command-executor.ts` (106 lines) - Core execution
  - `ai-command-enhancer.ts` (138 lines) - AI features
  - `environment-tools.ts` (99 lines) - Env management
  - `script-tools.ts` (157 lines) - Script execution
  - `batch-tools.ts` (133 lines) - Batch operations
  - `navigation-tools.ts` (140 lines) - Directory navigation

#### Process Tools (Refactored)
- `process-tools.ts` (130 lines) - Tool registration
- `helpers/` subdirectory:
  - `process-helpers.ts` (124 lines) - Utilities
  - `process-search.ts` (205 lines) - Output searching
  - `process-handlers.ts` (398 lines) - Core handlers
  - `process-orphan.ts` (168 lines) - Orphan management
  - `process-save.ts` (103 lines) - Output persistence

#### Interactive SSH Tools (Refactored)
- `interactive-ssh-tool.ts` (186 lines) - Tool registration
- `helpers/` subdirectory:
  - `ssh-tool-handlers.ts` (252 lines) - Core handlers
  - `ssh-session-manager.ts` (242 lines) - Session management

#### Other Tools
- `session-tools.ts` (117 lines) - Session management tools
- `system-tools.ts` (40 lines) - System health monitoring
- `preflight-tools.ts` (361 lines) - Validation tools
- `enhanced-ssh-tool.ts` (288 lines) - SSH execution

### 4. AI Optimization Layer (`src/`)

#### Core AI Features
- `ai-cache.ts` (262 lines) - Command result caching
- `ai-dedup.ts` (264 lines) - Deduplication system
- `ai-error-handler.ts` (324 lines) - Error recovery
- `ai-integration.ts` (58 lines) - Integration layer
- `ai-monitor.ts` (159 lines) - Performance monitoring

#### How AI Optimizations Work

1. **Command Caching**
   - LRU cache with 30-60 minute TTLs
   - Cache key: command + working directory
   - Performance improvement (120ms → 1ms)

2. **Deduplication**
   - 10-second window for identical commands
   - Prevents redundant executions
   - Normalizes command variations

3. **Error Recovery**
   - Retry with exponential backoff
   - Command correction (typos, missing flags)
   - Recovery rate tracking

4. **Performance Monitoring**
   - Stats every minute
   - Tracks cache hits, dedup rate, recovery rate
   - Zero-configuration operation

### 5. Utility Modules (`src/utils/`)

#### Performance Utilities
- `lru-cache.ts` (79 lines) - LRU cache implementation
- `debouncer.ts` (41 lines) - Function debouncing
- `logger.ts` (51 lines) - Structured logging system

#### Process Management
- `enhanced-circular-buffer.ts` (209 lines) - Output buffer with memory management
- `batch-executor.ts` (186 lines) - Batch command execution
- `enhanced-batch-executor.ts` (489 lines) - Conditional batch execution
- `native-ssh-manager.ts` (475 lines) - SSH connection management

#### Resource Monitoring
- `resource-monitor.ts` (204 lines) - CPU/memory tracking
- `circuit-breaker.ts` (51 lines) - Fault tolerance

## Design Patterns

### 1. Single Responsibility Principle
Each module has one purpose:
- Session management
- Command execution
- Process lifecycle
- Error handling
- Performance optimization

### 2. Dependency Injection
Tools receive dependencies through registration:
```typescript
export function registerCommandTools(
  server: McpServer,
  sessionManager: SessionManager,
  batchExecutor: BatchExecutor
)
```

### 3. Factory Pattern
Tool registration functions act as factories:
```typescript
server.tool("run_command", schema, handler);
```

### 4. Observer Pattern
Process output streaming and monitoring:
```typescript
buffer.addWaiter(afterLine, callback);
```

### 5. Circuit Breaker Pattern
Resource monitoring with recovery:
```typescript
if (circuitBreaker.isOpen()) {
  return cachedMetrics;
}
```

## Memory Management

### Circular Buffer
- Fixed size: 300 lines per process (reduced from 10,000)
- AI-optimized: 97% memory reduction (48KB vs 1.6MB)
- AI processes output immediately, no scrollback needed
- Waiter management with limits
- Maximum 100 concurrent waiters
- Cleanup every 30 seconds
- Force cleanup at 80% capacity

### Session Persistence
- JSON serialization to disk
- Debounced saves
- Shutdown handling
- Process metadata preservation

### Resource Limits
- Maximum processes per session
- Timeout enforcement
- Memory usage monitoring
- Process cleanup

## Error Handling Strategy

### Layered Error Handling
1. **Tool Level**: Input validation, parameter checking
2. **Execution Level**: Command errors, timeouts
3. **AI Level**: Recovery, correction
4. **System Level**: Resource limits, circuit breakers

### Error Response Format
```json
{
  "error": {
    "code": "COMMAND_FAILED",
    "message": "Detailed error description",
    "recoverable": true,
    "suggestion": "Try using --force flag"
  }
}
```

## Performance Characteristics

### Command Execution
- **Cached**: 1ms
- **Deduplicated**: 0ms (returns existing)
- **Fresh**: 50-200ms (typical)
- **With retry**: 200-600ms

### SSH Operations
- **New connection**: 2000ms
- **Existing session**: 0ms
- **Session persistence**: Indefinite

### Background Processes
- **Spawn overhead**: 20-50ms
- **Output buffering**: Real-time
- **Resource monitoring**: 5s intervals
- **Cleanup delay**: 5s after exit

## Testing Strategy

### Unit Tests
- Individual module testing
- Mocked dependencies
- Edge case coverage

### Integration Tests
- Tool registration verification
- Session lifecycle testing
- Process management flows

### Performance Tests
- Cache hit rates
- Deduplication effectiveness
- Memory usage patterns

## Security Considerations

### Process Isolation
- Sessions have isolated environments
- No cross-session contamination
- Cleanup on termination

### Input Validation
- Zod schemas for all tools
- Path traversal prevention
- Command injection protection

### Resource Protection
- Rate limiting
- Memory limits
- Process count limits
- Timeout enforcement

## Future Architecture Goals

### Short Term
- [ ] Plugin system for custom tools
- [ ] Metrics export for monitoring
- [ ] Error recovery patterns

### Long Term
- [ ] Distributed execution support
- [ ] Container-based isolation
- [ ] Caching strategies
- [ ] Machine learning for command prediction

## Contributing Guidelines

### Adding New Tools
1. Create tool module in `src/tools/`
2. Keep under 300 lines
3. Use existing patterns
4. Add to server.ts registration

### Refactoring Existing Code
1. Check complexity metrics first
2. Split by responsibility
3. Maintain backward compatibility
4. Update tests

### Performance Improvements
1. Measure before optimizing
2. Use AI monitoring data
3. Test with real workloads
4. Document improvements

## Conclusion

The modular architecture provides:
- **Maintainability**: Easier to understand and modify
- **Performance**: Optimized for AI patterns
- **Reliability**: Memory management, fault tolerance
- **Extensibility**: New features can be added

This architecture serves as a foundation for continued evolution while maintaining stability and performance.