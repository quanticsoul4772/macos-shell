# Changelog

All notable changes to the macOS Shell MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.0] - 2025-01-06

### Added
- **Cache System** - 4-phase caching system
  - 5 new cache management MCP tools
  - Duplicate detection
  - Persistent learning storage (~/.mcp-cache-rules.json)
  - Output analysis for dynamic content detection
  - Pattern detection for timestamps, PIDs, counters, file sizes, IPs
- **Cache Management Tools**:
  - `cache_stats` - View cache statistics and performance
  - `cache_clear_command` - Clear specific commands
  - `cache_clear_pattern` - Clear by regex pattern
  - `cache_mark_never` - Mark commands to never cache
  - `cache_explain` - Explain cache decisions

### Changed
- Reduced buffer sizes from 10,000 to 300 lines for AI-optimized memory usage
- 97% memory reduction (1.6MB to 48KB per session)
- Added AI_BUFFER_SIZE constant in session-types.ts
- Updated tool count from 30 to 35 (added 5 cache management tools)

### Technical Details
- AI processes output immediately, doesn't need large scrollback
- 300 lines sufficient for command responses and error searching
- Cache system prevents stale data while improving performance
- Detection of dynamic vs static content

## [3.1.1] - 2025-01-06

### Fixed
- **Command Caching**: Fixed issue where status commands were being cached
  - Status commands like `git status`, `ls`, `docker ps` are now NEVER cached
  - Implemented cache classification system
  - Variable TTLs based on command type (never, 30s, 5m, 30m, 1h)
  - Added `MCP_DISABLE_CACHE=true` environment variable to disable caching

### Added
- `ai-cache-classifier.ts` - Classification of commands for caching decisions
- Cache strategy information in command responses (`cacheStrategy` field)
- `explainCache()` method to understand caching decisions
- Test scripts to verify caching behavior

### Changed
- Cache now respects command purpose - status commands get fresh data
- Updated AI cache to use classification system instead of blanket 30-minute cache
- Command result includes cache strategy information

### Technical Details
- Added rules for command classification
- Cache classifier uses regex patterns to identify command types
- Status/monitoring commands bypass cache
- Configuration files get medium caching (5 minutes)
- Static content like help text gets long caching (1 hour)

## [3.1.0] - 2025-06-08

### Added
- **Process Resource Monitoring**: CPU and memory tracking for background processes
  - Resource sampling for running processes
  - CPU percentage, memory usage (MB), and memory percentage tracking
  - 5-second sampling intervals
  - Data structure focused on current values
  - Resource data included in `list_processes` JSON output
- **Batched PS Execution**: Reduced monitoring overhead
  - Single `ps` command for all processes instead of individual calls
  - Batch sampling every 5 seconds for updates
  - Handling of up to 100 concurrent processes
- **Circuit Breaker Pattern**: Error handling for system commands
  - Failure detection after 3 consecutive errors
  - Exponential backoff (1s, 2s, 4s) before retries
  - 30-second recovery timeout for circuit reset
  - Degradation when ps command fails
- **Process API**: Resource data in responses
  ```json
  {
    "resources": {
      "cpu": 45.2,
      "memory": 1024,
      "memoryPercent": 12.5,
      "lastSampled": "2024-01-15T10:30:45.123Z",
      "sampleCount": 8,
      "samplingInterval": 5000
    }
  }
  ```

### Changed
- **BREAKING**: `list_processes` now returns JSON format instead of text
  - Structured data with nested resource information
  - Includes process metadata and resource monitoring status
  - For AI parsing and decision making
- Process monitoring starts when background process launches
- Monitoring stops and cleans up when process terminates

### Technical Details
- New `resource-monitor.ts` module with ResourceMonitor and CircuitBreaker classes
- Updated `BackgroundProcess` interface to include optional resources
- Modified `session-manager.ts` to integrate resource monitoring lifecycle
- `process-tools.ts` exposes resource data in structured format
- No test files - AI validates through usage
- No sample history storage - only current values tracked
- Cleanup of resource data 5 seconds after process termination

### For AI Usage
- Removed trend analysis - AI only needs current values
- Fixed 5-second intervals
- Removed statistics and aggregation methods
- Data: CPU%, memory MB, sample count

### Performance
- Overhead: <1% CPU for monitoring 50 processes
- Memory: <2MB for tracking 100 processes (no sample history)
- Sampling efficiency: One ps execution per interval regardless of process count

## [3.0.0] - 2025-06-08

### Added
- **AI-Specific Command Caching**: LRU cache with performance improvement
  - Caches command results with 30-60 minute TTLs
  - Pattern recognition learns AI command sequences
  - Pre-caches predicted next commands
  - Returns cached results in 1ms vs 100-140ms original
