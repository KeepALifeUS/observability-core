/**
 * 2025 Circuit Breaker Service
 * Enterprise fault tolerance with advanced patterns
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { ICircuitBreakerConfig } from '../interfaces/observability.interface';

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half-open',
}

export interface CircuitBreakerStats {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  totalRequests: number;
  errorRate: number;
  lastFailureTime?: Date;
  lastSuccessTime?: Date;
  nextAttemptTime?: Date;
  metrics: {
    requestCount: number;
    failureCount: number;
    successCount: number;
    rejectedCount: number;
    timeoutCount: number;
    averageResponseTime: number;
    totalVolume: number;
  };
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  monitoringPeriod?: number;
  volumeThreshold?: number;
  slowCallThreshold?: number;
  slowCallRateThreshold?: number;
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private successes = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private nextAttemptTime?: Date;
  private readonly metrics = {
    requestCount: 0,
    failureCount: 0,
    successCount: 0,
    rejectedCount: 0,
    timeoutCount: 0,
    totalResponseTime: 0,
    totalVolume: 0,
  };

  constructor(
    private readonly name: string,
    private readonly options: Required<CircuitBreakerOptions>,
    private readonly eventEmitter: EventEmitter2,
    private readonly logger: Logger,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitState.HALF_OPEN;
        this.logger.debug(`🔄 Circuit breaker ${this.name} moved to HALF_OPEN state`);
        this.emitStateChange('half-open', 'reset_timeout_expired');
      } else {
        this.metrics.rejectedCount++;
        throw new Error(`Circuit breaker ${this.name} is OPEN - rejecting request`);
      }
    }

    return this.executeRequest(fn);
  }

  private async executeRequest<T>(fn: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    this.metrics.requestCount++;
    this.metrics.totalVolume++;

    try {
      // Execute request with timeout
      const result = await this.executeWithTimeout(fn);

      const responseTime = Date.now() - startTime;
      this.metrics.totalResponseTime += responseTime;

      // Check for slow calls
      if (responseTime > this.options.slowCallThreshold) {
        this.recordSlowCall();
      }

      // Record success
      this.recordSuccess();
      return result;

    } catch (error: unknown) {
      const responseTime = Date.now() - startTime;
      this.metrics.totalResponseTime += responseTime;

      // Record failure
      this.recordFailure(error as Error);
      throw error;
    }
  }

  private async executeWithTimeout<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.metrics.timeoutCount++;
        reject(new Error(`Request timeout after ${this.options.timeout}ms`));
      }, this.options.timeout);

      fn()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  private recordSuccess(): void {
    this.successes++;
    this.metrics.successCount++;
    this.lastSuccessTime = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.successes >= this.options.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.logger.log(`✅ Circuit breaker ${this.name} CLOSED - sufficient successes`);
        this.emitStateChange('closed', 'success_threshold_reached');
      }
    }
  }

  private recordFailure(_error: Error): void {
    this.failures++;
    this.metrics.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      // Immediately open on any failure in half-open state
      this.openCircuit('failure_in_half_open');
    } else if (this.state === CircuitState.CLOSED) {
      // Check if we should open the circuit
      if (this.shouldOpenCircuit()) {
        this.openCircuit('failure_threshold_exceeded');
      }
    }
  }

  private recordSlowCall(): void {
    // For simplicity, treating slow calls as failures
    // In a more sophisticated implementation, you might track them separately
    const slowCallRate = this.getSlowCallRate();
    if (slowCallRate > this.options.slowCallRateThreshold) {
      this.recordFailure(new Error('Slow call rate threshold exceeded'));
    }
  }

  private shouldOpenCircuit(): boolean {
    // Volume threshold check
    if (this.metrics.totalVolume < this.options.volumeThreshold) {
      return false;
    }

    // Failure threshold check
    if (this.failures >= this.options.failureThreshold) {
      return true;
    }

    // Error rate threshold check
    const errorRate = this.getErrorRate();
    return errorRate >= this.options.errorThresholdPercentage;
  }

  private shouldAttemptReset(): boolean {
    if (!this.nextAttemptTime) {
      this.nextAttemptTime = new Date(Date.now() + this.options.resetTimeout);
      return false;
    }

    return Date.now() >= this.nextAttemptTime.getTime();
  }

  private openCircuit(reason: string): void {
    this.state = CircuitState.OPEN;
    this.nextAttemptTime = new Date(Date.now() + this.options.resetTimeout);
    this.logger.warn(`🔴 Circuit breaker ${this.name} OPENED - reason: ${reason}`);
    this.emitStateChange('open', reason);
  }

  private emitStateChange(newState: string, reason: string): void {
    this.eventEmitter.emit('circuit-breaker.state-change', {
      name: this.name,
      oldState: this.state,
      newState,
      reason,
      timestamp: new Date(),
      stats: this.getStats(),
    });

    // Emit specific events
    this.eventEmitter.emit(`circuit-breaker.${newState}`, {
      name: this.name,
      reason,
      timestamp: new Date(),
      stats: this.getStats(),
    });
  }

  private getErrorRate(): number {
    const totalRequests = this.metrics.requestCount;
    if (totalRequests === 0) {return 0;}
    return (this.metrics.failureCount / totalRequests) * 100;
  }

  private getSlowCallRate(): number {
    // This is a simplified implementation
    // In practice, you'd track slow calls separately
    return 0;
  }

  getStats(): CircuitBreakerStats {
    const totalRequests = this.metrics.requestCount;
    const averageResponseTime = totalRequests > 0
      ? this.metrics.totalResponseTime / totalRequests
      : 0;

    const stats: CircuitBreakerStats = {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalRequests,
      errorRate: this.getErrorRate(),
      metrics: {
        ...this.metrics,
        averageResponseTime,
      },
    };

    // Conditionally add optional properties to avoid exactOptionalPropertyTypes issues
    if (this.lastFailureTime !== undefined) {
      stats.lastFailureTime = this.lastFailureTime;
    }
    if (this.lastSuccessTime !== undefined) {
      stats.lastSuccessTime = this.lastSuccessTime;
    }
    if (this.nextAttemptTime !== undefined) {
      stats.nextAttemptTime = this.nextAttemptTime;
    }

    return stats;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    delete this.nextAttemptTime;

    // Reset metrics
    Object.keys(this.metrics).forEach(key => {
      this.metrics[key as keyof typeof this.metrics] = 0;
    });

    this.logger.log(`🔄 Circuit breaker ${this.name} manually reset`);
    this.emitStateChange('closed', 'manual_reset');
  }
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private _isEnabled = false;
  private config!: ICircuitBreakerConfig;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private defaultOptions!: Required<CircuitBreakerOptions>;

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Check if service is enabled
   */
  public isEnabled(): boolean {
    return this._isEnabled;
  }

  /**
   * Initialize circuit breaker service
   */
  async initialize(config: ICircuitBreakerConfig): Promise<void> {
    this.config = config;

    if (!config.enabled) {
      this.logger.log('🔌 Circuit breaker is disabled');
      return;
    }

    try {
      this.logger.log('🔌 Initializing circuit breaker service...');

      // Set default options
      this.defaultOptions = {
        failureThreshold: config.default.failureThreshold,
        successThreshold: config.default.successThreshold,
        timeout: config.default.timeout,
        errorThresholdPercentage: config.default.errorThresholdPercentage,
        resetTimeout: config.default.resetTimeout,
        monitoringPeriod: config.default.monitoringPeriod,
        volumeThreshold: 10, // Minimum requests before error rate calculation
        slowCallThreshold: 5000, // 5 seconds
        slowCallRateThreshold: 50, // 50%
      };

      // Register event listeners
      this.registerEventListeners();

      this._isEnabled = true;

      this.logger.log('✅ Circuit breaker service initialized');
      this.logger.log(`⚙️ Default failure threshold: ${this.defaultOptions.failureThreshold}`);
      this.logger.log(`⚙️ Default timeout: ${this.defaultOptions.timeout}ms`);
      this.logger.log(`⚙️ Default reset timeout: ${this.defaultOptions.resetTimeout}ms`);

    } catch (error: unknown) {
      this.logger.error(`❌ Failed to initialize circuit breaker: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    options?: CircuitBreakerOptions,
  ): Promise<T> {
    if (!this._isEnabled) {
      // If circuit breaker is disabled, execute directly
      return await fn();
    }

    const circuitBreaker = this.getOrCreateCircuitBreaker(name, options);
    return await circuitBreaker.execute(fn);
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(name?: string): CircuitBreakerStats | CircuitBreakerStats[] {
    if (name) {
      const circuitBreaker = this.circuitBreakers.get(name);
      if (!circuitBreaker) {
        throw new Error(`Circuit breaker '${name}' not found`);
      }
      return circuitBreaker.getStats();
    }

    // Return all circuit breaker stats
    return Array.from(this.circuitBreakers.values()).map(cb => cb.getStats());
  }

  /**
   * Reset circuit breaker
   */
  reset(name: string): void {
    const circuitBreaker = this.circuitBreakers.get(name);
    if (!circuitBreaker) {
      throw new Error(`Circuit breaker '${name}' not found`);
    }

    circuitBreaker.reset();
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const circuitBreaker of this.circuitBreakers.values()) {
      circuitBreaker.reset();
    }
    this.logger.log('🔄 All circuit breakers reset');
  }

  /**
   * Get list of circuit breaker names
   */
  getCircuitBreakerNames(): string[] {
    return Array.from(this.circuitBreakers.keys());
  }

  /**
   * Check if circuit breaker exists
   */
  hasCircuitBreaker(name: string): boolean {
    return this.circuitBreakers.has(name);
  }

  /**
   * Remove circuit breaker
   */
  removeCircuitBreaker(name: string): boolean {
    const removed = this.circuitBreakers.delete(name);
    if (removed) {
      this.logger.debug(`🗑️ Removed circuit breaker: ${name}`);
    }
    return removed;
  }

  /**
   * Check if service is enabled
   */
  getIsEnabled(): boolean {
    return this._isEnabled;
  }

  /**
   * Shutdown circuit breaker service
   */
  async shutdown(): Promise<void> {
    this.circuitBreakers.clear();
    this._isEnabled = false;
    this.logger.log('🔌 Circuit breaker service shutdown completed');
  }

  /**
   * Get or create circuit breaker for a specific service/operation
   */
  private getOrCreateCircuitBreaker(
    name: string,
    options?: CircuitBreakerOptions,
  ): CircuitBreaker {
    let circuitBreaker = this.circuitBreakers.get(name);

    if (!circuitBreaker) {
      // Merge options with defaults and service-specific config
      const serviceConfig = this.config.services[name] || {};
      const mergedOptions: Required<CircuitBreakerOptions> = {
        ...this.defaultOptions,
        ...serviceConfig,
        ...options,
      };

      circuitBreaker = new CircuitBreaker(
        name,
        mergedOptions,
        this.eventEmitter,
        this.logger,
      );

      this.circuitBreakers.set(name, circuitBreaker);
      this.logger.debug(`🔌 Created circuit breaker: ${name}`);
    }

    return circuitBreaker;
  }

  /**
   * Register event listeners for cross-component communication
   */
  private registerEventListeners(): void {
    // Listen for circuit breaker state changes
    this.eventEmitter.on('circuit-breaker.state-change', (data) => {
      this.logger.log(
        `🔌 Circuit breaker ${data.name}: ${data.oldState} → ${data.newState} (${data.reason})`
      );
    });

    // Listen for circuit breaker opened events
    this.eventEmitter.on('circuit-breaker.open', (data) => {
      this.logger.warn(
        `🔴 Circuit breaker ${data.name} OPENED: ${data.reason}` +
        ` | Failures: ${data.stats.failures}` +
        ` | Error Rate: ${data.stats.errorRate.toFixed(2)}%`
      );
    });

    // Listen for circuit breaker closed events
    this.eventEmitter.on('circuit-breaker.closed', (data) => {
      this.logger.log(
        `✅ Circuit breaker ${data.name} CLOSED: ${data.reason}` +
        ` | Successes: ${data.stats.successes}`
      );
    });

    // Listen for health check failures to potentially trigger circuit breakers
    this.eventEmitter.on('health.check.unhealthy', (healthResult) => {
      this.handleHealthCheckFailure(healthResult);
    });
  }

  /**
   * Handle health check failures by potentially opening related circuit breakers
   */
  private handleHealthCheckFailure(healthResult: any): void {
    // Find circuit breakers related to failed health checks
    for (const [checkName, checkResult] of Object.entries(healthResult.details)) {
      if ((checkResult as any).status === 'unhealthy') {
        // If there's a circuit breaker for this service, we might want to open it
        // This is a simplified implementation - in practice, you'd have more sophisticated logic
        if (this.circuitBreakers.has(checkName)) {
          this.logger.warn(
            `⚠️ Health check failed for ${checkName}, circuit breaker may be affected`
          );
        }
      }
    }
  }
}