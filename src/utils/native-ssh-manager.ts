// Native SSH Implementation using ssh2 library
// Provides faster connections and better control than spawning SSH processes

import { Client, ClientChannel, ConnectConfig, Algorithms } from 'ssh2';
import { v4 as uuidv4 } from 'uuid';
import { EnhancedCircularBuffer } from '../utils/enhanced-circular-buffer.js';
import { AI_BUFFER_SIZE } from '../sessions/session-types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import logger from './logger.js';

interface NativeSSHSession {
  id: string;
  client: Client;
  host: string;
  user: string;
  port: number;
  keyFile?: string;
  outputBuffer: EnhancedCircularBuffer;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastActivity: Date;
  startTime: Date;
  activeChannel?: ClientChannel;
  streamBuffer: string;
}

// SSH Configuration defaults - properly typed
const DEFAULT_ALGORITHMS: Algorithms = {
  kex: ['ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group14-sha256'] as any,
  serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-ed25519'] as any,
  cipher: ['aes256-ctr', 'aes192-ctr', 'aes128-ctr'] as any,
  hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1'] as any
};

export class NativeSSHManager {
  private sessions = new Map<string, NativeSSHSession>();
  private sshConfigCache: Map<string, ConnectConfig> = new Map();
  
  constructor() {
    // Load SSH config on initialization
    this.loadSSHConfig().catch(error => 
      logger.error({ module: 'native-ssh-manager', action: 'init-ssh-config', error }, 'Failed to load SSH config on initialization')
    );
  }

