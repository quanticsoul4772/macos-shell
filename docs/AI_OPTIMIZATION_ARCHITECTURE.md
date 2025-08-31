# AI Optimization Architecture

## Overview

The macOS Shell MCP Server has been enhanced with sophisticated performance and reliability optimizations specifically designed for AI agent usage. This document provides a comprehensive architectural overview of these improvements.

## Core Architecture Components

### 1. Command Execution Pool (`src/utils/command-pool.ts`)

The command pool manages concurrent command execution with intelligent queueing and rate limiting.

**Key Features:**
- **Concurrent Execution Management**: Controls up to 10 concurrent commands
- **Priority Queue System**: Commands execute based on priority (1-10, lower = higher priority)
- **Rate Limiting**: 100 requests per minute to prevent system overload
- **Queue Management**: Maximum 100 queued commands with timeout protection
- **Statistics Collection**: Tracks execution times, wait times, and rejection rates

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                    Command Pool                         │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   Priority   │  │     Rate     │  │   Active     │ │
│  │    Queue     │→ │   Limiter    │→ │  Commands    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
│         ↓                                      ↓        │
│  ┌──────────────────────────────────────────────────┐  │
│  │             Statistics Collector                 │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 2. Circuit Breaker Pattern (`src/utils/circuit-breaker.ts`)

Implements the circuit breaker pattern to prevent cascading failures and enable self-healing.

**State Machine:**
```
         ┌────────┐
         │ CLOSED │ ← Normal operation
         └────┬───┘
              │ Failure threshold reached
         ┌────▼───┐
         │  OPEN  │ ← Failing, reject requests
         └────┬───┘
              │ Timeout expires
         ┌────▼──────┐
         │ HALF_OPEN │ ← Testing recovery
         └───────────┘
```

**Configuration:**
- Failure threshold: 5 consecutive failures or 50% error rate
- Recovery timeout: 60 seconds
- Sliding window: Last 60 seconds of operations

### 3. Request Deduplication (`src/utils/request-deduplicator.ts`)

Prevents redundant operations by coalescing identical requests within a time window.

**Architecture:**
```
┌─────────────────────────────────────────────────┐
│           Request Deduplicator                   │
├─────────────────────────────────────────────────┤
│  Request 1 ─┐                                   │
│  Request 2 ─┼→ SHA256 Hash → Cache → Execution │
│  Request 3 ─┘     (key)       (5s)              │
└─────────────────────────────────────────────────┘
```

**TTL Strategy:**
- Commands: 5 seconds
- File operations: 2 seconds
- Error caching: Optional

### 4. System Guardian (`src/utils/system-guardian.ts`)

Monitors system resources and implements graceful degradation policies.

**Load Levels and Policies:**

| Load Level | CPU/Memory | Concurrent | Timeout | Features |
|------------|------------|------------|---------|----------|
| LOW        | <20%/40%   | 20         | 120s    | All enabled |
| NORMAL     | 20-70%     | 10         | 60s     | All enabled |
| HIGH       | 70-90%     | 5          | 30s     | No background |
| CRITICAL   | >90%       | 2          | 10s     | Cache only |

**Monitoring Flow:**
```
System Metrics → Load Calculator → Policy Selector → Enforcement
     ↓                                                    ↓
  AI Metrics ← Recommendations ← State Events ← Circuit Control
```

### 5. AI Metrics Collector (`src/utils/ai-metrics.ts`)

Collects and provides metrics optimized for AI decision-making.

**Metrics Structure:**
```typescript
interface AIMetrics {
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

## Integration Architecture

### Component Interaction Flow

```
                    ┌──────────────────┐
                    │   AI Agent       │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  AI Metrics      │
                    │   Collector      │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
     ┌────▼─────┐     ┌──────▼──────┐   ┌──────▼──────┐
     │ Command  │     │   Circuit   │   │   System    │
     │   Pool   │ ←→  │   Breaker   │ ←→│  Guardian   │
     └────┬─────┘     └──────┬──────┘   └──────┬──────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Deduplicator    │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │   Resource       │
                    │     Cache        │
                    └──────────────────┘
```

### Event Flow

1. **Command Submission**
   - AI agent submits command
   - System Guardian checks if operation allowed
   - Command Pool checks rate limit
   - Deduplicator checks for duplicate requests
   - Circuit Breaker verifies service health

2. **Execution**
   - Priority queue determines execution order
   - Resource monitoring during execution
   - Statistics collection for metrics

3. **Feedback Loop**
   - AI Metrics aggregates performance data
   - System Guardian adjusts policies
   - Circuit Breakers update states
   - Recommendations generated for AI

## Performance Characteristics

### Throughput

- **Baseline**: 100 commands/minute maximum
- **Degradation**: Automatic reduction under load
- **Recovery**: Progressive increase as load decreases

### Latency

| Percentile | Normal | High Load | Critical |
|------------|--------|-----------|----------|
| p50        | 100ms  | 500ms     | 2s       |
| p95        | 500ms  | 2s        | 5s       |
| p99        | 2s     | 5s        | 10s      |

### Resource Usage

- **Memory**: ~50-100MB baseline, up to 200MB under load
- **CPU**: <5% idle, up to 20% active
- **File Handles**: Maximum 50 concurrent

## Failure Modes and Recovery

### Circuit Breaker Recovery

```
OPEN → (60s timeout) → HALF_OPEN → (test request) → 
  Success: CLOSED
  Failure: OPEN (reset timeout)
