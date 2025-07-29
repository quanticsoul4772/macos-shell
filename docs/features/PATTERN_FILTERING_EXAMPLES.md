# Pattern-Based Filtering Examples and Use Cases

## Overview

This document provides concrete examples and use cases for the pattern-based process management filtering system in macOS Shell MCP Server.

## 1. Regex Pattern Matching Examples

### Example 1: Extract Error Codes
```typescript
// Tool usage
await filter_process_output({
  process_id: "backend-server-123",
  pattern_type: "regex",
  pattern: "ERROR\\s+(\\w+):\\s+(.+)",
  options: {
    extract_groups: true
  }
});

// Output
{
  matches: [
    {
      line: "[2025-06-01 10:23:45] ERROR DB001: Connection timeout to database",
      lineNumber: 1523,
      captureGroups: {
        "1": "DB001",
        "2": "Connection timeout to database"
      }
    },
    {
      line: "[2025-06-01 10:24:12] ERROR AUTH003: Invalid authentication token",
      lineNumber: 1547,
      captureGroups: {
        "1": "AUTH003",
        "2": "Invalid authentication token"
      }
    }
  ]
}
```

### Example 2: Extract API Response Times
```typescript
await filter_process_output({
  process_id: "api-server-456",
  pattern_type: "regex",
  pattern: "Request to (.+) completed in (\\d+)ms",
  options: {
    extract_groups: true
  }
});

// Can then analyze response times by endpoint
```

### Example 3: Find IP Addresses
```typescript
await filter_process_output({
  process_id: "nginx-789",
  pattern_type: "regex",
  pattern: "\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\b",
  options: {
    max_matches: 100
  }
});
```

## 2. Event Detection Examples

### Example 1: Monitor for Errors and Warnings
```typescript
await detect_process_events({
  process_id: "app-server-123",
  severity_filter: ["error", "warning"],
  time_window: 300 // Last 5 minutes
});

// Output
{
  events: [
    {
      eventType: "database_error",
      severity: "error",
      timestamp: "2025-06-01T10:23:45Z",
      lineNumber: 1523,
      content: "ERROR DB001: Connection timeout to database",
      context: [
        "[2025-06-01 10:23:44] Attempting database connection...",
        "[2025-06-01 10:23:45] ERROR DB001: Connection timeout to database",
        "[2025-06-01 10:23:45] Retrying connection in 5 seconds..."
      ]
    }
  ],
  summary: {
    total: 15,
    byType: {
      "database_error": 3,
      "auth_error": 2,
      "warning": 10
    }
  }
}
```

### Example 2: Custom Event Patterns
```typescript
await detect_process_events({
  process_id: "payment-service-789",
  custom_patterns: [
    {
      name: "payment_failed",
      patterns: ["Payment failed", "Transaction declined", "Insufficient funds"],
      severity: "error",
      contextLines: 5
    },
    {
      name: "payment_success",
      patterns: ["Payment successful", "Transaction approved"],
      severity: "info",
      contextLines: 3
    }
  ]
});
```

### Example 3: State Change Detection
```typescript
await detect_process_events({
  process_id: "microservice-cluster",
  event_types: ["state_change"],
  custom_patterns: [
    {
      name: "service_state",
      patterns: [
        "Service (\\w+) started",
        "Service (\\w+) stopped",
        "Service (\\w+) health check failed"
      ],
      severity: "info",
      contextLines: 2
    }
  ]
});
```

## 3. Time Pattern Analysis Examples

### Example 1: Detect Output Bursts
```typescript
await analyze_output_patterns({
  process_id: "log-processor-123",
  analysis_type: "bursts",
  window_size: 60 // 1-minute windows
});

// Output
{
  analysis: {
    averageFrequency: 2.5, // lines per second
    bursts: [
      {
        start: "2025-06-01T10:23:00Z",
        end: "2025-06-01T10:23:15Z",
        linesPerSecond: 45.2,
        totalLines: 678
      },
      {
        start: "2025-06-01T10:45:30Z",
        end: "2025-06-01T10:45:45Z",
        linesPerSecond: 38.7,
        totalLines: 580
      }
    ],
    possibleCause: "Batch processing or high load periods"
  }
}
```

