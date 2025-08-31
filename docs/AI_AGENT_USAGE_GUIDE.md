# AI Agent Usage Guide

## Overview

This guide provides practical examples and patterns for AI agents using the macOS Shell MCP Server's performance optimization features. All examples are designed for programmatic consumption without any UI components.

## Quick Start

### Basic Command Execution

```typescript
// Simple command with automatic optimization
const result = await commandPool.execute('ls', ['-la', '/tmp']);
console.log(result.stdout);
```

### Priority-Based Execution

```typescript
// Critical system command (priority 1)
await commandPool.execute('kill', ['-9', processId], {}, 1);

// Normal operation (priority 5)
await commandPool.execute('git', ['status'], {}, 5);

// Background maintenance (priority 10)
await commandPool.execute('find', ['/tmp', '-mtime', '+7', '-delete'], {}, 10);
```

## Common Patterns

### 1. Health Check Before Operations

```typescript
async function executeWithHealthCheck(command: string, args: string[]) {
  // Check system health
  const status = systemGuardian.getAIStatus();
  
  if (!status.canExecute) {
    console.log('System overloaded:', status.recommendations[0]);
    return { deferred: true, reason: status.recommendations[0] };
  }
  
  // Check for circuit breaker
  const breaker = circuitBreakerRegistry.getBreaker('shell-commands');
  
  try {
    return await breaker.execute(async () => {
      return await commandPool.execute(command, args);
    });
  } catch (error) {
    if (error.message.includes('Circuit breaker is OPEN')) {
      return { error: 'Service temporarily unavailable', retry_after: 60 };
    }
    throw error;
  }
}
```

### 2. Batch Operations with Deduplication

```typescript
async function processBatchWithDedup(files: string[]) {
  const deduplicator = new RequestDeduplicator({ ttl: 5000 });
  
  // Process files, deduplicating identical operations
  const results = await Promise.all(
    files.map(file => 
      deduplicator.execute(
        () => commandPool.execute('stat', [file], {}, 5),
        'stat',
        file
      )
    )
  );
  
  return results;
}

// Example: Many requests for same file will share execution
const files = ['file1.txt', 'file2.txt', 'file1.txt', 'file1.txt'];
const results = await processBatchWithDedup(files);
// Only 2 stat commands executed, not 4
```

### 3. Adaptive Rate Control

```typescript
class AdaptiveExecutor {
  private baseDelay = 100;
  private currentDelay = 100;
  
  async executeWithAdaptiveRate(commands: Array<[string, string[]]>) {
    const results = [];
    
    for (const [cmd, args] of commands) {
      // Check metrics and adjust rate
      const metrics = await aiMetrics.collect();
      const decision = aiMetrics.getDecisionSupport();
      
      if (decision.shouldDefer) {
        this.currentDelay = Math.min(this.currentDelay * 2, 5000);
        await this.delay(this.currentDelay);
      } else if (metrics.performance.averageWaitTime < 100) {
        this.currentDelay = Math.max(this.currentDelay * 0.9, this.baseDelay);
      }
      
      try {
        const result = await commandPool.execute(cmd, args);
        results.push(result);
      } catch (error) {
        if (error.message.includes('Rate limit exceeded')) {
          await this.delay(1000);
          // Retry once after delay
          const result = await commandPool.execute(cmd, args);
          results.push(result);
        } else {
          throw error;
        }
      }
      
      await this.delay(this.currentDelay);
    }
    
    return results;
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 4. Intelligent Fallback Strategy

```typescript
class IntelligentExecutor {
  async executeWithFallback(
    primary: () => Promise<any>,
    fallbacks: Array<() => Promise<any>>
  ) {
    // Try primary operation
    const primaryBreaker = circuitBreakerRegistry.getBreaker('primary');
    
    try {
      return await primaryBreaker.execute(primary);
    } catch (primaryError) {
      console.log('Primary failed:', primaryError.message);
      
      // Try fallbacks in order
      for (let i = 0; i < fallbacks.length; i++) {
        const fallbackBreaker = circuitBreakerRegistry.getBreaker(`fallback-${i}`);
        
        try {
          const result = await fallbackBreaker.execute(fallbacks[i]);
          console.log(`Fallback ${i} succeeded`);
          return result;
        } catch (fallbackError) {
          console.log(`Fallback ${i} failed:`, fallbackError.message);
          continue;
        }
      }
      
      throw new Error('All strategies failed');
    }
  }
}

