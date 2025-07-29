// SSH Constants and Types
// Extracted from interactive-ssh-tool.ts during refactoring

import { IPty } from 'node-pty';
import { EnhancedCircularBuffer } from '../../utils/enhanced-circular-buffer.js';

export interface InteractiveSSHSession {
  id: string;
  pty: IPty;
  host: string;
  user?: string;
  port: number;
  keyFile?: string;
  outputBuffer: EnhancedCircularBuffer;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastActivity: Date;
  startTime: Date;
  timeoutHandle?: NodeJS.Timeout;
}

// Enhanced prompt patterns for better detection
export const PROMPT_PATTERNS = [
  /[$#>%]\s*$/,                    // Basic prompts
  /\]\$\s*$/,                      // Bash PS1 with ]
  /\)\s*[$#>%]\s*$/,               // Prompts with closing paren
  /➜\s*$/,                         // Oh-my-zsh arrow
  /❯\s*$/,                         // Starship prompt
  /\w+@[\w.-]+:.*[$#>%]\s*$/,     // user@host prompts
  /\[\w+@[\w.-]+\s+\w+\][$#]\s*$/ // [user@host dir]$ format
];

// Authentication patterns
export const AUTH_SUCCESS_PATTERNS = [
  /Last login:/i,
  /Welcome to/i,
  /^[\w.-]+@[\w.-]+/,
  /\w+@\w+.*\s*$/
];

// Error patterns
export const ERROR_PATTERNS = [
  /Permission denied/i,
  /Connection refused/i,
  /No route to host/i,
  /Host key verification failed/i,
  /Connection timed out/i,
  /Could not resolve hostname/i
];

// ANSI escape code pattern
export const ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]/g;

// Configuration
export const MAX_SESSIONS = 10;
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const CONNECT_TIMEOUT_MS = 10000; // 10 seconds
