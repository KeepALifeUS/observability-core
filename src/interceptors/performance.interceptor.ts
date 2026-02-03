/**
 * 2025 Performance Interceptor
 * Production-ready performance monitoring for request handling
 *
 * Features:
 * - Measures request performance
 * - Detects slow requests (configurable threshold)
 * - Logs performance warnings
 * - Integrates with APM service
 * - Records transaction timing
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
import { tap, catchError, finalize } from 'rxjs/operators';

import { APMService } from '../services/apm.service';
import { MetricsService } from '../services/metrics.service';

/**
 * 2025 Pattern: Performance thresholds configuration
 */
export interface PerformanceThresholds {
  slowRequestWarning: number; // ms
  slowRequestCritical: number; // ms
  enableDetailedLogging: boolean;
  trackMemoryUsage: boolean;
}

/**
 * 2025 Pattern: Performance measurement data
 */
export interface PerformanceData {
  startTime: number;
  endTime?: number;
  duration?: number;
  memoryBefore?: NodeJS.MemoryUsage;
  memoryAfter?: NodeJS.MemoryUsage;
  memoryDelta?: number;
  cpuBefore?: NodeJS.CpuUsage;
  cpuAfter?: NodeJS.CpuUsage;
  cpuDelta?: number;
}

/**
 * 2025 Pattern: Performance Interceptor
 * Comprehensive performance monitoring with APM integration
 */
