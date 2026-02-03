/**
 * 2025 Metrics Interceptor
 * Production-ready metrics collection interceptor for all HTTP requests
 *
 * Records:
 * - Request duration (histogram)
 * - Request count by method/route/status
 * - Request/response sizes
 * - Error counts and rates
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

import { MetricsService } from '../services/metrics.service';

/**
 * 2025 Pattern: Request metrics metadata
 */
export interface RequestMetrics {
  method: string;
  route: string;
  startTime: number;
  requestSize: number;
}

/**
 * 2025 Pattern: Metrics Interceptor
 * Automatic metrics collection for all HTTP requests
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MetricsInterceptor.name);

  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Skip if metrics service is disabled
    if (!this.metricsService.isEnabled()) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const startTime = Date.now();
    const method = request.method;
    const route = this.extractRoute(request);
    const requestSize = this.getRequestSize(request);

    // Store metrics metadata in request for later use
    (request as any).metrics = {
      method,
      route,
      startTime,
      requestSize,
    } as RequestMetrics;

    return next.handle().pipe(
      tap((responseData) => {
        // Request succeeded - record success metrics
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode || 200;
        const responseSize = this.estimateResponseSize(responseData);

        this.recordSuccessMetrics(
          method,
          route,
          statusCode,
          duration,
          requestSize,
          responseSize,
        );

        // Log slow requests
        if (duration > 1000) {
          this.logger.warn(`Slow request detected: ${method} ${route} took ${duration}ms`, {
            method,
            route,
            duration,
            statusCode,
          });
        }
      }),
      catchError((error) => {
        // Request failed - record error metrics
        const duration = Date.now() - startTime;
        const statusCode = this.extractStatusCode(error);

        this.recordErrorMetrics(
          method,
          route,
          statusCode,
          duration,
          requestSize,
          error,
        );

        // Re-throw the error
        return throwError(() => error);
      }),
    );
  }

  /**
   * Record metrics for successful requests
   */
  private recordSuccessMetrics(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    requestSize: number,
    responseSize: number,
  ): void {
    try {
      this.metricsService.recordHttpRequest(
        method,
        route,
        statusCode,
        duration,
        requestSize,
        responseSize,
      );

      // Log detailed metrics in debug mode
      this.logger.debug(`Request metrics recorded: ${method} ${route}`, {
        statusCode,
        duration,
        requestSize,
        responseSize,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record success metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Record metrics for failed requests
   */
  private recordErrorMetrics(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    requestSize: number,
    error: any,
  ): void {
    try {
      // Record HTTP request metrics with error status
      this.metricsService.recordHttpRequest(
        method,
        route,
        statusCode,
        duration,
        requestSize,
        0, // Error responses typically have minimal size
      );

      // Record error-specific metrics
      const service = process.env['SERVICE_NAME'] || '-service';
      const errorType = this.categorizeError(error);
      const severity = this.determineErrorSeverity(statusCode);

      this.metricsService.recordError(service, errorType, severity);

      // Log error metrics
      this.logger.debug(`Error metrics recorded: ${method} ${route}`, {
        statusCode,
        duration,
        errorType,
        severity,
      });
    } catch (metricsError) {
      this.logger.error(
        `Failed to record error metrics: ${metricsError instanceof Error ? metricsError.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Extract route pattern from request
   */
  private extractRoute(request: Request): string {
    // Try to get route pattern from NestJS route
    if (request.route?.path) {
      return request.route.path;
    }

    // Fallback to path with parameter normalization
    return this.normalizeRoute(request.path);
  }

  /**
   * Normalize route by replacing IDs/UUIDs with placeholders
   */
  private normalizeRoute(path: string): string {
    return path
      // Replace UUIDs with :id
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '/:id',
      )
      // Replace numeric IDs with :id
      .replace(/\/\d+/g, '/:id')
      // Replace common symbols (BTC, ETH, etc.) with :symbol
      .replace(/\/[A-Z]{3,10}(USDT|USD|BTC|ETH)?/g, '/:symbol');
  }

  /**
   * Get request size from Content-Length header or body
   */
  private getRequestSize(request: Request): number {
    const contentLength = request.headers['content-length'];
    if (contentLength) {
      return parseInt(contentLength, 10);
    }

    // Estimate from body if available
    if (request.body) {
      try {
        return JSON.stringify(request.body).length;
      } catch {
        return 0;
      }
    }

    return 0;
  }

  /**
   * Estimate response size
   */
  private estimateResponseSize(data: any): number {
    if (!data) {return 0;}

    try {
      if (typeof data === 'string') {
        return data.length;
      }
      if (Buffer.isBuffer(data)) {
        return data.length;
      }
      if (typeof data === 'object') {
        return JSON.stringify(data).length;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /**
   * Extract HTTP status code from error
   */
  private extractStatusCode(error: any): number {
    if (error.status) {return error.status;}
    if (error.statusCode) {return error.statusCode;}
    if (error.getStatus && typeof error.getStatus === 'function') {
      return error.getStatus();
    }
    return 500; // Default to internal server error
  }

  /**
   * Categorize error type for metrics
   */
  private categorizeError(error: any): string {
    const statusCode = this.extractStatusCode(error);

    if (statusCode === 401) {return 'authentication';}
    if (statusCode === 403) {return 'authorization';}
    if (statusCode === 404) {return 'not_found';}
    if (statusCode === 422) {return 'validation';}
    if (statusCode === 429) {return 'rate_limit';}
    if (statusCode >= 400 && statusCode < 500) {return 'client_error';}
    if (statusCode >= 500) {return 'server_error';}

    // Check error message for specific types
    if (error.message) {
      const message = error.message.toLowerCase();
      if (message.includes('database')) {return 'database';}
      if (message.includes('network')) {return 'network';}
      if (message.includes('timeout')) {return 'timeout';}
      if (message.includes('validation')) {return 'validation';}
    }

    return 'unknown';
  }

  /**
   * Determine error severity from status code
   */
  private determineErrorSeverity(
    statusCode: number,
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (statusCode >= 500) {return 'high';}
    if (statusCode === 429 || statusCode === 503) {return 'medium';}
    if (statusCode >= 400 && statusCode < 500) {return 'low';}
    return 'medium';
  }
}
