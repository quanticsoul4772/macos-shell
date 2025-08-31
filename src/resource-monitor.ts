import { execa } from 'execa';
import { resourceCache } from './utils/resource-cache.js';
import { getLogger } from './utils/logger.js';

const logger = getLogger('resource-monitor');

// Simplified types for resource monitoring
export interface ProcessResources {
  cpu: number;              // Current CPU percentage
  memory: number;           // Memory in MB
  memoryPercent: number;    // Memory percentage
  lastSampled: Date;        // When this data was collected
  sampleCount: number;      // Number of samples collected
}

export interface ResourceSample {
  pid: number;
  cpu: number;
  memory: number;
  memoryPercent: number;
}

// Simple circuit breaker for handling ps command failures
export class CircuitBreaker {
  private failureCount = 0;
  private state: 'closed' | 'open' = 'closed';
  
  private readonly maxFailures = 3;
  private readonly resetTimeout = 30000; // 30 seconds

  async execute<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.state === 'open') {
      return null;
    }

    try {
      const result = await fn();
      this.failureCount = 0;
      return result;
    } catch (error) {
      this.failureCount++;
      if (this.failureCount >= this.maxFailures) {
        this.state = 'open';
        setTimeout(() => {
          this.state = 'closed';
          this.failureCount = 0;
        }, this.resetTimeout);
      }
      return null;
    }
  }

  reset(): void {
    this.failureCount = 0;
    this.state = 'closed';
  }
}

// Parser for ps command output
export class PsOutputParser {
  parse(output: string): Map<number, ResourceSample> {
    const lines = output.trim().split('\n');
    const results = new Map<number, ResourceSample>();
    
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      
      try {
        const pid = parseInt(parts[0], 10);
        const cpu = parseFloat(parts[1]);
        const memPercent = parseFloat(parts[2]);
        const rss = parseInt(parts[3], 10); // RSS is in KB
        
        if (isNaN(pid) || isNaN(cpu) || isNaN(memPercent) || isNaN(rss)) {
          continue;
        }
        
        results.set(pid, {
          pid,
          cpu: Math.max(0, cpu),
          memory: Math.max(0, rss / 1024), // Convert KB to MB
          memoryPercent: Math.max(0, memPercent)
        });
      } catch (error) {
        // Skip invalid lines
      }
    }
    
    return results;
  }
}

// Simplified resource monitor class
export class ResourceMonitor {
  private readonly circuitBreaker = new CircuitBreaker();
  private readonly parser = new PsOutputParser();
  
  private readonly SAMPLE_INTERVAL = 5000; // Fixed 5 second interval
  private readonly MAX_PROCESSES = 100;
  private readonly samplingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly processResources = new Map<string, ProcessResources>();

  // Sample multiple processes with caching
  async sampleProcesses(pids: number[]): Promise<Map<number, ResourceSample>> {
    if (pids.length === 0) {
      return new Map();
    }

    const limitedPids = pids.slice(0, this.MAX_PROCESSES);
    
    // Check cache first
    const cachedData = resourceCache.getMultiple(limitedPids);
    const results = new Map<number, ResourceSample>();
    
    // Add cached results
    for (const [pid, data] of cachedData) {
      results.set(pid, {
        pid: data.pid,
        cpu: data.cpu,
        memory: data.memory,
        memoryPercent: data.memoryPercent
      });
    }
    
    // Find PIDs that need fresh data
    const pidsToFetch = limitedPids.filter(pid => !cachedData.has(pid));
    
    // If all data is cached, return early
    if (pidsToFetch.length === 0) {
      logger.debug({ 
        module: 'resource-monitor', 
        action: 'cache-hit-all',
        count: results.size 
      }, 'All process data served from cache');
      return results;
    }
    
    // Fetch fresh data for uncached PIDs
    const freshData = await this.circuitBreaker.execute(async () => {
      const { stdout } = await execa('ps', [
        '-p', pidsToFetch.join(','),
        '-o', 'pid,%cpu,%mem,rss'
      ], {
        timeout: 2000,
        reject: false
      });
      
      return stdout;
    });

    if (!freshData) {
      // Return at least the cached data
      return results;
    }

    // Parse fresh data
    const parsedData = this.parser.parse(freshData);
    
    // Cache the fresh data
    const cacheEntries = new Map<number, { pid: number; cpu: number; memory: number; memoryPercent: number }>();
    for (const [pid, sample] of parsedData) {
      results.set(pid, sample);
      cacheEntries.set(pid, {
        pid: sample.pid,
        cpu: sample.cpu,
        memory: sample.memory,
        memoryPercent: sample.memoryPercent
      });
    }
    
    // Batch cache update
    if (cacheEntries.size > 0) {
      resourceCache.setMultiple(cacheEntries);
    }
    
    logger.debug({ 
      module: 'resource-monitor', 
      action: 'sample',
      total: limitedPids.length,
      cached: cachedData.size,
      fetched: pidsToFetch.length,
      cacheHitRate: Math.round((cachedData.size / limitedPids.length) * 100)
    }, `Sampled processes with ${Math.round((cachedData.size / limitedPids.length) * 100)}% cache hit rate`);

    return results;
  }

  // Update stored resources with new sample
  updateResources(processId: string, sample: ResourceSample): ProcessResources {
    const existing = this.processResources.get(processId);
    const now = new Date();
    
    const resources: ProcessResources = {
      cpu: sample.cpu,
      memory: sample.memory,
      memoryPercent: sample.memoryPercent,
      lastSampled: now,
      sampleCount: existing ? existing.sampleCount + 1 : 1
    };
    
    this.processResources.set(processId, resources);
    return resources;
  }

  // Get resources for a process
  getResources(processId: string): ProcessResources | undefined {
    return this.processResources.get(processId);
  }

  // Start monitoring a process
  startMonitoring(processId: string, pid: number): void {
    this.stopMonitoring(processId);
    
    // Sample immediately
    this.sampleSingleProcess(processId, pid);
    
    // Set up regular sampling
    const timer = setInterval(() => {
      this.sampleSingleProcess(processId, pid);
    }, this.SAMPLE_INTERVAL);
    
    this.samplingTimers.set(processId, timer);
  }

  // Sample a single process
  private async sampleSingleProcess(processId: string, pid: number): Promise<void> {
    const samples = await this.sampleProcesses([pid]);
    const sample = samples.get(pid);
    
    if (sample) {
      this.updateResources(processId, sample);
    } else {
      // Process died
      this.stopMonitoring(processId);
    }
  }

  // Stop monitoring a process
  stopMonitoring(processId: string): void {
    const timer = this.samplingTimers.get(processId);
    if (timer) {
      clearInterval(timer);
      this.samplingTimers.delete(processId);
    }
    
    // Clean up resources after a delay
    setTimeout(() => {
      this.processResources.delete(processId);
    }, 5000);
  }

  // Stop all monitoring
  stopAll(): void {
    for (const timer of this.samplingTimers.values()) {
      clearInterval(timer);
    }
    this.samplingTimers.clear();
    this.processResources.clear();
    this.circuitBreaker.reset();
  }
}
