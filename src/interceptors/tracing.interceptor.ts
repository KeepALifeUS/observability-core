/**
 * 2025 Tracing Interceptor
 * Production-ready distributed tracing interceptor with OpenTelemetry
 *
 * Features:
 * - Creates OpenTelemetry spans for all requests
 * - Propagates trace context across services
 * - Adds comprehensive span attributes
 * - Integrates with TracingService
 * - Records exceptions in spans
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

import { ISpan } from '../interfaces/observability.interface';
import { TracingService } from '../services/tracing.service';

/**
 * 2025 Pattern: HTTP semantic attributes
 * Based on OpenTelemetry semantic conventions
 */
export interface HttpSpanAttributes {
  'http.method': string;
  'http.url': string;
  'http.route'?: string;
  'http.target': string;
  'http.host': string;
  'http.scheme': string;
  'http.status_code'?: number;
  'http.user_agent'?: string;
  'http.request_content_length'?: number;
  'http.response_content_length'?: number;
  'http.client_ip'?: string;
  'user.id'?: string;
  'user.session'?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * 2025 Pattern: Tracing Interceptor
 * Automatic distributed tracing for all HTTP requests
 */
@Injectable()
export class TracingInterceptor implements NestInterceptor {
  constructor(private readonly tracingService: TracingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Skip if tracing is disabled
    if (!this.tracingService.isEnabled()) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    // Extract trace context from incoming request
    const parentTraceContext = this.tracingService.extract(request.headers);

    // Create span name from route
    const spanName = this.buildSpanName(context, request);

    // Build span attributes
    const spanAttributes = this.buildSpanAttributes(request, context);

    // Start the span
    let span: ISpan | null = null;

    // Create observable from promise
    return new Observable((subscriber) => {
      this.tracingService.withSpan(
        spanName,
        async (createdSpan) => {
          span = createdSpan;

          // Add attributes to span
          Object.entries(spanAttributes).forEach(([key, value]) => {
            if (value !== undefined) {
              span!.setTag(key, value);
            }
          });

          // Inject trace context into response headers
          const carrier: Record<string, string> = {};
          this.tracingService.inject(carrier);
          Object.entries(carrier).forEach(([key, value]) => {
            response.header(key, value);
          });

          // Store span in request for other interceptors/guards
          (request as any).span = span;
          (request as any).traceContext = this.tracingService.getCurrentTraceContext();

          // Execute request handler
          return new Promise((resolve, reject) => {
            next
              .handle()
              .pipe(
                tap((responseData) => {
                  // Request succeeded
                  const duration = Date.now() - startTime;
                  const statusCode = response.statusCode || 200;

                  // Update span with response information
                  this.updateSpanWithResponse(
                    span!,
                    statusCode,
                    duration,
                    responseData,
                  );

                  // Add event for successful completion
                  span!.addEvent('http.request.completed', {
                    'http.status_code': statusCode,
                    'duration.ms': duration,
                  });

                  // Set span status to OK
                  span!.setStatus({ code: SpanStatusCode.OK });

                  resolve(responseData);
                }),
                catchError((error) => {
                  // Request failed
                  const duration = Date.now() - startTime;
                  const statusCode = this.extractStatusCode(error);

                  // Update span with error information
                  this.updateSpanWithError(span!, error, statusCode, duration);

                  // Record exception in span
                  span!.recordException(error);

                  // Add event for error
                  span!.addEvent('http.request.error', {
                    'error.type': error.name || 'Error',
                    'error.message': error.message || 'Unknown error',
                    'http.status_code': statusCode,
                    'duration.ms': duration,
                  });

                  // Set span status to ERROR
                  span!.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error.message || 'Request failed',
                  });

                  reject(error);
                  return throwError(() => error);
                }),
              )
              .subscribe({
                next: (data) => resolve(data),
                error: (err) => reject(err),
              });
          });
        },
        {
          kind: SpanKind.SERVER,
          attributes: spanAttributes,
          ...(parentTraceContext && { parent: parentTraceContext }),
        },
      )
        .then((data) => {
          subscriber.next(data);
          subscriber.complete();
        })
        .catch((error) => {
          subscriber.error(error);
        });
    });
  }

  /**
   * Build span name from execution context and request
   */
  private buildSpanName(context: ExecutionContext, request: Request): string {
    const method = request.method;
    const route = this.extractRoute(request);

    // Try to get controller and handler names
    const controllerName = context.getClass().name;
    const handlerName = context.getHandler().name;

    // Prefer route pattern if available, otherwise use controller.handler
    if (route && route !== request.path) {
      return `${method} ${route}`;
    }

    return `${controllerName}.${handlerName}`;
  }

  /**
   * Build comprehensive span attributes following OpenTelemetry conventions
   */
  private buildSpanAttributes(
    request: Request,
    context: ExecutionContext,
  ): HttpSpanAttributes {
    const method = request.method;
    const url = this.buildFullUrl(request);
    const route = this.extractRoute(request);
    const host = request.headers.host || 'unknown';
    const scheme = request.protocol;

    const attributes: HttpSpanAttributes = {
      // HTTP attributes
      'http.method': method,
      'http.url': url,
      'http.target': request.url,
      'http.host': host,
      'http.scheme': scheme,

      // Service attributes
      'service.name': process.env['SERVICE_NAME'] || '-service',
      'service.version': process.env['SERVICE_VERSION'] || '5.0.0',
      'service.environment': process.env['NODE_ENV'] || 'development',

      // NestJS attributes
      'nestjs.controller': context.getClass().name,
      'nestjs.handler': context.getHandler().name,
    };

    // Add optional attributes
    const userAgent = request.headers['user-agent'];
    if (userAgent) {
      attributes['http.user_agent'] = userAgent;
    }

    const clientIp = request.ip || request.connection.remoteAddress;
    if (clientIp) {
      attributes['http.client_ip'] = clientIp;
    }

    const contentLength = this.getContentLength(request.headers['content-length']);
    if (contentLength !== undefined) {
      attributes['http.request_content_length'] = contentLength;
    }

    // Add route if available
    if (route) {
      attributes['http.route'] = route;
    }

    // Add user information if available
    const user = (request as any).user;
    if (user) {
      attributes['user.id'] = user.id || user.sub;
      if (user.email) {
        attributes['user.email'] = user.email;
      }
    }

    // Add session information if available
    const sessionId = (request as any).sessionId;
    if (sessionId) {
      attributes['user.session'] = sessionId;
    }

    // Add correlation ID if available
    const correlationId =
      request.headers['x-correlation-id'] || request.headers['x-request-id'];
    if (correlationId) {
      attributes['correlation.id'] = correlationId as string;
    }

    // Add custom trading-specific attributes
    this.addTradingAttributes(attributes, request);

    return attributes;
  }

  /**
   * Add trading-specific attributes to span
   */
  private addTradingAttributes(
    attributes: HttpSpanAttributes,
    request: Request,
  ): void {
    // Extract trading symbol if present
    const symbol =
      request.params['symbol'] || request.body?.symbol || request.query['symbol'];
    if (symbol) {
      attributes['trading.symbol'] = symbol as string;
    }

    // Extract order type if present
    const orderType = request.body?.type || request.query['type'];
    if (orderType) {
      attributes['trading.order_type'] = orderType as string;
    }

    // Extract exchange if present
    const exchange =
      request.body?.exchange || request.query['exchange'] || request.headers['x-exchange'];
    if (exchange) {
      attributes['trading.exchange'] = exchange as string;
    }

    // Extract strategy if present
    const strategy = request.body?.strategy || request.query['strategy'];
    if (strategy) {
      attributes['trading.strategy'] = strategy as string;
    }
  }

  /**
   * Update span with response information
   */
  private updateSpanWithResponse(
    span: ISpan,
    statusCode: number,
    duration: number,
    responseData: any,
  ): void {
    span.setTag('http.status_code', statusCode);
    span.setTag('duration.ms', duration);

    // Add response size if available
    const responseSize = this.estimateSize(responseData);
    if (responseSize > 0) {
      span.setTag('http.response_content_length', responseSize);
    }

    // Mark as slow request if needed
    if (duration > 1000) {
      span.setTag('slow.request', true);
      span.addEvent('slow_request_detected', {
        'duration.ms': duration,
        'threshold.ms': 1000,
      });
    }
  }

  /**
   * Update span with error information
   */
  private updateSpanWithError(
    span: ISpan,
    error: any,
    statusCode: number,
    duration: number,
  ): void {
    span.setTag('http.status_code', statusCode);
    span.setTag('duration.ms', duration);
    span.setTag('error', true);
    span.setTag('error.type', error.name || 'Error');
    span.setTag('error.message', error.message || 'Unknown error');

    if (error.stack) {
      span.setTag('error.stack', error.stack);
    }

    // Add error category if available
    if (error.category) {
      span.setTag('error.category', error.category);
    }

    if (error.code) {
      span.setTag('error.code', error.code);
    }
  }

  /**
   * Extract route pattern from request
   */
  private extractRoute(request: Request): string {
    if (request.route?.path) {
      return request.route.path;
    }
    return this.normalizeRoute(request.path);
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
   * Build full URL from request
   */
  private buildFullUrl(request: Request): string {
    const protocol = request.protocol;
    const host = request.headers.host;
    const path = request.url;
    return `${protocol}://${host}${path}`;
  }

  /**
   * Get content length from header
   */
  private getContentLength(contentLength: string | undefined): number | undefined {
    if (!contentLength) {return undefined;}
    const length = parseInt(contentLength, 10);
    return isNaN(length) ? undefined : length;
  }

  /**
   * Estimate size of data
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
}