- **Command Deduplication**: Prevents redundant executions
  - 10-second deduplication window for rapid commands
  - Reduction in duplicate command executions
  - Command normalization (e.g., `ls -la` = `ls -al`)
  - Batching support for high-frequency commands
- **Error Recovery**: Success rate tracking
  - Auto-corrects file path typos using Levenshtein distance
  - Retries network errors with exponential backoff
  - Adds corrective flags (e.g., `--legacy-peer-deps` for npm)
  - Suggests command alternatives (e.g., python → python3)
- **Performance Monitoring**: Optimization stats
  - Logs cache hit rate, dedup rate, error recovery to stderr
  - Shows command patterns every minute
  - Zero configuration - active by default

### Changed
- Major version bump to 3.0.0 for AI-specific optimizations
- `run_command` now integrates AI optimizations
- Cache hit responses include `"cached": true` indicator
- Error messages logged to stderr

### Technical Details
- Added 5 new AI optimization modules (ai-cache, ai-dedup, ai-error-handler, ai-integration, ai-monitor)
- Modified command-tools.ts to use AI optimizations in execution flow
- Uses LRU cache with 10,000 entry capacity
- Pattern matching for command sequence prediction
- No configuration needed - optimizations active by default

## [2.8.0] - 2025-06-07

### Added
- **AI-Optimized Output**: All command tools return structured JSON instead of formatted text
- **Preflight Validation**: New `preflight_check` tool validates commands, paths, ports, and env vars in one call
- **System Profile**: New `system_profile` tool gathers system information
- **Batch Execution**: New `batch_execute_enhanced` tool with:
  - Conditional command execution based on previous results
  - Retry logic with configurable attempts and delays
  - Skip commands when conditions aren't met
  - Support for regex pattern matching in conditions
- **AI-Optimized SSH**: Interactive SSH tools include:
  - ANSI code stripping
  - Built-in output search (text/regex)
  - SSH key authentication support
  - Removed human-centric features (profiles, names, tags)

### Changed
- `run_command` and `run_script` return structured JSON with `{stdout, stderr, exitCode, success, duration, command}`
- Non-zero exit codes no longer throw exceptions (`reject: false` added to execa calls)
- All output for machine parsing rather than human readability
- Consolidated AI optimization documentation into single file

### Technical Details
- Added `EnhancedBatchExecutor` utility for conditional command chaining
- Added `preflight-tools.ts` module with validation and system profiling
- Modified command output format for AI consumption
- Focus on structured data and execution

## [2.7.0] - 2025-06-06

### Added
- **Memory Optimization**: LRU cache for pattern compilation (100 pattern limit)
- **Debounced Session Persistence**: 5-second delay reduces I/O by 95%
- **Circular Buffer**: Cleanup of orphaned promises
- **Batch Execution**: New `batch_execute` tool for multi-command execution
- **Pattern-Based Process Killing**: New `kill_all_matching` tool with glob/regex support
- **Process Output Saving**: New `save_process_output` tool to persist logs
- **System Health Monitoring**: New `get_system_health` tool for memory and process stats
- **Shutdown**: Cleanup on SIGTERM/SIGINT with session save flushing

### Changed
- Session saves now debounced instead of immediate (5-second delay)
- CircularBuffer replaced with EnhancedCircularBuffer for memory safety
- Error responses with structured error codes for AI consumption

### Fixed
- Memory leak in pattern matcher (unbounded cache growth)
- Memory leak in CircularBuffer waiters (orphaned promises)
- I/O from session persistence on every command

### Technical Details
- Added utility modules: LRUCache, Debouncer, EnhancedCircularBuffer, BatchExecutor
- AI-specific optimizations (batch operations, structured output)
- All optimizations maintain backward compatibility

## [2.6.0] - 2025-06-01

### Fixed
- **Visual indicator alignment bug**: Fixed >>> markers appearing on wrong lines when using `invert_match` with `show_context`
  - Markers now indicate lines that match the search pattern
  - Separated actualMatchedLineNumbers (for markers) from matchedLineNumbers (for filtering)
  - Clarity when using inverted searches with context
- **Regex search bug**: Fixed issue where regex searches with 'g' flag only matched every other line
  - Removed global flag from regex creation (changed from 'g'/'gi' to ''/'i')
  - JavaScript's regex.test() was maintaining state between calls, causing skipped matches
  - All matching lines are found in regex searches

### Changed
- Visual output formatting for search results with context
- Updated regex flag display to show empty string

### Technical Details
- Line 1379: Uses actualMatchedLineNumbers.has(line.lineNumber) for marker placement
- Line 1276: Changed regex flags from `case_sensitive ? 'g' : 'gi'` to `case_sensitive ? '' : 'i'`
- Line 1280: Updated searchInfo display to handle empty regex flags

## [2.5.2] - 2025-06-01

