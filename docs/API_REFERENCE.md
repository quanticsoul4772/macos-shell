# API Reference - AI Optimization Utilities

## Table of Contents

1. [CommandPool](#commandpool)
2. [CircuitBreaker](#circuitbreaker)
3. [RequestDeduplicator](#requestdeduplicator)
4. [SystemGuardian](#systemguardian)
5. [AIMetricsCollector](#aimetricscollector)
6. [ErrorHandler](#errorhandler)
7. [MemoryManager](#memorymanager)
8. [ResourceCache](#resourcecache)

---

## CommandPool

Manages concurrent command execution with pooling, queueing, and rate limiting.

### Import

```typescript
import { CommandPool, commandPool } from './utils/command-pool.js';
```

### Constructor

```typescript
new CommandPool(options?: PoolOptions)
```

#### PoolOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxConcurrent` | `number` | 10 | Maximum concurrent commands |
| `maxQueueSize` | `number` | 100 | Maximum queue size |
| `queueTimeout` | `number` | 30000 | Queue timeout in milliseconds |
| `rateLimit` | `object` | `{ maxRequests: 100, windowMs: 60000 }` | Rate limiting configuration |

### Methods

#### execute

Executes a command through the pool.

```typescript
async execute(
  command: string,
  args?: string[],
  options?: ExecaOptions,
  priority?: number
): Promise<CommandResult>
```

**Parameters:**
- `command`: Command to execute
- `args`: Command arguments (optional)
- `options`: Execa options (optional)
- `priority`: Priority level 1-10, lower = higher priority (default: 5)

**Returns:** `CommandResult` with stdout, stderr, exitCode, success, and duration

**Throws:** 
- `Error` if rate limit exceeded
- `Error` if queue is full
- `Error` if command times out in queue

#### getStats

Returns current pool statistics.

```typescript
getStats(): PoolStats
```

**Returns:** `PoolStats` object containing:
- `active`: Number of active commands
- `queued`: Number of queued commands
- `completed`: Total completed commands
- `failed`: Total failed commands
- `averageWaitTime`: Average queue wait time
- `averageExecutionTime`: Average execution time
- `rejectedDueToQueueFull`: Count of queue rejections
- `rejectedDueToRateLimit`: Count of rate limit rejections

#### clearQueue

Clears all queued commands.

```typescript
clearQueue(): void
```

#### terminateAll

Terminates all active commands.

```typescript
async terminateAll(): Promise<void>
```

#### shutdown

Performs graceful shutdown.

```typescript
async shutdown(): Promise<void>
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `command-complete` | `{ id, command, result, waitTime, executionTime }` | Command completed successfully |
| `command-error` | `{ id, command, error }` | Command execution failed |
| `rate-limited` | `{ command, args }` | Command rejected due to rate limit |
| `queue-full` | `{ command, args, queueSize }` | Command rejected due to full queue |

### Example

```typescript
import { commandPool } from './utils/command-pool.js';

// High priority command
const result = await commandPool.execute('ls', ['-la'], {}, 1);

// Listen to events
commandPool.on('command-complete', (data) => {
  console.log(`Command ${data.id} completed in ${data.executionTime}ms`);
});

// Get statistics
const stats = commandPool.getStats();
console.log(`Active: ${stats.active}, Queued: ${stats.queued}`);
```

---

## CircuitBreaker

Implements the circuit breaker pattern for fault tolerance.

### Import

```typescript
import { CircuitBreaker, circuitBreakerRegistry } from './utils/circuit-breaker.js';
```

### Constructor

```typescript
new CircuitBreaker(name: string, options?: CircuitBreakerOptions)
```

#### CircuitBreakerOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `failureThreshold` | `number` | 5 | Consecutive failures to open circuit |
| `resetTimeout` | `number` | 60000 | Time before attempting reset (ms) |
| `monitoringWindow` | `number` | 60000 | Sliding window for metrics (ms) |
| `requestTimeout` | `number` | 30000 | Individual request timeout (ms) |
| `volumeThreshold` | `number` | 10 | Minimum requests before opening |
| `errorThresholdPercentage` | `number` | 50 | Error percentage to open circuit |

### Methods

#### execute

Executes a function through the circuit breaker.

```typescript
async execute<T>(
  fn: () => Promise<T>,
  fallback?: () => Promise<T>
): Promise<T>
```

**Parameters:**
- `fn`: Function to execute
- `fallback`: Optional fallback function when circuit is open

**Returns:** Result from function or fallback

**Throws:** `Error` if circuit is open and no fallback provided

#### getState

Returns current circuit state.

```typescript
getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN'
```

#### getMetrics

Returns circuit metrics.

```typescript
getMetrics(): CircuitMetrics
```

**Returns:** Metrics including successes, failures, state, lastFailureTime

#### reset

Manually resets the circuit.

```typescript
reset(): void
```

#### open

Manually opens the circuit.

```typescript
open(): void
```

### Registry Methods

#### getBreaker

Gets or creates a circuit breaker.

```typescript
circuitBreakerRegistry.getBreaker(
  name: string,
  options?: CircuitBreakerOptions
): CircuitBreaker
```

#### getAllBreakers

Returns all registered breakers.

```typescript
circuitBreakerRegistry.getAllBreakers(): Map<string, CircuitBreaker>
```

### Example

```typescript
import { circuitBreakerRegistry } from './utils/circuit-breaker.js';

const breaker = circuitBreakerRegistry.getBreaker('external-api');

try {
  const result = await breaker.execute(
    async () => await callExternalAPI(),
    async () => ({ cached: true, data: getCachedData() })
  );
} catch (error) {
  console.error('Circuit open or operation failed:', error);
}

console.log('Circuit state:', breaker.getState());
```

---

## RequestDeduplicator

Prevents duplicate requests by coalescing identical operations.

### Import

```typescript
import { RequestDeduplicator } from './utils/request-deduplicator.js';
```

### Constructor

```typescript
new RequestDeduplicator<T>(options?: DeduplicatorOptions)
```

#### DeduplicatorOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `ttl` | `number` | 5000 | Time to live for deduplicated requests (ms) |
| `maxSize` | `number` | 1000 | Maximum cache size |
| `cacheErrors` | `boolean` | false | Whether to cache failed requests |

### Methods

#### execute

Executes a function with deduplication.

```typescript
async execute<T>(
  fn: () => Promise<T>,
  ...keyParts: any[]
): Promise<T>
```

**Parameters:**
- `fn`: Function to execute
- `keyParts`: Parts to generate deduplication key

**Returns:** Result from function (may be from cache)

#### clear

Clears the deduplication cache.

```typescript
clear(): void
```

#### getStats

Returns deduplication statistics.

```typescript
getStats(): DeduplicatorStats
```

### Example

```typescript
import { RequestDeduplicator } from './utils/request-deduplicator.js';

const deduplicator = new RequestDeduplicator({ ttl: 5000 });

// These will share the same execution
const promise1 = deduplicator.execute(() => fetchData(), 'user', 123);
const promise2 = deduplicator.execute(() => fetchData(), 'user', 123);
const promise3 = deduplicator.execute(() => fetchData(), 'user', 123);

const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);
// Only one fetchData() call was made
```

---

## SystemGuardian

Monitors system resources and implements graceful degradation.

### Import

```typescript
import { systemGuardian, SystemLoad } from './utils/system-guardian.js';
```

### Enums

#### SystemLoad

```typescript
enum SystemLoad {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}
```

### Methods

#### getSystemState

Returns current system state.

```typescript
async getSystemState(): Promise<SystemState>
```

**Returns:** `SystemState` containing:
- `load`: Current load level
- `cpuUsage`: CPU usage percentage
- `memoryUsage`: Memory usage percentage
- `activeProcesses`: Number of active processes
- `queuedCommands`: Number of queued commands
- `recommendations`: Array of recommendations

#### isOperationAllowed

Checks if an operation is allowed under current policy.

```typescript
isOperationAllowed(operation: {
  type: 'command' | 'background' | 'complex';
  priority?: number;
}): boolean
```

#### getCurrentPolicy

Returns current degradation policy.

```typescript
getCurrentPolicy(): DegradationPolicy
```

**Returns:** Policy with maxConcurrent, timeouts, and feature flags

#### getAIStatus

Returns AI-optimized status report.

```typescript
getAIStatus(): {
  canExecute: boolean;
  load: SystemLoad;
  policy: DegradationPolicy;
  recommendations: string[];
}
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `load-change` | `{ oldLoad, newLoad, state }` | System load level changed |
| `state-update` | `SystemState` | Periodic state update |

### Example

```typescript
import { systemGuardian } from './utils/system-guardian.js';

// Check if operation is allowed
if (!systemGuardian.isOperationAllowed({ type: 'complex' })) {
  console.log('Complex operations not allowed under current load');
  return;
}

// Get AI status
const status = systemGuardian.getAIStatus();
if (!status.canExecute) {
  console.log('System overloaded:', status.recommendations[0]);
  return;
}

// Monitor load changes
systemGuardian.on('load-change', ({ oldLoad, newLoad }) => {
  console.log(`Load changed from ${oldLoad} to ${newLoad}`);
});
```

---

## AIMetricsCollector

Collects and provides metrics optimized for AI decision-making.

### Import

```typescript
import { aiMetrics } from './utils/ai-metrics.js';
```

### Methods

#### collect

Collects current metrics snapshot.

```typescript
async collect(): Promise<AIMetrics>
```

**Returns:** `AIMetrics` containing performance, reliability, resources, and recommendations

#### getTrends

Analyzes metric trends.

```typescript
getTrends(): {
  performanceTrend: 'improving' | 'stable' | 'degrading';
  reliabilityTrend: 'improving' | 'stable' | 'degrading';
  resourceTrend: 'improving' | 'stable' | 'degrading';
}
```

#### getDecisionSupport

Provides AI decision support data.

```typescript
getDecisionSupport(): {
  canExecuteCommand: boolean;
  shouldUseCache: boolean;
  shouldDefer: boolean;
  maxConcurrent: number;
  timeout: number;
}
```

#### clear

Clears metrics history.

```typescript
clear(): void
```

### Example

```typescript
import { aiMetrics } from './utils/ai-metrics.js';

// Collect metrics
const metrics = await aiMetrics.collect();
console.log('Success rate:', metrics.reliability.successRate);
console.log('Recommendations:', metrics.recommendations);

// Get decision support
const decision = aiMetrics.getDecisionSupport();
if (decision.shouldDefer) {
  console.log('Deferring operation due to high load');
  await delay(5000);
}

// Check trends
const trends = aiMetrics.getTrends();
if (trends.performanceTrend === 'degrading') {
  console.log('Performance degrading, reducing request rate');
}
```

---

## ErrorHandler

Enhanced error handling with recovery strategies.

### Import

```typescript
import { ErrorHandler } from './utils/error-handler.js';
```

### Constructor

```typescript
new ErrorHandler(options?: ErrorHandlerOptions)
```

#### ErrorHandlerOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxRetries` | `number` | 3 | Maximum retry attempts |
| `retryDelay` | `number` | 1000 | Initial retry delay (ms) |
| `backoffMultiplier` | `number` | 2 | Exponential backoff multiplier |
| `timeout` | `number` | 30000 | Operation timeout (ms) |

### Methods

#### handle

Handles an error with recovery strategies.

```typescript
async handle<T>(
  error: Error,
  context: ErrorContext,
  recoveryFn?: () => Promise<T>
): Promise<T | ErrorResult>
```

**Parameters:**
- `error`: The error to handle
- `context`: Context information about the error
- `recoveryFn`: Optional recovery function

**Returns:** Recovery result or error information

#### withRetry

Executes a function with automatic retry on failure.

```typescript
async withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T>
```

#### classifyError

Classifies an error for appropriate handling.

```typescript
classifyError(error: Error): ErrorClassification
```

**Returns:** Classification with severity, retryable flag, and category

### Example

```typescript
import { ErrorHandler } from './utils/error-handler.js';

const errorHandler = new ErrorHandler({ maxRetries: 3 });

// Handle with retry
try {
  const result = await errorHandler.withRetry(
    async () => await unstableOperation(),
    { maxAttempts: 5, delay: 2000 }
  );
} catch (error) {
  const handled = await errorHandler.handle(error, {
    operation: 'unstableOperation',
    params: {},
  });
  console.log('Recovery suggestion:', handled.suggestion);
}
```

---

## MemoryManager

Monitors and manages memory usage with automatic cleanup.

### Import

```typescript
import { memoryManager } from './utils/memory-manager.js';
```

### Methods

#### checkMemory

Checks current memory status.

```typescript
checkMemory(): MemoryStatus
```

**Returns:** Status with heapUsed, heapTotal, percentages, and pressure level

#### registerCleanupHandler

Registers a cleanup handler.

```typescript
registerCleanupHandler(
  name: string,
  handler: () => void | Promise<void>,
  priority?: number
): void
```

**Parameters:**
- `name`: Handler identifier
- `handler`: Cleanup function
- `priority`: Execution priority (lower = higher priority)

#### triggerCleanup

Manually triggers cleanup.

```typescript
async triggerCleanup(force?: boolean): Promise<CleanupResult>
```

#### getStats

Returns memory statistics.

```typescript
getStats(): MemoryStats
```

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `memory-pressure` | `{ level, stats }` | Memory pressure detected |
| `cleanup-complete` | `{ handlersRun, memoryFreed }` | Cleanup completed |

### Example

```typescript
import { memoryManager } from './utils/memory-manager.js';

// Register cleanup handler
memoryManager.registerCleanupHandler(
  'cache-cleanup',
  () => {
    myCache.clear();
    console.log('Cache cleared');
  },
  1 // High priority
);

// Check memory
const status = memoryManager.checkMemory();
if (status.pressure === 'high') {
  await memoryManager.triggerCleanup();
}

// Monitor memory pressure
memoryManager.on('memory-pressure', ({ level }) => {
  console.log(`Memory pressure: ${level}`);
});
```

---

## ResourceCache

Caches resource data with TTL and LRU eviction.

### Import

```typescript
import { resourceCache } from './utils/resource-cache.js';
```

### Methods

#### get

Gets cached resource data.

```typescript
async get(pid: number): Promise<ResourceData | null>
```

#### set

Sets resource data in cache.

```typescript
set(pid: number, data: ResourceData): void
```

#### invalidate

Invalidates cache entry.

```typescript
invalidate(pid: number): void
```

#### clear

Clears entire cache.

```typescript
clear(): void
```

#### getStats

Returns cache statistics.

```typescript
getStats(): CacheStats
```

**Returns:** Stats with size, hitRate, missCount, hitCount

### Example

```typescript
import { resourceCache } from './utils/resource-cache.js';

// Get cached or fetch
let data = await resourceCache.get(12345);
if (!data) {
  data = await fetchResourceData(12345);
  resourceCache.set(12345, data);
}

// Check cache performance
const stats = resourceCache.getStats();
console.log(`Cache hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
```

---

## Type Definitions

### CommandResult

```typescript
interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  duration: number;
}
```

### SystemState

```typescript
interface SystemState {
  load: SystemLoad;
  cpuUsage: number;
  memoryUsage: number;
  activeProcesses: number;
  queuedCommands: number;
  recommendations: string[];
}
```

### DegradationPolicy

```typescript
interface DegradationPolicy {
  maxConcurrent: number;
  queueTimeout: number;
  commandTimeout: number;
  allowComplexCommands: boolean;
  allowBackgroundProcesses: boolean;
  cacheOnly: boolean;
}
```

### AIMetrics

```typescript
interface AIMetrics {
  timestamp: Date;
  performance: {
    commandPoolUtilization: number;
    averageExecutionTime: number;
    averageWaitTime: number;
    cacheHitRate: number;
    deduplicationRate: number;
  };
  reliability: {
    successRate: number;
    circuitBreakerStates: Record<string, string>;
    errorRate: number;
    recoveryRate: number;
  };
  resources: {
    memoryUsagePercent: number;
    cpuLoad: number;
    systemLoad: string;
    queueDepth: number;
  };
  recommendations: string[];
}
```

---

## Error Handling

All utilities follow consistent error handling patterns:

1. **Typed Errors**: Errors have specific types and codes
2. **Recovery Strategies**: Automatic retry with exponential backoff
3. **Fallback Mechanisms**: Circuit breakers provide fallbacks
4. **Graceful Degradation**: System adapts to failure conditions

### Common Error Codes

| Code | Description | Recovery |
|------|-------------|----------|
| `RATE_LIMIT_EXCEEDED` | Too many requests | Wait and retry |
| `QUEUE_FULL` | Command queue full | Retry with backoff |
| `CIRCUIT_OPEN` | Service unavailable | Use fallback |
| `TIMEOUT` | Operation timeout | Retry or defer |
| `MEMORY_PRESSURE` | High memory usage | Trigger cleanup |

---

## Performance Considerations

### Best Practices

1. **Use Priority Levels**: Assign appropriate priorities to commands
2. **Monitor Metrics**: Regularly check system metrics
3. **Handle Circuit States**: Implement fallbacks for open circuits
4. **Respect Rate Limits**: Don't retry immediately on rate limit errors
5. **Cache Appropriately**: Use deduplication for identical requests

### Optimization Tips

```typescript
// Batch similar operations
const results = await Promise.all(
  items.map(item => 
    commandPool.execute('process', [item], {}, 5)
  )
);

// Use circuit breaker fallbacks
const data = await breaker.execute(
  async () => await fetchFromAPI(),
  async () => await fetchFromCache()
);

// Check system state before heavy operations
if (systemGuardian.getCurrentPolicy().cacheOnly) {
  return cachedResult;
}
```

---

## Migration Guide

### From Direct Execution to Command Pool

**Before:**
```typescript
const result = await execa('ls', ['-la']);
```

**After:**
```typescript
const result = await commandPool.execute('ls', ['-la']);
```

### Adding Circuit Breakers

**Before:**
```typescript
const data = await riskyAPICall();
```

**After:**
```typescript
const breaker = circuitBreakerRegistry.getBreaker('api');
const data = await breaker.execute(() => riskyAPICall());
```

### Implementing Deduplication

**Before:**
```typescript
const result1 = await heavyOperation(id);
const result2 = await heavyOperation(id); // Duplicate
```

**After:**
```typescript
const dedup = new RequestDeduplicator();
const result1 = await dedup.execute(() => heavyOperation(id), id);
const result2 = await dedup.execute(() => heavyOperation(id), id); // Cached
```

---

## Support

For issues or questions about these utilities, please refer to:
- GitHub Issues: https://github.com/quanticsoul4772/macos-shell/issues
- Documentation: `/docs` directory
- Source Code: `/src/utils` directory