import { CircuitBreaker, CircuitState, circuitBreakerRegistry } from './circuit-breaker.js';
import { EventEmitter } from 'events';

// Mock the logger
jest.mock('./logger', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }))
}));

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    jest.useFakeTimers();
    breaker = new CircuitBreaker('test-breaker', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 5000,
      volumeThreshold: 5,
      errorThresholdPercentage: 50,
    });
  });

  afterEach(() => {
    breaker.dispose();
    jest.useRealTimers();
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should have empty metrics initially', () => {
      const metrics = breaker.getMetrics();
      expect(metrics.requests).toBe(0);
      expect(metrics.failures).toBe(0);
      expect(metrics.successes).toBe(0);
      expect(metrics.state).toBe(CircuitState.CLOSED);
    });
  });

  describe('execute', () => {
    it('should execute successful functions', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      
      const result = await breaker.execute(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalled();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should handle failures', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('failure'));
      
      await expect(breaker.execute(fn)).rejects.toThrow('failure');
      expect(fn).toHaveBeenCalled();
    });

    it('should track success metrics', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      
      await breaker.execute(fn);
      await breaker.execute(fn);
      
      const metrics = breaker.getMetrics();
      expect(metrics.successes).toBe(2);
    });

    it('should track failure metrics', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('failure'));
      
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      
      const metrics = breaker.getMetrics();
      expect(metrics.failures).toBe(2);
    });
  });

  describe('circuit opening', () => {
    it('should open after consecutive failures', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('failure'));
      
      // Fail 3 times (failure threshold)
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should reject requests when open', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      
      // Force open
      breaker.open();
      
      await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is open');
      expect(fn).not.toHaveBeenCalled();
      
      const metrics = breaker.getMetrics();
      expect(metrics.rejections).toBe(1);
    });

    it('should emit state-change event', async () => {
      const stateChangeSpy = jest.fn();
      breaker.on('state-change', stateChangeSpy);
      
      const fn = jest.fn().mockRejectedValue(new Error('failure'));
      
      // Fail 3 times to open
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      
      expect(stateChangeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-breaker',
          oldState: CircuitState.CLOSED,
          newState: CircuitState.OPEN,
        })
      );
    });
  });

  describe('circuit recovery', () => {
    it('should transition to HALF_OPEN after timeout', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('failure'));
      
      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      
      // Fast-forward past timeout
      jest.advanceTimersByTime(5001);
      
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('should close after successful requests in HALF_OPEN', async () => {
      // Open the circuit
      breaker.open();
      
      // Transition to HALF_OPEN
      jest.advanceTimersByTime(5001);
      
      const fn = jest.fn().mockResolvedValue('success');
      
      // Need 2 successes (successThreshold)
      await breaker.execute(fn);
      expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
      
      await breaker.execute(fn);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should reopen on failure in HALF_OPEN', async () => {
      // Open the circuit
      breaker.open();
      
      // Transition to HALF_OPEN
      jest.advanceTimersByTime(5001);
      
      const fn = jest.fn().mockRejectedValue(new Error('failure'));
      
      await expect(breaker.execute(fn)).rejects.toThrow();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });
  });

  describe('fallback', () => {
    it('should use fallback when circuit is open', async () => {
      const fallback = jest.fn().mockResolvedValue('fallback-value');
      const breakerWithFallback = new CircuitBreaker('fallback-breaker', {
        failureThreshold: 1,
        fallback,
      });
      
      const fn = jest.fn().mockRejectedValue(new Error('failure'));
      
      // Trigger failure to increment failure count (but fallback will be used)
      const firstResult = await breakerWithFallback.execute(fn);
      expect(firstResult).toBe('fallback-value');
      
      // Circuit should now be open, next call should use fallback
      const result = await breakerWithFallback.execute(fn);
      expect(result).toBe('fallback-value');
      expect(fallback).toHaveBeenCalled();
      
      const metrics = breakerWithFallback.getMetrics();
      expect(metrics.fallbacks).toBeGreaterThanOrEqual(1);
      
      breakerWithFallback.dispose();
    });
  });

  describe('manual control', () => {
    it('should manually open circuit', () => {
      breaker.open();
      expect(breaker.getState()).toBe(CircuitState.OPEN);
    });

    it('should manually close circuit', () => {
      breaker.open();
      breaker.close();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should reset circuit', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('failure'));
      
      // Generate some failures
      await expect(breaker.execute(fn)).rejects.toThrow();
      await expect(breaker.execute(fn)).rejects.toThrow();
      
      breaker.reset();
      
      const metrics = breaker.getMetrics();
      expect(metrics.failures).toBe(0);
      expect(metrics.successes).toBe(0);
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('events', () => {
    it('should emit success event', async () => {
      const successSpy = jest.fn();
      breaker.on('success', successSpy);
      
      const fn = jest.fn().mockResolvedValue('success');
      await breaker.execute(fn);
      
      expect(successSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-breaker',
          latency: expect.any(Number),
        })
      );
    });

    it('should emit failure event', async () => {
      const failureSpy = jest.fn();
      breaker.on('failure', failureSpy);
      
      const fn = jest.fn().mockRejectedValue(new Error('failure'));
      await expect(breaker.execute(fn)).rejects.toThrow();
      
      expect(failureSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-breaker',
          latency: expect.any(Number),
        })
      );
    });

    it('should emit rejected event', async () => {
      const rejectedSpy = jest.fn();
      breaker.on('rejected', rejectedSpy);
      
      breaker.open();
      
      const fn = jest.fn().mockResolvedValue('success');
      await expect(breaker.execute(fn)).rejects.toThrow();
      
      expect(rejectedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-breaker',
          state: CircuitState.OPEN,
        })
      );
    });
  });

  describe('error threshold percentage', () => {
    it('should open based on error percentage', async () => {
      const breaker = new CircuitBreaker('percentage-breaker', {
        failureThreshold: 10, // High threshold
        volumeThreshold: 4,
        errorThresholdPercentage: 50,
        windowSize: 60000,
      });
      
      const successFn = jest.fn().mockResolvedValue('success');
      const failFn = jest.fn().mockRejectedValue(new Error('failure'));
      
      // Create 50% error rate with 4 requests
      await breaker.execute(successFn);
      await breaker.execute(successFn);
      await expect(breaker.execute(failFn)).rejects.toThrow();
      await expect(breaker.execute(failFn)).rejects.toThrow();
      
      // Should be open due to 50% error rate
      expect(breaker.getState()).toBe(CircuitState.OPEN);
      
      breaker.dispose();
    });
  });
});