### Fixed
- **Bug fix**: Server no longer crashes when killing background processes
  - Added error handling for process termination signals (SIGTERM/SIGKILL)
  - Prevents unhandled promise rejection when background processes are killed
  - Distinguishes between expected terminations and unexpected errors
  - Fixes crash that occurred with commands like `while true; do echo 'test'; done`

## [2.5.1] - 2025-06-01

### Fixed
- Fixed bash -c command parsing issue that caused server crashes
- Handling for bash -c commands to prevent shell escaping issues
- Commands like `bash -c "complex script"` execute without double shell interpretation

## [2.5.0] - 2025-06-01

### Changed
- **Breaking**: Renamed `create_session` to `create_shell_session` to avoid conflicts with iterm-mcp
- **Breaking**: Renamed `list_sessions` to `list_shell_sessions` to avoid conflicts with iterm-mcp

### Fixed
- Tool naming conflicts between macos-shell and iterm-mcp that caused incorrect tool routing

## [2.4.0] - 2025-06-01

### Added
- New `ORPHANED` process status to distinguish between failed processes and those running from previous sessions
- `cleanup_orphans` tool with three modes:
  - `list`: Shows orphaned processes
  - `kill`: Kills orphaned processes 
  - `interactive` (default): Shows orphans and suggests actions
- Orphan process detection on server startup using `process.kill(pid, 0)`
- Warning indicators in `list_processes` for orphaned processes

### Changed
- `kill_process` tool works on orphaned processes using system kill
- Process metadata loading checks if processes are alive
- Process status tracking to differentiate between failed and orphaned processes

### Fixed
- Orphaned processes from previous server sessions are manageable
- No more need for manual cleanup using Activity Monitor after server restart

## [2.3.0] - 2025-06-01

### Added
- Session persistence across server restarts
  - Sessions saved to `~/.macos-shell/sessions` as JSON files
  - Working directories and environment variables preserved
  - Command history maintained (last 100 commands)
  - Sessions restored on server startup
- Background process metadata persistence
  - Process information saved to `~/.macos-shell/processes` 
  - Output history preserved (last 1000 lines)
  - Processes marked as terminated on restart
  - Historical output accessible after restart
- Validation of restored working directories
- Cleanup of persistence files when sessions/processes are deleted

### Fixed
- Console.log statements in session restoration causing JSON parsing errors
- Session initialization promise handling

### Technical Details
- Persistence uses JSON files for portability
- Default session is never persisted
- Process files cleaned up 5 seconds after process termination

## [2.2.0] - 2025-06-01

### Added
- Output streaming with `stream_process_output` tool
  - Long-polling mechanism for output access
  - Configurable timeout (default: 30 seconds)
  - Maintains read position for continuous streaming
  - Returns lines as they arrive
- CircularBuffer with `waitForLines` method
- Support for streaming process outputs

### Technical Details
- Uses async/await patterns for non-blocking output waiting
- Line counting and position tracking
- Handling of process termination during streaming

## [2.1.0] - 2025-06-01

### Added
- Background process management with 4 tools:
  - `run_background` - Start processes in detached mode
  - `list_processes` - List background processes
  - `get_process_output` - Retrieve buffered output
  - `kill_process` - Terminate processes with signal support
- CircularBuffer implementation for output storage
  - 10,000 line default capacity per process
  - Line-by-line output capture
  - Separate stdout/stderr tracking
- Process lifecycle management
  - States: STARTING → RUNNING → STOPPED/FAILED/KILLED
  - Cleanup after termination
  - Resource limits: 50 processes per session, 200 total
- `list_sessions` shows background process counts

### Technical Details
- Processes run with `detached: true` using execa
- Output captured with event-based streaming
- Circular buffer implementation
- Process metadata tracked in session objects

## [2.0.0] - 2024-05-30

### Added
- Rewrite with session management
- 9 new tools (10 total):
  - `create_session` - Named sessions with isolated environments
  - `list_sessions` - View active sessions
  - `close_session` - Clean up sessions
  - `cd` - Working directory changes
  - `pwd` - Get current directory
  - `set_env` - Session-specific environment variables
  - `get_env` - Retrieve environment variables
  - `run_script` - Execute multi-line scripts
  - `history` - Command history tracking
- Environment isolation between sessions
- Working directory persistence per session
- Command history with timing and exit codes
- Error handling

### Changed
- Breaking: Tool names and parameters updated
- Default session created
- All commands support session parameter

### Technical Details
- TypeScript with ES2020 target
- Map-based session storage
- Zod schema validation
- MCP protocol implementation

## [1.0.0] - Initial Release

### Added
- Basic `run_command` tool
- Command execution
- Output capture (stdout/stderr)
- Exit code reporting

### Technical Details
- Node.js with MCP SDK
- Error handling
- macOS `/bin/zsh` shell usage