### Example 2: Find Periodic Patterns
```typescript
await analyze_output_patterns({
  process_id: "cron-service-456",
  analysis_type: "periodic",
  min_pattern_length: 5 // At least 5 occurrences
});

// Output
{
  periodicPatterns: [
    {
      pattern: "Health check completed",
      period: 60, // seconds
      occurrences: 142,
      confidence: 0.98
    },
    {
      pattern: "Syncing with remote server",
      period: 300, // 5 minutes
      occurrences: 28,
      confidence: 0.95
    }
  ]
}
```

### Example 3: Quiet Period Detection
```typescript
await analyze_output_patterns({
  process_id: "batch-processor-789",
  analysis_type: "all",
  window_size: 300 // 5-minute windows
});

// Identifies when process might be stuck or idle
```

## 4. Structured Data Parsing Examples

### Example 1: Parse JSON Logs
```typescript
await parse_structured_output({
  process_id: "api-server-123",
  format: { type: "json" },
  query: "$.level == 'error' && $.response_time > 1000",
  output_format: "table"
});

// Output (as table)
/*
| timestamp           | level | endpoint      | response_time | error_code |
|-------------------|-------|---------------|---------------|------------|
| 2025-06-01 10:23:45 | error | /api/users    | 1523         | TIMEOUT    |
| 2025-06-01 10:24:12 | error | /api/products | 2145         | DB_ERROR   |
*/
```

### Example 2: Parse CSV Output
```typescript
await parse_structured_output({
  process_id: "data-export-456",
  format: { type: "csv" },
  field_filters: {
    "status": "failed",
    "size": { "$gt": 1000000 } // Files larger than 1MB
  },
  output_format: "json"
});
```

### Example 3: Parse Custom Format
```typescript
await parse_structured_output({
  process_id: "legacy-app-789",
  format: {
    type: "custom",
    customDelimiter: "|",
    fieldMappings: {
      "timestamp": 0,
      "level": 1,
      "module": 2,
      "message": 3
    }
  },
  field_filters: {
    "module": "authentication"
  }
});
```

## 5. Process Monitoring Examples

### Example 1: Create Error Monitor
```typescript
await create_output_monitor({
  process_id: "production-api",
  monitor_name: "error-alerting",
  monitor_config: {
    patterns: [
      {
        type: "regex",
        pattern: "ERROR|CRITICAL|FATAL",
        action: "alert"
      }
    ],
    events: [
      {
        name: "high_error_rate",
        patterns: ["ERROR"],
        severity: "error",
        contextLines: 10
      }
    ],
    time_patterns: [
      {
        windowSize: 60,
        maxFrequency: 10, // More than 10 errors per minute
        detectBursts: true,
        detectQuiet: false
      }
    ],
    actions: [
      {
        type: "webhook",
        url: "https://alerts.example.com/webhook",
        condition: "high_error_rate"
      },
      {
        type: "log",
        file: "/var/log/process-errors.log",
        condition: "any_match"
      }
    ]
  }
});
```

### Example 2: Performance Monitor
```typescript
await create_output_monitor({
  process_id: "database-server",
  monitor_name: "performance-tracking",
  monitor_config: {
    patterns: [
      {
        type: "regex",
        pattern: "Query took (\\d+)ms",
        extractValue: true
      }
    ],
    time_patterns: [
      {
        windowSize: 300, // 5 minutes
        detectBursts: true,
        detectQuiet: true
      }
    ],
    actions: [
      {
        type: "metrics",
        metricName: "query_duration",
        aggregation: "avg"
      }
    ]
  }
});
```

## 6. Combined Pattern Examples