@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PerformanceInterceptor.name);
  private readonly thresholds: PerformanceThresholds;

  constructor(
    private readonly apmService: APMService,
    private readonly metricsService: MetricsService,
  ) {
    // Initialize thresholds from environment or use defaults
    this.thresholds = {
      slowRequestWarning: parseInt(
        process.env['PERFORMANCE_SLOW_REQUEST_WARNING'] || '500',
        10,
      ),
      slowRequestCritical: parseInt(
        process.env['PERFORMANCE_SLOW_REQUEST_CRITICAL'] || '2000',
        10,
      ),
      enableDetailedLogging:
        process.env['PERFORMANCE_DETAILED_LOGGING'] === 'true',
      trackMemoryUsage: process.env['PERFORMANCE_TRACK_MEMORY'] === 'true',
    };
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Initialize performance tracking
    const performanceData = this.initializePerformanceTracking();
    const method = request.method;
    const url = request.url;
    const route = this.extractRoute(request);

    // Start APM transaction if available
    let transactionId = (request as any).transactionId;
    if (!transactionId && this.apmService.isEnabled()) {
      transactionId = this.startAPMTransaction(method, route, request);
      (request as any).transactionId = transactionId;
    }

    // Store performance data in request
    (request as any).performanceData = performanceData;

    return next.handle().pipe(
      tap((responseData) => {
        // Request succeeded
        this.finalizePerformanceTracking(performanceData);

        const statusCode = response.statusCode || 200;

        // Check performance and log warnings
        this.checkPerformanceThresholds(
          performanceData,
          method,
          route,
          statusCode,
          'success',
        );

        // End APM transaction
        if (transactionId && this.apmService.isEnabled()) {
          void this.apmService.endTransaction(transactionId, 'success', {
            duration: performanceData.duration,
            statusCode,
            responseSize: this.estimateSize(responseData),
          });
        }

        // Record detailed performance metrics
        if (this.thresholds.enableDetailedLogging) {
          this.logDetailedPerformance(
            performanceData,
            method,
            url,
            statusCode,
            responseData,
          );
        }
      }),
      catchError((error) => {
        // Request failed
        this.finalizePerformanceTracking(performanceData);

        const statusCode = this.extractStatusCode(error);

        // Check performance even for errors
        this.checkPerformanceThresholds(
          performanceData,
          method,
          route,
          statusCode,
          'error',
        );

        // End APM transaction with error
        if (transactionId && this.apmService.isEnabled()) {
          void this.apmService.endTransaction(transactionId, 'error', {
            duration: performanceData.duration,
            statusCode,
            error: error.message,
          });
        }

        return throwError(() => error);
      }),
      finalize(() => {
        // Always finalize performance tracking
        if (!performanceData.endTime) {
          this.finalizePerformanceTracking(performanceData);
        }
      }),
    );
  }

  /**
   * Initialize performance tracking with baseline measurements
   */
  private initializePerformanceTracking(): PerformanceData {
    const performanceData: PerformanceData = {
      startTime: Date.now(),
    };

    if (this.thresholds.trackMemoryUsage) {
      performanceData.memoryBefore = process.memoryUsage();
      performanceData.cpuBefore = process.cpuUsage();
    }

    return performanceData;
  }

  /**
   * Finalize performance tracking with end measurements
   */
  private finalizePerformanceTracking(performanceData: PerformanceData): void {
    performanceData.endTime = Date.now();
    performanceData.duration = performanceData.endTime - performanceData.startTime;

    if (this.thresholds.trackMemoryUsage && performanceData.memoryBefore) {
      performanceData.memoryAfter = process.memoryUsage();
      performanceData.memoryDelta =
        performanceData.memoryAfter.heapUsed - performanceData.memoryBefore.heapUsed;

      if (performanceData.cpuBefore) {
        performanceData.cpuAfter = process.cpuUsage(performanceData.cpuBefore);
        performanceData.cpuDelta =
          (performanceData.cpuAfter.user + performanceData.cpuAfter.system) / 1000;
      }
    }
  }

  /**
   * Check performance thresholds and log warnings
   */
  private checkPerformanceThresholds(
    performanceData: PerformanceData,
    method: string,
    route: string,
    statusCode: number,
    result: 'success' | 'error',
  ): void {
    if (!performanceData.duration) {return;}

    const duration = performanceData.duration;

    // Check critical threshold
    if (duration >= this.thresholds.slowRequestCritical) {
      this.logger.error(
        `🐌 CRITICAL: Very slow request detected - ${method} ${route}`,
        {
          duration: `${duration}ms`,
          threshold: `${this.thresholds.slowRequestCritical}ms`,
          statusCode,
          result,
          method,
          route,
          memoryDelta: performanceData.memoryDelta
            ? `${Math.round(performanceData.memoryDelta / 1024 / 1024)}MB`
            : undefined,
          cpuDelta: performanceData.cpuDelta
            ? `${Math.round(performanceData.cpuDelta)}ms`
            : undefined,
        },
      );

      // Record critical slow request in metrics
      if (this.metricsService.isEnabled()) {
        this.metricsService.recordError(
          process.env['SERVICE_NAME'] || '-service',
          'slow_request_critical',
          'high',
        );
      }
    }
    // Check warning threshold
    else if (duration >= this.thresholds.slowRequestWarning) {
      this.logger.warn(
        `⚠️ WARNING: Slow request detected - ${method} ${route}`,
        {
          duration: `${duration}ms`,
          threshold: `${this.thresholds.slowRequestWarning}ms`,
          statusCode,
          result,
          method,
          route,
        },
      );
    }

    // Check memory usage if enabled
    if (
      this.thresholds.trackMemoryUsage &&
      performanceData.memoryDelta &&
      performanceData.memoryDelta > 50 * 1024 * 1024
    ) {
      // > 50MB
      this.logger.warn(
        `💾 High memory usage detected - ${method} ${route}`,
        {
          memoryDelta: `${Math.round(performanceData.memoryDelta / 1024 / 1024)}MB`,
          duration: `${duration}ms`,
          method,
          route,
        },
      );
    }
  }

  /**
   * Log detailed performance metrics
   */
  private logDetailedPerformance(
    performanceData: PerformanceData,
    method: string,
    url: string,
    statusCode: number,
    responseData: any,
  ): void {
    const logData: any = {
      duration: performanceData.duration,
      statusCode,
      method,
      url,
      responseSize: this.estimateSize(responseData),
    };

    if (performanceData.memoryDelta !== undefined) {
      logData.memoryDelta = Math.round(performanceData.memoryDelta / 1024); // KB
      logData.memoryBefore = Math.round(
        (performanceData.memoryBefore?.heapUsed || 0) / 1024 / 1024,
      ); // MB
      logData.memoryAfter = Math.round(
        (performanceData.memoryAfter?.heapUsed || 0) / 1024 / 1024,
      ); // MB
    }

    if (performanceData.cpuDelta !== undefined) {
      logData.cpuTime = Math.round(performanceData.cpuDelta); // ms
    }

    this.logger.debug(`Performance metrics: ${method} ${url}`, logData);
  }

  /**
   * Start APM transaction
   */
  private startAPMTransaction(
    method: string,
    route: string,
    request: Request,
  ): string | Promise<string> {
    const transactionName = `${method} ${route}`;
    const context = {
      user: (request as any).user,
      session: (request as any).sessionId,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };

    return this.apmService.startTransaction(transactionName, 'web', context);
  }

  /**
   * Extract route pattern
   */
  private extractRoute(request: Request): string {
    return request.route?.path || this.normalizeRoute(request.path);
  }

  /**
   * Normalize route by replacing IDs with placeholders
   */
  private normalizeRoute(path: string): string {
    return path
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '/:id',
      )
      .replace(/\/\d+/g, '/:id')
      .replace(/\/[A-Z]{3,10}(USDT|USD|BTC|ETH)?/g, '/:symbol');
  }

  /**
   * Extract status code from error
   */
  private extractStatusCode(error: any): number {
    if (error.status) {return error.status;}
    if (error.statusCode) {return error.statusCode;}
    if (error.getStatus && typeof error.getStatus === 'function') {
      return error.getStatus();
    }
    return 500;
  }

  /**
   * Estimate size of response data
   */
  private estimateSize(data: any): number {
    if (!data) {return 0;}
    try {
      if (typeof data === 'string') {return data.length;}
      if (Buffer.isBuffer(data)) {return data.length;}
      if (typeof data === 'object') {return JSON.stringify(data).length;}
      return 0;
    } catch {
      return 0;
    }
  }
}