  /**
   * Parse ~/.ssh/config to extract host configurations
   */
  private async loadSSHConfig(): Promise<void> {
    try {
      const configPath = path.join(os.homedir(), '.ssh', 'config');
      const configContent = await fs.readFile(configPath, 'utf-8');
      
      // Simple SSH config parser (handles basic cases)
      const lines = configContent.split('\n');
      let currentHost: string | null = null;
      let currentConfig: any = {};
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const match = trimmed.match(/^(\w+)\s+(.+)$/);
        if (!match) continue;
        
        const [, key, value] = match;
        
        if (key.toLowerCase() === 'host') {
          // Save previous host config
          if (currentHost && Object.keys(currentConfig).length > 0) {
            this.sshConfigCache.set(currentHost, this.configToConnectConfig(currentConfig));
          }
          currentHost = value;
          currentConfig = {};
        } else if (currentHost) {
          currentConfig[key.toLowerCase()] = value;
        }
      }
      
      // Save last host
      if (currentHost && Object.keys(currentConfig).length > 0) {
        this.sshConfigCache.set(currentHost, this.configToConnectConfig(currentConfig));
      }
    } catch (error) {
      logger.error({ module: 'native-ssh-manager', action: 'load-ssh-config', error }, `Failed to load SSH config: ${error}`);
    }
  }
  
  /**
   * Convert SSH config format to ssh2 ConnectConfig
   */
  private configToConnectConfig(config: any): ConnectConfig {
    const result: ConnectConfig = {
      algorithms: DEFAULT_ALGORITHMS
    };
    
    if (config.hostname) result.host = config.hostname;
    if (config.user) result.username = config.user;
    if (config.port) result.port = parseInt(config.port, 10);
    if (config.identityfile) {
      result.privateKey = config.identityfile.replace('~', os.homedir());
    }
    
    // Handle ciphers and macs from SSH config
    if (config.ciphers) {
      result.algorithms!.cipher = config.ciphers.split(',').map((c: string) => c.trim());
    }
    if (config.macs) {
      result.algorithms!.hmac = config.macs.split(',').map((m: string) => m.trim());
    }
    
    return result;
  }
  
  /**
   * Get connection config for a host, checking SSH config first
   */
  private async getConnectionConfig(
    host: string,
    port: number,
    user?: string,
    keyFile?: string,
    password?: string
  ): Promise<ConnectConfig> {
    // Check if we have a config for this host
    let baseConfig: ConnectConfig = {};
    
    // Check exact host match
    if (this.sshConfigCache.has(host)) {
      baseConfig = { ...this.sshConfigCache.get(host)! };
    } else {
      // Check wildcard patterns (simple implementation for 192.168.21.*)
      for (const [pattern, config] of this.sshConfigCache.entries()) {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          if (regex.test(host)) {
            baseConfig = { ...config };
            break;
          }
        }
      }
    }
    
    // Build final config with overrides
    const config: ConnectConfig = {
      host,
      port,
      username: user || baseConfig.username || process.env.USER,
      readyTimeout: 5000,
      keepaliveInterval: 60000,
      keepaliveCountMax: 3,
      algorithms: baseConfig.algorithms || DEFAULT_ALGORITHMS,
      ...baseConfig
    };
    
    // Handle authentication
    if (keyFile) {
      // Explicit key file provided
      const keyPath = keyFile.replace('~', os.homedir());
      config.privateKey = await fs.readFile(keyPath);
    } else if (baseConfig.privateKey && typeof baseConfig.privateKey === 'string') {
      // Key file from SSH config
      try {
        config.privateKey = await fs.readFile(baseConfig.privateKey);
      } catch (error) {
        logger.warn({ module: 'native-ssh-manager', action: 'read-key-file', keyFile: baseConfig.privateKey, error }, `Failed to read key file ${baseConfig.privateKey}: ${error}`);
      }
    } else if (password) {
      // Password authentication
      config.password = password;
    } else {
      // Try default keys
      const defaultKeys = ['id_rsa', 'id_ecdsa', 'id_ed25519'];
      for (const keyName of defaultKeys) {
        const keyPath = path.join(os.homedir(), '.ssh', keyName);
        try {
          config.privateKey = await fs.readFile(keyPath);
          break;
        } catch {
          // Continue to next key
        }
      }
    }
    
    return config;
  }

  /**
   * Start a new SSH session using native ssh2 library
   */
  async startSession(
    host: string,
    port: number = 22,
    user?: string,
    keyFile?: string,
    password?: string
  ): Promise<{ sessionId: string; error?: string; connectionTime?: number }> {
    const sessionId = uuidv4();
    const startTime = Date.now();
    
    try {
      const config = await this.getConnectionConfig(host, port, user, keyFile, password);
      const client = new Client();
      
      const session: NativeSSHSession = {
        id: sessionId,
        client,
        host,
        user: config.username as string,
        port,
        keyFile,
        outputBuffer: new EnhancedCircularBuffer(AI_BUFFER_SIZE),
        status: 'connecting',
        lastActivity: new Date(),
        startTime: new Date(),
        streamBuffer: ''
      };
      
      this.sessions.set(sessionId, session);
      
      return new Promise((resolve) => {
        let resolved = false;
        
        // Set connection timeout
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            session.status = 'error';
            client.end();
            this.sessions.delete(sessionId);
            resolve({ 
              sessionId: '', 
              error: 'Connection timeout',
              connectionTime: Date.now() - startTime
            });
          }
        }, config.readyTimeout || 5000);
        
        client.on('ready', () => {
          if (!resolved) {
            clearTimeout(timeout);
            resolved = true;
            session.status = 'connected';
            const connectionTime = Date.now() - startTime;
            
            // Start interactive shell
            client.shell({ term: 'xterm-256color' }, (err, stream) => {
              if (err) {
                session.status = 'error';
                resolve({ sessionId: '', error: err.message, connectionTime });
                return;
              }
              
              session.activeChannel = stream;
              
              // Handle output
              stream.on('data', (data: Buffer) => {
                const text = data.toString();
                session.streamBuffer += text;
                
                // Process complete lines
                const lines = session.streamBuffer.split(/\r?\n/);
                if (lines.length > 1) {
                  // Keep incomplete line in buffer
                  session.streamBuffer = lines[lines.length - 1];
                  
                  // Add complete lines to output buffer
                  for (let i = 0; i < lines.length - 1; i++) {
                    if (lines[i]) {
                      session.outputBuffer.add({
                        timestamp: new Date(),
                        type: 'stdout',
                        content: this.stripAnsi(lines[i]),
                        lineNumber: session.outputBuffer.getTotalLines() + 1
                      });
                    }
                  }
                }
                
                session.lastActivity = new Date();
              });
              
              stream.stderr.on('data', (data: Buffer) => {
                const lines = data.toString().split(/\r?\n/);
                lines.forEach((line) => {
                  if (line) {
                    session.outputBuffer.add({
                      timestamp: new Date(),
                      type: 'stderr',
                      content: this.stripAnsi(line),
                      lineNumber: session.outputBuffer.getTotalLines() + 1
                    });
                  }
                });
                session.lastActivity = new Date();
              });
              
              resolve({ sessionId, connectionTime });
            });
          }
        });
        
        client.on('error', (err) => {
          if (!resolved) {
            clearTimeout(timeout);
            resolved = true;
            session.status = 'error';
            this.sessions.delete(sessionId);
            resolve({ 
              sessionId: '', 
              error: err.message,
              connectionTime: Date.now() - startTime
            });
          }
        });
        
        client.on('close', () => {
          session.status = 'disconnected';
          setTimeout(() => {
            this.sessions.delete(sessionId);
          }, 5000);
        });
        
        // Connect
        client.connect(config);
      });
    } catch (error: any) {
      this.sessions.delete(sessionId);
      return { 
        sessionId: '', 
        error: error.message,
        connectionTime: Date.now() - startTime
      };
    }
  }

  /**
   * Send command to SSH session
   */
  sendInput(sessionId: string, input: string, addNewline: boolean = true): { success: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }
    
    if (session.status !== 'connected' || !session.activeChannel) {
      return { success: false, error: `Session is ${session.status}` };
    }
    
    try {
      session.activeChannel.write(input + (addNewline ? '\n' : ''));
      session.lastActivity = new Date();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Send control character
   */
  sendControlChar(sessionId: string, char: string): { success: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    
    if (!session || !session.activeChannel) {
      return { success: false, error: `Session '${sessionId}' not found or not connected` };
    }
    
    try {
      const controlChar = String.fromCharCode(char.toUpperCase().charCodeAt(0) - 64);
      session.activeChannel.write(controlChar);
      session.lastActivity = new Date();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get output from session
   */
  getOutput(sessionId: string, lines?: number, fromLine?: number): { 
    output: string; 
    totalLines: number; 
    error?: string 
  } {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { output: '', totalLines: 0, error: `Session '${sessionId}' not found` };
    }
    
    const outputLines = session.outputBuffer.getLines(lines, fromLine);
    const output = outputLines.map(line => line.content).join('\n');
    
    return { output, totalLines: session.outputBuffer.getTotalLines() };
  }

  /**
   * Wait for new output
   */
  async waitForOutput(sessionId: string, afterLine: number, timeout: number = 5000): Promise<{ output: string; error?: string }> {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { output: '', error: `Session '${sessionId}' not found` };
    }
    
    const lines = await session.outputBuffer.waitForLines(afterLine, timeout);
    const output = lines.map(line => line.content).join('\n');
    
    return { output };
  }

  /**
   * Close session
   */
  closeSession(sessionId: string): { success: boolean; error?: string } {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return { success: false, error: `Session '${sessionId}' not found` };
    }
    
    try {
      session.client.end();
      this.sessions.delete(sessionId);
      return { success: true };
    } catch (error: any) {
      this.sessions.delete(sessionId);
      return { success: true };
    }
  }

  /**
   * List all sessions
   */
  listSessions(): Array<Omit<NativeSSHSession, 'client' | 'activeChannel'>> {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      host: session.host,
      user: session.user,
      port: session.port,
      keyFile: session.keyFile,
      outputBuffer: session.outputBuffer,
      status: session.status,
      lastActivity: session.lastActivity,
      startTime: session.startTime,
      streamBuffer: session.streamBuffer
    }));
  }

  /**
   * Strip ANSI escape codes
   */
  private stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * Cleanup all sessions
   */
  cleanup() {
    for (const session of this.sessions.values()) {
      try {
        session.client.end();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.sessions.clear();
  }
}