### Example 1: Debug Slow API Endpoints
```typescript
// Step 1: Find slow requests
const slowRequests = await filter_process_output({
  process_id: "api-server",
  pattern_type: "regex",
  pattern: "Request to (.+) completed in (\\d{4,})ms", // 1000ms+
  options: { extract_groups: true }
});

// Step 2: Analyze timing patterns
const patterns = await analyze_output_patterns({
  process_id: "api-server",
  analysis_type: "bursts",
  window_size: 300
});

// Step 3: Check for correlated errors
const events = await detect_process_events({
  process_id: "api-server",
  time_window: 300,
  severity_filter: ["error"]
});

// Combine results to identify problematic endpoints
```

### Example 2: Monitor Microservice Health
```typescript
// Create a monitor
await create_output_monitor({
  process_id: "microservice-mesh",
  monitor_name: "health-monitor",
  monitor_config: {
    patterns: [
      // Circuit breaker patterns
      { type: "text", pattern: "Circuit breaker opened" },
      // Retry patterns
      { type: "regex", pattern: "Retry attempt (\\d+) of (\\d+)" },
      // Health check patterns
      { type: "text", pattern: "Health check failed" }
    ],
    events: [
      {
        name: "service_degraded",
        patterns: ["Circuit breaker", "Health check failed", "Timeout"],
        severity: "warning",
        contextLines: 20
      }
    ],
    time_patterns: [
      {
        windowSize: 60,
        minFrequency: 1, // At least 1 health check per minute
        detectQuiet: true // Alert if no health checks
      }
    ]
  }
});
```

### Example 3: Database Query Analysis
```typescript
// Parse structured query logs
const queries = await parse_structured_output({
  process_id: "postgres-server",
  format: { type: "json" },
  query: "$.duration > 100", // Queries over 100ms
  output_format: "json"
});

// Analyze query patterns
const analysis = await analyze_output_patterns({
  process_id: "postgres-server",
  analysis_type: "all"
});

// Detect problematic queries
const problems = await detect_process_events({
  process_id: "postgres-server",
  custom_patterns: [
    {
      name: "slow_query",
      patterns: ["duration: [1-9]\\d{3,}"], // 1000ms+
      severity: "warning",
      contextLines: 5
    },
    {
      name: "deadlock",
      patterns: ["deadlock detected"],
      severity: "error",
      contextLines: 20
    }
  ]
});
```

## 7. Real-World Scenarios

### Scenario 1: Production Debugging
A production API is experiencing intermittent slowdowns. Use pattern filtering to:

1. Identify slow endpoints using regex patterns
2. Correlate with error events
3. Analyze timing patterns for periodicity
4. Monitor for specific error signatures

### Scenario 2: Log Analysis
Process large log files efficiently:

1. Extract structured data from mixed format logs
2. Filter by severity and component
3. Identify error clusters
4. Generate summary reports

### Scenario 3: Performance Monitoring
Track application performance metrics:

1. Extract response times from logs
2. Calculate percentiles and averages
3. Detect performance degradation
4. Alert on SLA violations

### Scenario 4: Security Monitoring
Monitor for security events:

1. Detect authentication failures
2. Track IP addresses and patterns
3. Identify suspicious activity bursts
4. Generate security audit logs

## Implementation Tips

### 1. Pattern Performance
- Cache compiled regex patterns
- Use simple text search when possible
- Limit regex complexity with timeouts

### 2. Memory Management
- Process in chunks for large outputs
- Implement sliding windows for time analysis
- Clean up old monitor data periodically

### 3. Error Handling
- Validate patterns before use
- Provide clear error messages
- Fall back gracefully on failures

### 4. Best Practices
- Start with simple patterns, refine as needed
- Use context lines to understand matches
- Combine multiple pattern types for insights
- Monitor pattern performance impact

## Conclusion

These examples demonstrate the power and flexibility of pattern-based process filtering. By combining different pattern types and analysis tools, users can gain deep insights into process behavior, detect issues early, and automate monitoring workflows.