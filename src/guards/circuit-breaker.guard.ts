/**
 * 2025 Circuit Breaker Guard
 * Production-ready NestJS guard with circuit breaker protection
 *
 * Implements:
 * - Pre-request circuit breaker state checking
 * - Automatic circuit opening on failures
 * - Metrics recording for all states
 * - Proper error responses when circuit is open
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { CircuitBreakerService, CircuitState } from '../services/circuit-breaker.service';
import { MetricsService } from '../services/metrics.service';

/**
 * 2025 Pattern: Circuit breaker metadata decorator
 */
export const CIRCUIT_BREAKER_KEY = 'circuit-breaker';

export interface CircuitBreakerOptions {
  name: string;
  enabled?: boolean;
  failureThreshold?: number;
  timeout?: number;
  errorThresholdPercentage?: number;
}

/**
 * Decorator circuit breaker endpoint
 */
export const UseCircuitBreaker = (options: CircuitBreakerOptions) => {
  return (target: any, _propertyKey?: string, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      // Method decorator
      Reflect.defineMetadata(CIRCUIT_BREAKER_KEY, options, descriptor.value);
      return descriptor;
    }
    // Class decorator
    Reflect.defineMetadata(CIRCUIT_BREAKER_KEY, options, target);
    return target;
  };
};

/**
 * 2025 Pattern: Circuit Breaker Guard
 * Protects endpoints from cascading failures with circuit breaker pattern
 */
@Injectable()
export class CircuitBreakerGuard implements CanActivate {
  private readonly logger = new Logger(CircuitBreakerGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly metricsService: MetricsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if circuit breaker service is enabled
    if (!this.circuitBreakerService.isEnabled()) {
      return true;
    }

    // Extract circuit breaker options from metadata
    const options = this.extractCircuitBreakerOptions(context);

    if (!options || options.enabled === false) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const circuitName = options.name || this.getDefaultCircuitName(context);

    try {
      // Get circuit breaker stats
      const stats = this.circuitBreakerService.getStats(circuitName);

      if (Array.isArray(stats)) {
        // No circuit breaker exists yet, allow request
        return true;
      }

      // Check circuit breaker state
      if (stats.state === CircuitState.OPEN) {
        // Circuit is open - reject request
        this.logger.warn(
          `Circuit breaker ${circuitName} is OPEN - rejecting request`,
          {
            circuitName,
            state: stats.state,
            failures: stats.failures,
            errorRate: stats.errorRate,
            totalRequests: stats.totalRequests,
            path: request.path,
            method: request.method,
          },
        );

        // Record metrics for rejected request
        if (this.metricsService.isEnabled()) {
          this.metricsService.updateCircuitBreaker(
            this.getServiceName(),
            circuitName,
            'open',
            stats.failures,
            'request_rejected',
          );
        }

        // Throw service unavailable exception with retry information
        throw new ServiceUnavailableException({
          message: 'Service temporarily unavailable due to high error rate',
          errorCode: 'CIRCUIT_BREAKER_OPEN',
          circuitName,
          retryAfter: this.calculateRetryAfter(stats),
          nextAttemptTime: stats.nextAttemptTime,
          errorRate: stats.errorRate,
          totalRequests: stats.totalRequests,
        });
      }

      // Circuit is closed or half-open - allow request
      if (stats.state === CircuitState.HALF_OPEN) {
        this.logger.debug(
          `Circuit breaker ${circuitName} is HALF_OPEN - allowing test request`,
          {
            circuitName,
            successes: stats.successes,
          },
        );
      }

      // Store circuit breaker info in request for later use
      (request as any).circuitBreaker = {
        name: circuitName,
        state: stats.state,
        options,
      };

      return true;

    } catch (error) {
      // If error is already ServiceUnavailableException, re-throw it
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }

      // For any other error, log it and allow request
      this.logger.error(
        `Error checking circuit breaker ${circuitName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return true;
    }
  }

  /**
   * Extract circuit breaker options from execution context
   */
  private extractCircuitBreakerOptions(
    context: ExecutionContext,
  ): CircuitBreakerOptions | undefined {
    // Check method-level metadata first
    const handler = context.getHandler();
    let options = this.reflector.get<CircuitBreakerOptions>(
      CIRCUIT_BREAKER_KEY,
      handler,
    );

    // If not found, check class-level metadata
    if (!options) {
      const controller = context.getClass();
      options = this.reflector.get<CircuitBreakerOptions>(
        CIRCUIT_BREAKER_KEY,
        controller,
      );
    }

    return options;
  }

  /**
   * Generate default circuit breaker name from context
   */
  private getDefaultCircuitName(context: ExecutionContext): string {
    const controller = context.getClass();
    const handler = context.getHandler();
    return `${controller.name}.${handler.name}`;
  }

  /**
   * Get service name from environment
   */
  private getServiceName(): string {
    return process.env['SERVICE_NAME'] || '-service';
  }

  /**
   * Calculate retry-after time in seconds
   */
  private calculateRetryAfter(stats: any): number {
    if (stats.nextAttemptTime) {
      const now = Date.now();
      const nextAttempt = new Date(stats.nextAttemptTime).getTime();
      const secondsUntilRetry = Math.ceil((nextAttempt - now) / 1000);
      return Math.max(secondsUntilRetry, 1);
    }
    return 30; // Default 30 seconds
  }
}
