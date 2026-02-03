/**
 * 2025 Observability Exception Filter
 * Production-ready exception filter with observability integration
 *
 * Extends GlobalExceptionFilter pattern with:
 * - Automatic metrics recording
 * - SLI tracking for error rates
 * - Circuit breaker integration
 * - APM error tracking
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  Injectable,
} from '@nestjs/common';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { APMService } from '../services/apm.service';
import { MetricsService } from '../services/metrics.service';
import { SLIService } from '../services/sli.service';

/**
 * 2025 Pattern: RFC 7807 Problem Details with Observability
 */
export interface ObservabilityProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  timestamp: string;
  correlationId: string;
  traceId?: string;
  spanId?: string;
  errorId: string;
  errorCode: string;
  category: string;
  severity: string;
  retryable: boolean;
  userMessage?: string;
  metrics?: {
    errorCount: number;
    errorRate: number;
    sliCompliance?: number;
  };
  [key: string]: any;
}

/**
 * 2025 Pattern: Error categories observability
 */
export enum ErrorCategory {
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  BUSINESS_LOGIC = 'business_logic',
  DATABASE = 'database',
  NETWORK = 'network',
  RATE_LIMIT = 'rate_limit',
  SYSTEM = 'system',
  TRADING = 'trading',
  MARKET_DATA = 'market_data',
}

/**
 * 2025 Pattern: Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 2025 Pattern: Observability Exception Filter
 * Comprehensive exception handling with full observability stack integration
 */
