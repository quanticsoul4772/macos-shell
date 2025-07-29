// Process Tools Module
// Background process management tools - Refactored with modular handlers

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SessionManager } from '../session-manager.js';
import {
  handleRunBackground,
  handleListProcesses,
  handleGetProcessOutput,
  handleStreamProcessOutput,
  handleKillProcess,
  handleSaveProcessOutput
} from './helpers/process-handlers.js';
import {
  handleCleanupOrphans,
  handleKillAllMatching
} from './helpers/orphan-handlers.js';

/**
 * Registers all process management tools with the MCP server
 * 
 * Tools included:
 * - run_background: Start a command in the background
 * - list_processes: List all background processes with filtering
 * - get_process_output: Retrieve output from a process with search
 * - stream_process_output: Stream real-time output from a process
 * - kill_process: Terminate a background process
 * - cleanup_orphans: Manage orphaned processes from previous sessions
 * - kill_all_matching: Kill all processes matching a pattern
 * - save_process_output: Save process output to a file
 */
export function registerProcessTools(server: McpServer, sessionManager: SessionManager) {
  // run_background tool
  server.tool(
    "run_background",
    {
      command: z.string().describe("The command to run in background"),
      args: z.array(z.string()).default([]).describe("Command arguments"),
      session: z.string().optional().describe("Session name or ID (uses default if not specified)"),
      name: z.string().optional().describe("Optional name for the background process")
    },
    async (params) => handleRunBackground(params, sessionManager)
  );

  // list_processes tool
  server.tool(
    "list_processes",
    {
      session: z.string().optional().describe("Filter by session name or ID"),
      limit: z.number().optional().default(20).describe("Maximum number of processes to return (default: 20)"),
      offset: z.number().optional().default(0).describe("Number of processes to skip (for pagination)"),
      includeOrphaned: z.boolean().optional().default(true).describe("Include orphaned processes from previous sessions")
    },
    async (params) => handleListProcesses(params, sessionManager)
  );

  // get_process_output tool
  server.tool(
    "get_process_output",
    {
      process_id: z.string().describe("The background process ID"),
      lines: z.number().optional().default(100).describe("Number of lines to retrieve (default: 100)"),
      from_line: z.number().optional().describe("Starting line number (0-based)"),
      search: z.string().optional().describe("Search for lines containing this pattern"),
      search_type: z.enum(['text', 'regex']).optional().default('text').describe("Type of search: 'text' for literal text, 'regex' for regular expressions"),
      case_sensitive: z.boolean().optional().default(false).describe("Case-sensitive search (default: false)"),
      invert_match: z.boolean().optional().default(false).describe("Show lines that DON'T match the search pattern"),
      show_context: z.number().optional().default(0).describe("Number of context lines to show before and after matches")
    },
    async (params) => handleGetProcessOutput(params, sessionManager)
  );

  // stream_process_output tool - real-time output streaming
  server.tool(
    "stream_process_output",
    {
      process_id: z.string().describe("The background process ID"),
      after_line: z.number().optional().describe("Get lines after this line number (default: 0)"),
      timeout: z.number().optional().default(30000).describe("Max time to wait for new output in ms (default: 30000)"),
      max_lines: z.number().optional().default(100).describe("Maximum lines to return (default: 100)")
    },
    async (params) => handleStreamProcessOutput(params, sessionManager)
  );

  // kill_process tool
  server.tool(
    "kill_process",
    {
      process_id: z.string().describe("The background process ID to kill"),
      signal: z.enum(['SIGTERM', 'SIGKILL']).optional().default('SIGTERM').describe("Signal to send (SIGTERM or SIGKILL)")
    },
    async (params) => handleKillProcess(params, sessionManager)
  );

  // cleanup_orphans tool
  server.tool(
    "cleanup_orphans",
    {
      mode: z.enum(['list', 'kill', 'interactive']).optional().default('interactive').describe("Operation mode: list (show orphans), kill (kill all), interactive (show and suggest)"),
      force: z.boolean().optional().default(false).describe("Use SIGKILL instead of SIGTERM for kill mode")
    },
    async (params) => handleCleanupOrphans(params, sessionManager)
  );

  // kill_all_matching tool
  server.tool(
    "kill_all_matching",
    {
      pattern: z.string().describe("Pattern to match process command or arguments"),
      pattern_type: z.enum(['text', 'regex']).default('text').describe("Type of pattern matching"),
      signal: z.enum(['SIGTERM', 'SIGKILL']).optional().default('SIGTERM').describe("Signal to send"),
      dry_run: z.boolean().optional().default(false).describe("Preview which processes would be killed without actually killing them")
    },
    async (params) => handleKillAllMatching(params, sessionManager)
  );

  // save_process_output tool
  server.tool(
    "save_process_output",
    {
      process_id: z.string().describe("The background process ID"),
      file_path: z.string().describe("Path where to save the output"),
      format: z.enum(['text', 'json']).optional().default('text').describe("Output format"),
      include_metadata: z.boolean().optional().default(false).describe("Include process metadata in output")
    },
    async (params) => handleSaveProcessOutput(params, sessionManager)
  );
}