// Usage
const executor = new IntelligentExecutor();
const result = await executor.executeWithFallback(
  // Primary: Get latest data
  async () => await commandPool.execute('curl', ['https://api.example.com/data']),
  [
    // Fallback 1: Try mirror
    async () => await commandPool.execute('curl', ['https://mirror.example.com/data']),
    // Fallback 2: Use cached data
    async () => await commandPool.execute('cat', ['/tmp/cached_data.json']),
    // Fallback 3: Return default
    async () => ({ data: 'default', cached: true })
  ]
);
```

### 5. Load-Aware Execution

```typescript
class LoadAwareAgent {
  async executeBatch(tasks: Array<{ command: string; args: string[]; weight: number }>) {
    const results = [];
    
    for (const task of tasks) {
      // Get current system state
      const state = await systemGuardian.getSystemState();
      const policy = systemGuardian.getCurrentPolicy();
      
      // Adjust based on load
      let priority = 5;
      let shouldExecute = true;
      
      switch (state.load) {
        case 'LOW':
          priority = Math.max(1, 5 - task.weight); // Boost priority
          break;
        case 'NORMAL':
          priority = 5;
          break;
        case 'HIGH':
          priority = Math.min(10, 5 + task.weight); // Lower priority
          if (task.weight > 3) {
            shouldExecute = false; // Defer heavy tasks
          }
          break;
        case 'CRITICAL':
          shouldExecute = task.weight <= 1; // Only critical tasks
          priority = 10;
          break;
      }
      
      if (!shouldExecute) {
        results.push({
          command: task.command,
          deferred: true,
          reason: `Load too high (${state.load}) for weight ${task.weight} task`
        });
        continue;
      }
      
      try {
        const result = await commandPool.execute(
          task.command,
          task.args,
          { timeout: policy.commandTimeout },
          priority
        );
        results.push(result);
      } catch (error) {
        results.push({
          command: task.command,
          error: error.message
        });
      }
      
      // Dynamic delay based on load
      const delay = state.load === 'CRITICAL' ? 2000 :
                   state.load === 'HIGH' ? 1000 :
                   state.load === 'NORMAL' ? 500 : 100;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    return results;
  }
}
```

## Advanced Scenarios

### Scenario 1: Large File Processing

```typescript
async function processLargeFiles(files: string[]) {
  const BATCH_SIZE = 5;
  const results = [];
  
  // Check if we should use cache-only mode
  const decision = aiMetrics.getDecisionSupport();
  if (decision.shouldUseCache) {
    console.log('System under pressure, using cached results only');
    return getCachedResults(files);
  }
  
  // Process in batches to avoid overwhelming the system
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    
    // Check system state before each batch
    const guardian = systemGuardian.getAIStatus();
    if (!guardian.canExecute) {
      console.log('Pausing batch processing:', guardian.recommendations[0]);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Process batch with appropriate priority
    const batchResults = await Promise.all(
      batch.map(file => 
        commandPool.execute(
          'gzip',
          ['-9', file],
          { timeout: 60000 },
          7 // Lower priority for batch operations
        ).catch(error => ({
          file,
          error: error.message
        }))
      )
    );
    
    results.push(...batchResults);
    
    // Adaptive delay between batches
    const metrics = await aiMetrics.collect();
    const delay = metrics.resources.cpuLoad > 80 ? 3000 :
                 metrics.resources.cpuLoad > 60 ? 2000 :
                 metrics.resources.cpuLoad > 40 ? 1000 : 500;
    
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  return results;
}
```

### Scenario 2: Continuous Monitoring

```typescript
class ContinuousMonitor {
  private isRunning = false;
  private interval = 5000; // Base interval
  
  async startMonitoring(target: string) {
    this.isRunning = true;
    
    while (this.isRunning) {
      try {
        // Use circuit breaker for monitoring
        const breaker = circuitBreakerRegistry.getBreaker('monitor');
        
        const result = await breaker.execute(async () => {
          return await commandPool.execute(
            'ps',
            ['aux', '|', 'grep', target],
            { shell: true },
            8 // Low priority for monitoring
          );
        });
        
        // Process monitoring result
        this.processMonitoringData(result);
        
        // Adjust interval based on system load
        const state = await systemGuardian.getSystemState();
        this.interval = state.load === 'CRITICAL' ? 30000 :
                       state.load === 'HIGH' ? 15000 :
                       state.load === 'NORMAL' ? 5000 : 3000;
        
      } catch (error) {
        console.error('Monitoring error:', error);
        
        // If circuit is open, increase interval significantly
        if (error.message.includes('Circuit breaker is OPEN')) {
          this.interval = 60000; // Back off to 1 minute
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, this.interval));
    }
  }
  
  private processMonitoringData(result: any) {
    // Process the monitoring data
    console.log('Monitor update:', new Date().toISOString());
  }
  
  stopMonitoring() {
    this.isRunning = false;
  }
}
```

### Scenario 3: Multi-Stage Pipeline

```typescript
class MultiStagePipeline {
  async executePipeline(input: string) {
    const stages = [
      { name: 'download', weight: 3 },
      { name: 'extract', weight: 2 },
      { name: 'process', weight: 4 },
      { name: 'compress', weight: 3 },
      { name: 'upload', weight: 2 }
    ];
    
    const results = {};
    let previousOutput = input;
    
    for (const stage of stages) {
      // Check if we can proceed with this stage
      const decision = aiMetrics.getDecisionSupport();
      
      if (decision.shouldDefer && stage.weight > 2) {
        console.log(`Deferring ${stage.name} due to high load`);
        await new Promise(resolve => setTimeout(resolve, decision.timeout));
      }
      
      // Create stage-specific circuit breaker
      const breaker = circuitBreakerRegistry.getBreaker(`pipeline-${stage.name}`);
      
      try {
        const stageResult = await breaker.execute(async () => {
          return await this.executeStage(stage.name, previousOutput, stage.weight);
        });
        
        results[stage.name] = {
          success: true,
          output: stageResult
        };
        previousOutput = stageResult;
        
      } catch (error) {
        // Try recovery strategy
        const recovery = await this.attemptRecovery(stage.name, error);
        
        if (recovery.success) {
          results[stage.name] = recovery;
          previousOutput = recovery.output;
        } else {
          // Pipeline failed at this stage
          results[stage.name] = {
            success: false,
            error: error.message
          };
          break;
        }
      }
      
      // Inter-stage delay based on system metrics
      const metrics = await aiMetrics.collect();
      const delay = Math.max(100, stage.weight * 200 * (1 + metrics.resources.cpuLoad / 100));
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    return results;
  }
  
  private async executeStage(name: string, input: string, weight: number) {
    // Stage-specific implementation
    const priority = Math.max(1, Math.min(10, 6 - weight));
    
    switch (name) {
      case 'download':
        return await commandPool.execute('wget', [input, '-O', '/tmp/download'], {}, priority);
      case 'extract':
        return await commandPool.execute('tar', ['-xzf', input], {}, priority);
      case 'process':
        return await commandPool.execute('python', ['process.py', input], {}, priority);
      case 'compress':
        return await commandPool.execute('gzip', ['-9', input], {}, priority);
      case 'upload':
        return await commandPool.execute('aws', ['s3', 'cp', input, 's3://bucket/'], {}, priority);
      default:
        throw new Error(`Unknown stage: ${name}`);
    }
  }
  
  private async attemptRecovery(stage: string, error: Error) {
    // Implement stage-specific recovery
    console.log(`Attempting recovery for ${stage}:`, error.message);
    
    // Simple retry with backoff
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      const result = await this.executeStage(stage, '', 1); // High priority retry
      return { success: true, output: result };
    } catch (retryError) {
      return { success: false, error: retryError.message };
    }
  }
}
```

## Monitoring and Metrics

### Real-time Metrics Collection

```typescript
class MetricsCollector {
  private metricsInterval?: NodeJS.Timeout;
  
  startCollection(intervalMs = 30000) {
    this.metricsInterval = setInterval(async () => {
      const metrics = await aiMetrics.collect();
      const trends = aiMetrics.getTrends();
      
      // Log key metrics
      console.log('=== System Metrics ===');
      console.log(`Success Rate: ${(metrics.reliability.successRate * 100).toFixed(2)}%`);
      console.log(`Cache Hit Rate: ${(metrics.performance.cacheHitRate * 100).toFixed(2)}%`);
      console.log(`System Load: ${metrics.resources.systemLoad}`);
      console.log(`Queue Depth: ${metrics.resources.queueDepth}`);
      
      // Log trends
      console.log('=== Trends ===');
      console.log(`Performance: ${trends.performanceTrend}`);
      console.log(`Reliability: ${trends.reliabilityTrend}`);
      console.log(`Resources: ${trends.resourceTrend}`);
      
      // Log recommendations
      if (metrics.recommendations.length > 0) {
        console.log('=== Recommendations ===');
        metrics.recommendations.forEach(rec => console.log(`- ${rec}`));
      }
      
      // Take action based on trends
      if (trends.performanceTrend === 'degrading') {
        console.log('ACTION: Reducing request rate due to degrading performance');
        // Implement rate reduction logic
      }
      
      if (trends.reliabilityTrend === 'degrading') {
        console.log('ACTION: Increasing retry attempts due to degrading reliability');
        // Implement retry logic adjustment
      }
      
    }, intervalMs);
  }
  
  stopCollection() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = undefined;
    }
  }
}
```

### System Health Dashboard (Text-based for AI)

```typescript
async function getSystemHealthReport(): Promise<string> {
  const metrics = await aiMetrics.collect();
  const systemState = await systemGuardian.getSystemState();
  const poolStats = commandPool.getStats();
  const decision = aiMetrics.getDecisionSupport();
  
  const report = `
SYSTEM HEALTH REPORT - ${new Date().toISOString()}
================================================

OPERATIONAL STATUS: ${decision.canExecuteCommand ? 'READY' : 'DEGRADED'}
SYSTEM LOAD: ${systemState.load}

PERFORMANCE METRICS:
  Command Pool: ${(metrics.performance.commandPoolUtilization * 100).toFixed(1)}% utilized
  Avg Execution: ${metrics.performance.averageExecutionTime.toFixed(0)}ms
  Avg Wait Time: ${metrics.performance.averageWaitTime.toFixed(0)}ms
  Cache Hit Rate: ${(metrics.performance.cacheHitRate * 100).toFixed(1)}%

RELIABILITY METRICS:
  Success Rate: ${(metrics.reliability.successRate * 100).toFixed(1)}%
  Error Rate: ${(metrics.reliability.errorRate * 100).toFixed(1)}%
  Recovery Rate: ${(metrics.reliability.recoveryRate * 100).toFixed(1)}%

RESOURCE USAGE:
  CPU Load: ${metrics.resources.cpuLoad.toFixed(1)}%
  Memory: ${metrics.resources.memoryUsagePercent.toFixed(1)}%
  Queue Depth: ${metrics.resources.queueDepth}
  Active Commands: ${poolStats.active}

CIRCUIT BREAKERS:
${Object.entries(metrics.reliability.circuitBreakerStates)
  .map(([name, state]) => `  ${name}: ${state}`)
  .join('\n')}

RECOMMENDATIONS:
${metrics.recommendations.map(r => `  - ${r}`).join('\n') || '  None'}

DECISION SUPPORT:
  Can Execute: ${decision.canExecuteCommand}
  Should Use Cache: ${decision.shouldUseCache}
  Should Defer: ${decision.shouldDefer}
  Max Concurrent: ${decision.maxConcurrent}
  Timeout: ${decision.timeout}ms
================================================
`;
  
  return report;
}