```

### System Overload Recovery

```
CRITICAL → (load drops) → HIGH → (stabilization) → NORMAL
  - Progressive feature re-enablement
  - Queue drainage
  - Circuit reset
```

### Memory Pressure Recovery

```
High Memory → Memory Manager triggers → 
  - Cache eviction
  - Buffer cleanup
  - GC hints
  → Normal Memory
```

## Configuration and Tuning

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_MAX_CONCURRENT` | 10 | Maximum concurrent commands |
| `MCP_RATE_LIMIT` | 100 | Commands per minute |
| `MCP_QUEUE_SIZE` | 100 | Maximum queue size |
| `MCP_CIRCUIT_THRESHOLD` | 5 | Failure threshold |
| `MCP_CACHE_TTL` | 5000 | Cache TTL in ms |

### Tuning Guidelines

**For High-Throughput Scenarios:**
```javascript
{
  maxConcurrent: 20,
  rateLimit: { maxRequests: 200, windowMs: 60000 },
  queueTimeout: 60000
}
```

**For Resource-Constrained Environments:**
```javascript
{
  maxConcurrent: 5,
  rateLimit: { maxRequests: 50, windowMs: 60000 },
  queueTimeout: 15000
}
```

**For Mission-Critical Operations:**
```javascript
{
  maxConcurrent: 3,
  circuitThreshold: 2,
  cacheOnly: false,
  allowComplexCommands: false
}
```

## Monitoring and Observability

### Key Metrics to Monitor

1. **Performance Metrics**
   - Command pool utilization
   - Average execution time
   - Cache hit rate
   - Deduplication rate

2. **Reliability Metrics**
   - Success rate
   - Circuit breaker states
   - Error rate trends
   - Recovery time

3. **Resource Metrics**
   - Memory usage percentage
   - CPU load average
   - Queue depth
   - Active processes

### Health Indicators

**Healthy System:**
- Success rate > 95%
- All circuits CLOSED
- Queue depth < 10
- Memory < 60%

**Degraded System:**
- Success rate 80-95%
- Some circuits OPEN
- Queue depth 10-50
- Memory 60-80%

**Critical System:**
- Success rate < 80%
- Multiple circuits OPEN
- Queue depth > 50
- Memory > 80%

## Best Practices for AI Agents

### 1. Priority Usage

```typescript
// Critical operations
await commandPool.execute('critical-cmd', [], {}, 1);

// Normal operations
await commandPool.execute('normal-cmd', [], {}, 5);

// Background tasks
await commandPool.execute('background-task', [], {}, 10);
```

### 2. Decision Making

```typescript
const decision = aiMetrics.getDecisionSupport();

if (!decision.canExecuteCommand) {
  // System overloaded, defer
  return { deferred: true };
}

if (decision.shouldUseCache) {
  // Use cached results only
  return getCachedResult();
}

// Execute with recommended limits
await executeWithLimits({
  maxConcurrent: decision.maxConcurrent,
  timeout: decision.timeout
});
```

### 3. Error Handling

```typescript
const breaker = circuitBreakerRegistry.getBreaker('service');

try {
  await breaker.execute(async () => {
    return await riskyOperation();
  });
} catch (error) {
  if (error.message === 'Circuit breaker is OPEN') {
    // Use fallback
    return fallbackOperation();
  }
  throw error;
}
```

### 4. Monitoring Integration

```typescript
// Collect metrics periodically
setInterval(async () => {
  const metrics = await aiMetrics.collect();
  const trends = aiMetrics.getTrends();
  
  // Adjust behavior based on trends
  if (trends.performanceTrend === 'degrading') {
    reduceRequestRate();
  }
}, 30000);
```

## Security Considerations

### Input Validation

All inputs are validated through:
1. Script validator for injection prevention
2. Input validator for type safety
3. Path validation for traversal prevention

### Resource Limits

- Maximum command length: 10KB
- Maximum output buffer: 1MB
- Maximum execution time: 120s (configurable)

### Isolation

- Commands execute in separate processes
- No shared state between sessions
- Automatic cleanup of resources

## Future Enhancements

### Planned Improvements

1. **Adaptive Rate Limiting**
   - ML-based rate adjustment
   - Per-command type limits
   - Dynamic window sizing

2. **Predictive Scaling**
   - Load prediction based on patterns
   - Preemptive resource allocation
   - Intelligent queue management

3. **Enhanced Metrics**
   - Command success prediction
   - Optimal execution time windows
   - Resource usage forecasting

4. **Advanced Recovery**
   - Automatic error correction
   - Command retry strategies
   - Fallback command suggestions

## Conclusion

The AI optimization architecture provides a robust, self-healing, and adaptive system for command execution. Through intelligent resource management, failure prevention, and performance optimization, it ensures reliable operation even under challenging conditions.

The architecture is specifically designed for AI agent consumption, with no human-facing UI components, focusing entirely on programmatic interfaces and machine-readable metrics.