describe('CircuitBreakerRegistry', () => {
  afterEach(() => {
    circuitBreakerRegistry.disposeAll();
  });

  it('should create and retrieve breakers', () => {
    const breaker1 = circuitBreakerRegistry.getBreaker('test1');
    const breaker2 = circuitBreakerRegistry.getBreaker('test1');
    
    expect(breaker1).toBe(breaker2);
  });

  it('should remove breakers', () => {
    const breaker = circuitBreakerRegistry.getBreaker('removable');
    circuitBreakerRegistry.removeBreaker('removable');
    
    const newBreaker = circuitBreakerRegistry.getBreaker('removable');
    expect(newBreaker).not.toBe(breaker);
  });

  it('should get all breakers', () => {
    circuitBreakerRegistry.getBreaker('breaker1');
    circuitBreakerRegistry.getBreaker('breaker2');
    
    const allBreakers = circuitBreakerRegistry.getAllBreakers();
    expect(allBreakers.size).toBe(2);
    expect(allBreakers.has('breaker1')).toBe(true);
    expect(allBreakers.has('breaker2')).toBe(true);
  });

  it('should get all metrics', () => {
    circuitBreakerRegistry.getBreaker('metrics1');
    circuitBreakerRegistry.getBreaker('metrics2');
    
    const allMetrics = circuitBreakerRegistry.getAllMetrics();
    expect(Object.keys(allMetrics)).toHaveLength(2);
    expect(allMetrics).toHaveProperty('metrics1');
    expect(allMetrics).toHaveProperty('metrics2');
  });

  it('should reset all breakers', () => {
    const breaker1 = circuitBreakerRegistry.getBreaker('reset1');
    const breaker2 = circuitBreakerRegistry.getBreaker('reset2');
    
    breaker1.open();
    breaker2.open();
    
    circuitBreakerRegistry.resetAll();
    
    expect(breaker1.getState()).toBe(CircuitState.CLOSED);
    expect(breaker2.getState()).toBe(CircuitState.CLOSED);
  });

  it('should dispose all breakers', () => {
    const disposeSpy1 = jest.fn();
    const disposeSpy2 = jest.fn();
    
    const breaker1 = circuitBreakerRegistry.getBreaker('dispose1');
    const breaker2 = circuitBreakerRegistry.getBreaker('dispose2');
    
    breaker1.dispose = disposeSpy1;
    breaker2.dispose = disposeSpy2;
    
    circuitBreakerRegistry.disposeAll();
    
    expect(disposeSpy1).toHaveBeenCalled();
    expect(disposeSpy2).toHaveBeenCalled();
    
    const allBreakers = circuitBreakerRegistry.getAllBreakers();
    expect(allBreakers.size).toBe(0);
  });
});