// Usage
const report = await getSystemHealthReport();
console.log(report);
```

## Error Handling Patterns

### Comprehensive Error Recovery

```typescript
class ErrorRecoveryAgent {
  private errorHandler = new ErrorHandler({
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2
  });
  
  async executeWithRecovery(command: string, args: string[]) {
    try {
      // Try with circuit breaker first
      const breaker = circuitBreakerRegistry.getBreaker('main');
      return await breaker.execute(async () => {
        return await commandPool.execute(command, args);
      });
      
    } catch (error) {
      // Classify the error
      const classification = this.errorHandler.classifyError(error);
      
      if (classification.retryable) {
        // Attempt retry with exponential backoff
        try {
          return await this.errorHandler.withRetry(
            async () => await commandPool.execute(command, args),
            { maxAttempts: 5 }
          );
        } catch (retryError) {
          // All retries failed, try alternative approach
          return await this.tryAlternativeApproach(command, args, retryError);
        }
      } else {
        // Non-retryable error, handle accordingly
        return await this.handleNonRetryableError(command, args, error);
      }
    }
  }
  
  private async tryAlternativeApproach(command: string, args: string[], error: Error) {
    // Implement command-specific alternatives
    console.log(`Primary approach failed, trying alternative for ${command}`);
    
    // Example alternatives
    const alternatives: Record<string, () => Promise<any>> = {
      'curl': async () => await commandPool.execute('wget', args),
      'gzip': async () => await commandPool.execute('compress', args),
      'python': async () => await commandPool.execute('python3', args),
    };
    
    const alternative = alternatives[command];
    if (alternative) {
      return await alternative();
    }
    
    throw error; // No alternative available
  }
  