@Injectable()
@Catch()
export class ObservabilityExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ObservabilityExceptionFilter.name);
  private readonly serviceName: string;
  private readonly environment: string;
  private readonly isDevelopment: boolean;
  private readonly baseUri: string;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly sliService: SLIService,
    private readonly apmService: APMService,
  ) {
    this.serviceName = process.env['SERVICE_NAME'] || '-service';
    this.environment = process.env['NODE_ENV'] || 'development';
    this.isDevelopment = this.environment === 'development';
    this.baseUri = process.env['BASE_URI'] || 'https://api.crypto-trading-bot.com';
  }

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Extract telemetry information
    const span = trace.getActiveSpan();
    const spanContext = span?.spanContext();
    const correlationId = this.extractCorrelationId(request);
    const errorId = uuidv4();
    const timestamp = new Date().toISOString();
    const requestStartTime = (request as any).startTime || Date.now();
    const duration = Date.now() - requestStartTime;

    // Analyze exception
    const errorAnalysis = this.analyzeException(exception);

    // Record metrics
    await this.recordObservabilityMetrics(
      exception,
      errorAnalysis,
      request,
      duration,
    );

    // Build RFC 7807 Problem Details response with metrics
    const metadata = {
      correlationId,
      errorId,
      timestamp,
      instance: request.url,
      ...(spanContext?.traceId && { traceId: spanContext.traceId }),
      ...(spanContext?.spanId && { spanId: spanContext.spanId }),
    };

    const problemDetails = await this.buildProblemDetails(
      exception,
      errorAnalysis,
      metadata,
    );

    // Record exception in span
    if (span) {
      span.recordException(exception as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: errorAnalysis.title,
      });
      span.setAttributes({
        'error.type': errorAnalysis.category,
        'error.severity': errorAnalysis.severity,
        'error.code': errorAnalysis.errorCode,
        'error.id': errorId,
        'http.status_code': errorAnalysis.status,
        'request.duration': duration,
      });
    }

    // Log error with structured context
    this.logError(exception, problemDetails, errorAnalysis, request);

    // Set response headers
    this.setResponseHeaders(response, problemDetails, errorAnalysis);

    // Send RFC 7807 response
    response.status(errorAnalysis.status).json(problemDetails);
  }

  /**
   * Record observability metrics for the error
   */
  private async recordObservabilityMetrics(
    exception: unknown,
    errorAnalysis: any,
    request: Request,
    duration: number,
  ): Promise<void> {
    try {
      const service = this.serviceName;
      const route = this.extractRoute(request);
      const method = request.method;
      const statusCode = errorAnalysis.status;

      // Record HTTP request metrics with error
      if (this.metricsService.isEnabled()) {
        this.metricsService.recordHttpRequest(
          method,
          route,
          statusCode,
          duration,
          this.getRequestSize(request),
          0, // Error responses typically have minimal size
        );

        // Record error metrics
        this.metricsService.recordError(
          service,
          errorAnalysis.category,
          errorAnalysis.severity,
        );

        // Update error rate
        this.metricsService.updateErrorRate(service, 0, '5m'); // Will be calculated by metrics service
      }

      // Record SLI metrics for error tracking
      if (this.sliService.isEnabled()) {
        // Record order failure for trading errors
        if (errorAnalysis.category === ErrorCategory.TRADING) {
          await this.sliService.recordOrderFailure(
            this.extractSymbol(request),
            this.extractOrderType(request),
            errorAnalysis.errorCode,
          );
        }

        // Record system availability (error = unavailable)
        await this.sliService.recordSystemAvailability(false, service);
      }

      // Record APM error
      if (this.apmService.isEnabled()) {
        await this.apmService.recordError(
          exception as Error,
          {
            request: {
              method: request.method,
              url: request.url,
              headers: request.headers,
            },
            user: (request as any).user,
            errorAnalysis,
          },
          (request as any).transactionId,
        );
      }
    } catch (metricsError) {
      this.logger.error(
        `Failed to record observability metrics: ${metricsError instanceof Error ? metricsError.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Analyze exception to determine category, severity, and metadata
   */
  private analyzeException(exception: unknown): {
    status: number;
    category: ErrorCategory;
    severity: ErrorSeverity;
    errorCode: string;
    title: string;
    retryable: boolean;
    userMessage?: string;
  } {
    // Handle HttpException instances
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        category: this.categorizeHttpStatus(status),
        severity: this.getSeverityForStatus(status),
        errorCode: exception.name,
        title: this.getTitleForStatus(status),
        retryable: status >= 500 || status === 429,
        userMessage: this.getUserMessageForStatus(status),
      };
    }

    // Handle known error types
    if (this.isDatabaseError(exception)) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.HIGH,
        errorCode: 'DATABASE_ERROR',
        title: 'Database Unavailable',
        retryable: true,
        userMessage: 'A database error occurred. Please try again.',
      };
    }

    if (this.isValidationError(exception)) {
      return {
        status: HttpStatus.BAD_REQUEST,
        category: ErrorCategory.VALIDATION,
        severity: ErrorSeverity.LOW,
        errorCode: 'VALIDATION_ERROR',
        title: 'Validation Failed',
        retryable: false,
        userMessage: 'Invalid input provided. Please check your data.',
      };
    }

    if (this.isNetworkError(exception)) {
      return {
        status: HttpStatus.BAD_GATEWAY,
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.MEDIUM,
        errorCode: 'NETWORK_ERROR',
        title: 'Network Error',
        retryable: true,
        userMessage: 'A network error occurred. Please try again.',
      };
    }

    if (this.isTradingError(exception)) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        category: ErrorCategory.TRADING,
        severity: ErrorSeverity.HIGH,
        errorCode: 'TRADING_ERROR',
        title: 'Trading Error',
        retryable: true,
        userMessage: 'A trading error occurred. Please try again.',
      };
    }

    // Unknown errors
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      category: ErrorCategory.SYSTEM,
      severity: ErrorSeverity.CRITICAL,
      errorCode: 'UNKNOWN_ERROR',
      title: 'Internal Server Error',
      retryable: false,
      userMessage: 'An unexpected error occurred. Our team has been notified.',
    };
  }

  /**
   * Build RFC 7807 Problem Details response with observability metrics
   */
  private async buildProblemDetails(
    exception: unknown,
    errorAnalysis: any,
    metadata: {
      correlationId: string;
      traceId?: string;
      spanId?: string;
      errorId: string;
      timestamp: string;
      instance: string;
    },
  ): Promise<ObservabilityProblemDetails> {
    const problemDetails: ObservabilityProblemDetails = {
      type: `${this.baseUri}/errors/${errorAnalysis.category}`,
      title: errorAnalysis.title,
      status: errorAnalysis.status,
      detail: this.extractErrorMessage(exception),
      instance: metadata.instance,
      timestamp: metadata.timestamp,
      correlationId: metadata.correlationId,
      errorId: metadata.errorId,
      errorCode: errorAnalysis.errorCode,
      category: errorAnalysis.category,
      severity: errorAnalysis.severity,
      retryable: errorAnalysis.retryable,
      userMessage: errorAnalysis.userMessage,
      ...(metadata.traceId && { traceId: metadata.traceId }),
      ...(metadata.spanId && { spanId: metadata.spanId }),
    };

    // Add observability metrics
    if (this.metricsService.isEnabled() || this.sliService.isEnabled()) {
      try {
        const performanceMetrics = await this.metricsService.getPerformanceMetrics();
        problemDetails.metrics = {
          errorCount: performanceMetrics.errorRate.count,
          errorRate: performanceMetrics.errorRate.percentage,
        };

        // Add SLI compliance if available
        const slis = await this.sliService.getSLIs();
        const systemAvailabilitySli = slis.find(s => s.name === 'System Availability');
        if (systemAvailabilitySli) {
          const sliMetrics = await this.sliService.getSLIMetrics(systemAvailabilitySli.id);
          if (sliMetrics) {
            problemDetails.metrics.sliCompliance = sliMetrics.compliance;
          }
        }
      } catch (metricsError) {
        this.logger.warn('Failed to add metrics to problem details');
      }
    }

    // Add retry information for retryable errors
    if (errorAnalysis.retryable) {
      problemDetails['retryAfter'] = this.calculateRetryAfter(errorAnalysis);
    }

    // Add debug information in development
    if (this.isDevelopment) {
      problemDetails['debug'] = {
        stack: exception instanceof Error ? exception.stack : undefined,
        originalError: exception instanceof HttpException ? exception.getResponse() : exception,
        exception: {
          name: exception instanceof Error ? exception.name : typeof exception,
          message: exception instanceof Error ? exception.message : String(exception),
        },
      };
    }

    return problemDetails;
  }

  /**
   * Log error with structured context
   */
  private logError(
    exception: unknown,
    problemDetails: ObservabilityProblemDetails,
    errorAnalysis: any,
    request: Request,
  ): void {
    const logData = {
      ...problemDetails,
      request: {
        method: request.method,
        url: request.url,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
      exception: {
        name: exception instanceof Error ? exception.name : typeof exception,
        message: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      },
    };

    const message = `${errorAnalysis.category.toUpperCase()}: ${problemDetails.detail}`;

    switch (errorAnalysis.severity) {
      case ErrorSeverity.CRITICAL:
      case ErrorSeverity.HIGH:
        this.logger.error(message, JSON.stringify(logData));
        break;
      case ErrorSeverity.MEDIUM:
        this.logger.warn(message, JSON.stringify(logData));
        break;
      case ErrorSeverity.LOW:
        this.logger.debug(message);
        break;
      default:
        this.logger.error(message, JSON.stringify(logData));
    }
  }

  /**
   * Set response headers
   */
  private setResponseHeaders(
    response: Response,
    problemDetails: ObservabilityProblemDetails,
    errorAnalysis: any,
  ): void {
    response.header('Content-Type', 'application/problem+json');
    response.header('X-Correlation-Id', problemDetails.correlationId);
    response.header('X-Error-Id', problemDetails.errorId);
    response.header('X-Error-Category', problemDetails.category);
    response.header('X-Error-Severity', problemDetails.severity);

    if (problemDetails.traceId) {
      response.header('X-Trace-Id', problemDetails.traceId);
    }

    if (problemDetails.retryable && problemDetails['retryAfter']) {
      response.header('Retry-After', problemDetails['retryAfter'].toString());
    }

    // Set cache control for different error types
    if (errorAnalysis.status >= 500) {
      response.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (errorAnalysis.status === 429) {
      response.header('Cache-Control', 'no-cache');
    }
  }

  // Utility methods
  private extractCorrelationId(request: Request): string {
    return (
      (request.headers['x-correlation-id'] as string) ||
      (request.headers['x-request-id'] as string) ||
      uuidv4()
    );
  }

  private extractErrorMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') {return response;}
      if (typeof response === 'object' && response !== null) {
        return (response as any).message || exception.message;
      }
      return exception.message;
    }
    if (exception instanceof Error) {return exception.message;}
    if (typeof exception === 'string') {return exception;}
    return 'An unexpected error occurred';
  }

  private extractRoute(request: Request): string {
    return request.route?.path || request.path || request.url;
  }

  private extractSymbol(request: Request): string {
    return (request.params['symbol'] || request.body?.symbol || request.query['symbol'] || 'UNKNOWN') as string;
  }

  private extractOrderType(request: Request): string {
    return (request.body?.type || request.query['type'] || 'UNKNOWN') as string;
  }

  private getRequestSize(request: Request): number {
    const contentLength = request.headers['content-length'];
    return contentLength ? parseInt(contentLength, 10) : 0;
  }

  private calculateRetryAfter(errorAnalysis: any): number {
    if (errorAnalysis.category === ErrorCategory.RATE_LIMIT) {return 60;}
    if (errorAnalysis.status >= 500) {return 30;}
    return 10;
  }

  private categorizeHttpStatus(status: number): ErrorCategory {
    if (status === HttpStatus.UNAUTHORIZED) {return ErrorCategory.AUTHENTICATION;}
    if (status === HttpStatus.FORBIDDEN) {return ErrorCategory.AUTHORIZATION;}
    if (status === HttpStatus.BAD_REQUEST || status === HttpStatus.UNPROCESSABLE_ENTITY) {
      return ErrorCategory.VALIDATION;
    }
    if (status === HttpStatus.TOO_MANY_REQUESTS) {return ErrorCategory.RATE_LIMIT;}
    if (status >= 400 && status < 500) {return ErrorCategory.BUSINESS_LOGIC;}
    return ErrorCategory.SYSTEM;
  }

  private getSeverityForStatus(status: number): ErrorSeverity {
    if (status >= 500) {return ErrorSeverity.HIGH;}
    if (status === 429 || status === 503) {return ErrorSeverity.MEDIUM;}
    return ErrorSeverity.LOW;
  }

  private getTitleForStatus(status: number): string {
    const titles: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout',
    };
    return titles[status] || 'HTTP Error';
  }

  private getUserMessageForStatus(status: number): string {
    const messages: Record<number, string> = {
      400: 'Invalid request. Please check your input and try again.',
      401: 'Authentication required. Please log in and try again.',
      403: 'You do not have permission to perform this action.',
      404: 'The requested resource was not found.',
      422: 'Invalid input provided. Please check your data.',
      429: 'Too many requests. Please try again later.',
      500: 'An internal server error occurred. Our team has been notified.',
      502: 'External service error. Please try again later.',
      503: 'Service temporarily unavailable. Please try again later.',
      504: 'Request timeout. Please try again.',
    };
    return messages[status] || 'An error occurred. Please try again.';
  }

  private isDatabaseError(exception: unknown): boolean {
    if (!(exception instanceof Error)) {return false;}
    const message = exception.message.toLowerCase();
    const name = exception.name.toLowerCase();
    return (
      message.includes('database') ||
      message.includes('connection') ||
      message.includes('postgres') ||
      name.includes('queryerror') ||
      name.includes('databaseerror')
    );
  }

  private isValidationError(exception: unknown): boolean {
    if (!(exception instanceof Error)) {return false;}
    const message = exception.message.toLowerCase();
    return message.includes('validation') || message.includes('invalid');
  }

  private isNetworkError(exception: unknown): boolean {
    if (!(exception instanceof Error)) {return false;}
    const message = exception.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused')
    );
  }

  private isTradingError(exception: unknown): boolean {
    if (!(exception instanceof Error)) {return false;}
    const message = exception.message.toLowerCase();
    return (
      message.includes('trade') ||
      message.includes('order') ||
      message.includes('exchange')
    );
  }
}
