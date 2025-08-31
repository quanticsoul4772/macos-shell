/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by monitoring and controlling command execution
 */

import { EventEmitter } from 'events';
import { getLogger } from './logger.js';

const logger = getLogger('circuit-breaker');

export enum CircuitState {
  CLOSED = 'CLOSED',    // Normal operation
  OPEN = 'OPEN',        // Failing, reject all requests
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;      // Number of failures to open circuit
  successThreshold?: number;      // Number of successes to close circuit from half-open
  timeout?: number;               // Time before trying half-open from open (ms)
  volumeThreshold?: number;       // Minimum requests before opening circuit
  errorThresholdPercentage?: number; // Error percentage to open circuit
  windowSize?: number;            // Time window for metrics (ms)
  fallback?: () => Promise<any>; // Fallback function when circuit is open
}

export interface CircuitMetrics {
  requests: number;
  failures: number;
  successes: number;
  rejections: number;
  fallbacks: number;
  latency: number[];
  errorRate: number;
  state: CircuitState;
  lastStateChange: Date;
  nextAttempt?: Date;
}

export interface RequestRecord {
  timestamp: number;
  success: boolean;
  latency: number;
}

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private readonly options: Required<CircuitBreakerOptions>;
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private lastStateChange = new Date();
  private nextAttempt?: Date;
  private resetTimer?: NodeJS.Timeout;
  
  // Sliding window for metrics
  private readonly requestHistory: RequestRecord[] = [];
  private metrics: CircuitMetrics;

  constructor(
    private readonly name: string,
    options: CircuitBreakerOptions = {}
  ) {
    super();
    
    this.options = {
      failureThreshold: options.failureThreshold || 5,
      successThreshold: options.successThreshold || 2,
      timeout: options.timeout || 60000, // 1 minute
      volumeThreshold: options.volumeThreshold || 10,
      errorThresholdPercentage: options.errorThresholdPercentage || 50,
      windowSize: options.windowSize || 60000, // 1 minute
      fallback: options.fallback || (() => Promise.reject(new Error('Circuit breaker is open'))),
    };

    this.metrics = this.createEmptyMetrics();
    
    logger.info({
      module: 'circuit-breaker',
      action: 'initialize',
      name: this.name,
      options: this.options,
    }, `Circuit breaker '${this.name}' initialized`);
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        this.metrics.rejections++;
        this.emit('rejected', { name: this.name, state: this.state });
        
        // Try fallback
        if (this.options.fallback) {
          this.metrics.fallbacks++;
          return this.options.fallback() as Promise<T>;
        }
        
        throw new Error(`Circuit breaker '${this.name}' is OPEN`);
      }
    }

    // Execute the function
    const startTime = Date.now();
    
    try {
      const result = await fn();
      const latency = Date.now() - startTime;
      
      this.recordSuccess(latency);
      
      return result;
    } catch (error) {
      const latency = Date.now() - startTime;
      
      this.recordFailure(latency);
      
      // If circuit is open after failure, try fallback
      if (this.state === CircuitState.OPEN && this.options.fallback) {
        this.metrics.fallbacks++;
        return this.options.fallback() as Promise<T>;
      }
      
      throw error;
    }
  }

  /**
   * Record a successful request
   */
  private recordSuccess(latency: number): void {
    this.addRequestRecord(true, latency);
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    
    this.metrics.successes++;
    this.metrics.latency.push(latency);
    if (this.metrics.latency.length > 100) {
      this.metrics.latency.shift();
    }

    this.emit('success', { 
      name: this.name, 
      latency, 
      consecutiveSuccesses: this.consecutiveSuccesses 
    });

    // Handle state transitions
    if (this.state === CircuitState.HALF_OPEN) {
      if (this.consecutiveSuccesses >= this.options.successThreshold) {
        this.transitionTo(CircuitState.CLOSED);
      }
    }

    this.updateMetrics();
  }

  /**
   * Record a failed request
   */
  private recordFailure(latency: number): void {
    this.addRequestRecord(false, latency);
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;
    
    this.metrics.failures++;
    this.metrics.latency.push(latency);
    if (this.metrics.latency.length > 100) {
      this.metrics.latency.shift();
    }

    this.emit('failure', { 
      name: this.name, 
      latency, 
      consecutiveFailures: this.consecutiveFailures 
    });

    // Handle state transitions
    if (this.state === CircuitState.HALF_OPEN) {
      this.transitionTo(CircuitState.OPEN);
    } else if (this.state === CircuitState.CLOSED) {
      if (this.shouldOpen()) {
        this.transitionTo(CircuitState.OPEN);
      }
    }

    this.updateMetrics();
  }

  /**
   * Add request record to sliding window
   */
  private addRequestRecord(success: boolean, latency: number): void {
    const now = Date.now();
    
    this.requestHistory.push({
      timestamp: now,
      success,
      latency,
    });

    // Remove old records outside the window
    const windowStart = now - this.options.windowSize;
    while (this.requestHistory.length > 0 && this.requestHistory[0].timestamp < windowStart) {
      this.requestHistory.shift();
    }
  }

  /**
   * Check if circuit should open
   */
  private shouldOpen(): boolean {
    // Check consecutive failures
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      return true;
    }

    // Check error rate in window
    if (this.requestHistory.length >= this.options.volumeThreshold) {
      const failures = this.requestHistory.filter(r => !r.success).length;
      const errorRate = (failures / this.requestHistory.length) * 100;
      
      if (errorRate >= this.options.errorThresholdPercentage) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if we should attempt to reset from open state
   */
  private shouldAttemptReset(): boolean {
    if (!this.nextAttempt) return true;
    return new Date() >= this.nextAttempt;
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = new Date();

    // Clear any existing timer
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }

    // Handle state-specific logic
    switch (newState) {
      case CircuitState.OPEN:
        this.nextAttempt = new Date(Date.now() + this.options.timeout);
        this.resetTimer = setTimeout(() => {
          if (this.state === CircuitState.OPEN) {
            this.transitionTo(CircuitState.HALF_OPEN);
          }
        }, this.options.timeout);
        break;
        
      case CircuitState.HALF_OPEN:
        this.consecutiveSuccesses = 0;
        this.consecutiveFailures = 0;
        this.nextAttempt = undefined;
        break;
        
      case CircuitState.CLOSED:
        this.consecutiveSuccesses = 0;
        this.consecutiveFailures = 0;
        this.nextAttempt = undefined;
        break;
    }

    logger.info({
      module: 'circuit-breaker',
      action: 'state-change',
      name: this.name,
      oldState,
      newState,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
    }, `Circuit breaker '${this.name}' transitioned from ${oldState} to ${newState}`);

    this.emit('state-change', {
      name: this.name,
      oldState,
      newState,
      timestamp: this.lastStateChange,
    });

    this.updateMetrics();
  }

  /**
   * Update metrics
   */
  private updateMetrics(): void {
    const requests = this.requestHistory.length;
    const failures = this.requestHistory.filter(r => !r.success).length;
    const errorRate = requests > 0 ? (failures / requests) * 100 : 0;

    this.metrics = {
      requests: this.metrics.requests,
      failures: this.metrics.failures,
      successes: this.metrics.successes,
      rejections: this.metrics.rejections,
      fallbacks: this.metrics.fallbacks,
      latency: this.metrics.latency,
      errorRate,
      state: this.state,
      lastStateChange: this.lastStateChange,
      nextAttempt: this.nextAttempt,
    };
  }

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): CircuitMetrics {
    return {
      requests: 0,
      failures: 0,
      successes: 0,
      rejections: 0,
      fallbacks: 0,
      latency: [],
      errorRate: 0,
      state: this.state,
      lastStateChange: this.lastStateChange,
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): CircuitMetrics {
    return { ...this.metrics };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Force open the circuit
   */
  open(): void {
    if (this.state !== CircuitState.OPEN) {
      this.transitionTo(CircuitState.OPEN);
    }
  }

  /**
   * Force close the circuit
   */
  close(): void {
    if (this.state !== CircuitState.CLOSED) {
      this.transitionTo(CircuitState.CLOSED);
    }
  }

  /**
   * Reset the circuit breaker
   */
  reset(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.requestHistory.length = 0;
    this.metrics = this.createEmptyMetrics();
    this.transitionTo(CircuitState.CLOSED);
    
    logger.info({
      module: 'circuit-breaker',
      action: 'reset',
      name: this.name,
    }, `Circuit breaker '${this.name}' reset`);
  }

  /**
   * Dispose the circuit breaker
   */
  dispose(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
    }
    this.removeAllListeners();
    
    logger.info({
      module: 'circuit-breaker',
      action: 'dispose',
      name: this.name,
      finalMetrics: this.metrics,
    }, `Circuit breaker '${this.name}' disposed`);
  }
}

// Circuit breaker registry
class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  /**
   * Get or create a circuit breaker
   */
  getBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
    let breaker = this.breakers.get(name);
    
    if (!breaker) {
      breaker = new CircuitBreaker(name, options);
      this.breakers.set(name, breaker);
    }
    
    return breaker;
  }

  /**
   * Remove a circuit breaker
   */
  removeBreaker(name: string): void {
    const breaker = this.breakers.get(name);
    if (breaker) {
      breaker.dispose();
      this.breakers.delete(name);
    }
  }

  /**
   * Get all circuit breakers
   */
  getAllBreakers(): Map<string, CircuitBreaker> {
    return new Map(this.breakers);
  }

  /**
   * Get metrics for all breakers
   */
  getAllMetrics(): Record<string, CircuitMetrics> {
    const metrics: Record<string, CircuitMetrics> = {};
    
    for (const [name, breaker] of this.breakers) {
      metrics[name] = breaker.getMetrics();
    }
    
    return metrics;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Dispose all circuit breakers
   */
  disposeAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.dispose();
    }
    this.breakers.clear();
  }
}

// Export singleton registry
export const circuitBreakerRegistry = new CircuitBreakerRegistry();