  private async handleNonRetryableError(command: string, args: string[], error: Error) {
    // Log the error
    console.error(`Non-retryable error for ${command}:`, error.message);
    
    // Return error response
    return {
      success: false,
      error: error.message,
      command,
      args,
      timestamp: new Date().toISOString(),
      suggestion: 'Check command syntax and permissions'
    };
  }
}
```

## Best Practices Summary

### DO's

1. **Use Priority Levels**: Always specify appropriate priority for commands
2. **Check System Health**: Verify system state before heavy operations
3. **Implement Fallbacks**: Use circuit breakers with fallback strategies
4. **Monitor Metrics**: Regularly check and respond to system metrics
5. **Handle Rate Limits**: Implement backoff when rate limited
6. **Batch Operations**: Process large sets in manageable batches
7. **Use Deduplication**: Prevent duplicate operations within time windows
8. **Adaptive Behavior**: Adjust behavior based on system load

### DON'Ts

1. **Don't Ignore Circuit States**: Never bypass open circuit breakers
2. **Don't Flood the System**: Respect rate limits and queue sizes
3. **Don't Ignore Recommendations**: Act on system recommendations
4. **Don't Use Fixed Delays**: Use adaptive delays based on load
5. **Don't Ignore Errors**: Implement proper error recovery
6. **Don't Skip Health Checks**: Always verify system can handle operations
7. **Don't Use High Priority for Everything**: Reserve for truly critical operations

## Debugging Tips

### Enable Debug Logging

```typescript
// Set environment variable
process.env.MCP_DEBUG = 'true';
process.env.MCP_LOG_FILE = '/tmp/mcp-debug.log';

// Or programmatically
import { getLogger } from './utils/logger.js';
const logger = getLogger('my-agent');
logger.setLevel('debug');
```

### Monitor Circuit Breaker States

```typescript
// Check all circuit breakers
const breakers = circuitBreakerRegistry.getAllBreakers();
for (const [name, breaker] of breakers) {
  console.log(`${name}: ${breaker.getState()}`);
  const metrics = breaker.getMetrics();
  console.log(`  Successes: ${metrics.successes}, Failures: ${metrics.failures}`);
}
```

### Track Command Pool Statistics

```typescript
// Monitor pool statistics
setInterval(() => {
  const stats = commandPool.getStats();
  console.log('Command Pool Stats:', JSON.stringify(stats, null, 2));
}, 10000);
```

## Conclusion

This guide provides comprehensive patterns for AI agents to effectively use the macOS Shell MCP Server's optimization features. By following these patterns and best practices, AI agents can achieve reliable, efficient, and adaptive command execution even under challenging system conditions.