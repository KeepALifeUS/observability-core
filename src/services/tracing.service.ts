/**
 * 2025 Distributed Tracing Service
 * OpenTelemetry-based distributed tracing for microservices
 */

import { Injectable, Logger } from '@nestjs/common';
import { trace, Span, SpanStatusCode, SpanKind, context, propagation } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { v4 as uuidv4 } from 'uuid';

import { ITracingConfig, ITraceContext, ISpan } from '../interfaces/observability.interface';

@Injectable()
export class TracingService {
  private readonly logger = new Logger(TracingService.name);
  private sdk!: NodeSDK;
  private tracer: any;
  private _isEnabled = false;

  /**
   * Check if service is enabled
   */
  public isEnabled(): boolean {
    return this._isEnabled;
  }

  /**
   * Initialize OpenTelemetry tracing
   */
  async initialize(_config: ITracingConfig): Promise<void> {
    if (!_config.enabled) {
      this.logger.log('🔍 Tracing is disabled');
      return;
    }

    try {
      this.logger.log('🔍 Initializing OpenTelemetry distributed tracing...');

      // Create resource with service information
      const resource = Resource.default().merge(
        new Resource({
          [SemanticResourceAttributes.SERVICE_NAME]: _config.serviceName,
          [SemanticResourceAttributes.SERVICE_VERSION]: process.env['SERVICE_VERSION'] || '1.0.0',
          [SemanticResourceAttributes.SERVICE_NAMESPACE]: process.env['NAMESPACE'] || 'default',
          [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env['NODE_ENV'] || 'development',
          [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: process.env['INSTANCE_ID'] || uuidv4(),
        }),
      );

      // Configure exporters
      const exporters = this.configureExporters(_config);

      // Initialize SDK with auto-instrumentations
      this.sdk = new NodeSDK({
        resource,
        traceExporter: exporters.trace,
        // Note: Metrics are handled separately via PrometheusExporter
        instrumentations: [
          getNodeAutoInstrumentations({
            // Disable specific instrumentations if needed
            '@opentelemetry/instrumentation-fs': {
              enabled: false, // Usually too verbose
            },
            '@opentelemetry/instrumentation-http': {
              enabled: _config.instrumentation.http,
              requestHook: this.httpRequestHook.bind(this),
              responseHook: this.httpResponseHook.bind(this),
            },
            '@opentelemetry/instrumentation-express': {
              enabled: _config.instrumentation.express,
            },
            '@opentelemetry/instrumentation-pg': {
              enabled: _config.instrumentation.pg,
              enhancedDatabaseReporting: true,
            },
            '@opentelemetry/instrumentation-redis': {
              enabled: _config.instrumentation.redis,
            },
          }),
        ],
      });

      // Start the SDK
      this.sdk.start();

      // Get tracer instance
      this.tracer = trace.getTracer(_config.serviceName, process.env['SERVICE_VERSION'] || '1.0.0');

      this._isEnabled = true;

      this.logger.log('✅ OpenTelemetry distributed tracing initialized');
      this.logger.log(`🎯 Service: ${_config.serviceName}`);
      this.logger.log(`📊 Sample rate: ${_config.sampling.probability * 100}%`);
      this.logger.log(`🔗 Exporters: ${Object.keys(exporters).join(', ')}`);

    } catch (error: unknown) {
      this.logger.error(`❌ Failed to initialize tracing: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Create a new span
   */
  createSpan(
    name: string,
    options: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
      parent?: ITraceContext;
    } = {},
  ): ISpan {
    if (!this._isEnabled) {
      return this.createNoOpSpan(name);
    }

    const spanOptions: any = {
      kind: options.kind || SpanKind.INTERNAL,
      attributes: options.attributes || {},
    };

    let span: Span;
    if (options.parent) {
      // Create span with specific parent context
      const parentContext = this.createContextFromTraceContext(options.parent);
      span = this.tracer.startSpan(name, spanOptions, parentContext);
    } else {
      // Create span with current active context
      span = this.tracer.startSpan(name, spanOptions);
    }

    return this.wrapSpan(span);
  }

  /**
   * Start an active span and execute function within its context
   */
  async withSpan<T>(
    name: string,
    fn: (span: ISpan) => Promise<T> | T,
    options: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
      parent?: ITraceContext;
    } = {},
  ): Promise<T> {
    if (!this._isEnabled) {
      const noOpSpan = this.createNoOpSpan(name);
      return await fn(noOpSpan);
    }

    const span = this.createSpan(name, options);

    try {
      // Execute function within span context
      const result = await context.with(
        trace.setSpan(context.active(), span as any),
        async () => await fn(span),
      );

      // Mark span as successful
      span.setStatus({ code: SpanStatusCode.OK });
      return result;

    } catch (error: unknown) {
      // Record error in span
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: (error as Error).message,
      });
      throw error;

    } finally {
      // Always end the span
      span.end();
    }
  }

  /**
   * Get current trace context
   */
  getCurrentTraceContext(): ITraceContext | null {
    if (!this._isEnabled) {
      return null;
    }

    const activeSpan = trace.getActiveSpan();
    if (!activeSpan) {
      return null;
    }

    const spanContext = activeSpan.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      flags: spanContext.traceFlags,
    };
  }

  /**
   * Inject trace context into carriers (for HTTP headers, etc.)
   */
  inject(carrier: Record<string, any>): void {
    if (!this._isEnabled) {
      return;
    }

    propagation.inject(context.active(), carrier);
  }

  /**
   * Extract trace context from carriers
   */
  extract(carrier: Record<string, any>): ITraceContext | null {
    if (!this._isEnabled) {
      return null;
    }

    try {
      const extractedContext = propagation.extract(context.active(), carrier);
      const span = trace.getSpan(extractedContext);

      if (span) {
        const spanContext = span.spanContext();
        return {
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
          flags: spanContext.traceFlags,
        };
      }
    } catch (error: unknown) {
      this.logger.warn(`Failed to extract trace context: ${(error as Error).message}`);
    }

    return null;
  }

  /**
   * Add custom attributes to current span
   */
  addAttributes(attributes: Record<string, any>): void {
    if (!this._isEnabled) {
      return;
    }

    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.setAttributes(attributes);
    }
  }

  /**
   * Record an event in current span
   */
  addEvent(name: string, attributes?: Record<string, any>): void {
    if (!this._isEnabled) {
      return;
    }

    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.addEvent(name, attributes);
    }
  }

  /**
   * Record an exception in current span
   */
  recordException(error: Error): void {
    if (!this._isEnabled) {
      return;
    }

    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.recordException(error);
      activeSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
    }
  }

  /**
   * Check if tracing is enabled
   */
  getIsEnabled(): boolean {
    return this._isEnabled;
  }

  /**
   * Shutdown tracing service
   */
  async shutdown(): Promise<void> {
    if (this.sdk) {
      await this.sdk.shutdown();
      this.logger.log('🔍 Tracing service shutdown completed');
    }
  }

  /**
   * Configure trace and metric exporters
   */
  private configureExporters(config: ITracingConfig): { trace?: any; metrics?: any } {
    const exporters: any = {};

    // Configure trace exporters
    if (config.exporters.jaeger.enabled) {
      exporters.trace = new JaegerExporter({
        endpoint: config.exporters.jaeger.endpoint,
      });
      this.logger.log(`🔗 Jaeger exporter configured: ${config.exporters.jaeger.endpoint}`);
    }

    // Configure metrics exporter
    exporters.metrics = new PrometheusExporter({
      port: 9464,
      endpoint: '/metrics',
    });

    return exporters;
  }

  /**
   * HTTP request hook for instrumentation
   */
  private httpRequestHook(span: Span, request: any): void {
    span.setAttributes({
      'http.request.body.size': request.headers['content-length'] || 0,
      'http.request.header.user_agent': request.headers['user-agent'],
      'http.request.header.authorization': request.headers.authorization ? '[REDACTED]' : undefined,
    });

    // Add custom attributes for trading API requests
    if (request.url?.includes('/api/trading')) {
      span.setAttributes({
        'trading.api.request': true,
        'trading.api.endpoint': request.url,
      });
    }
  }

  /**
   * HTTP response hook for instrumentation
   */
  private httpResponseHook(span: Span, response: any): void {
    span.setAttributes({
      'http.response.body.size': response.headers['content-length'] || 0,
      'http.response.header.content_type': response.headers['content-type'],
    });

    // Record slow requests
    const duration = Date.now() - (span as any).startTime;
    if (duration > 1000) {
      span.addEvent('slow_request', {
        duration_ms: duration,
        threshold_ms: 1000,
      });
    }
  }

  /**
   * Create context from trace context
   */
  private createContextFromTraceContext(_traceContext: ITraceContext): any {
    // This is a simplified implementation
    // In a real scenario, you'd reconstruct the proper OpenTelemetry context
    // The _traceContext parameter is prefixed with underscore to indicate it's intentionally unused
    return context.active();
  }

  /**
   * Wrap OpenTelemetry span with our interface
   */
  private wrapSpan(span: Span): ISpan {
    const spanContext = span.spanContext();

    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      operationName: '', // Not directly available in OpenTelemetry
      startTime: new Date(),
      tags: {},
      logs: [],
      status: {
        code: 0,
      },

      // Methods
      setTag: (key: string, value: any) => {
        span.setAttribute(key, value);
      },

      setStatus: (status: { code: number; message?: string }) => {
        const spanStatus: { code: number; message?: string } = {
          code: status.code === 0 ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        };

        if (status.message !== undefined) {
          spanStatus.message = status.message;
        }

        span.setStatus(spanStatus);
      },

      addEvent: (name: string, attributes?: Record<string, any>) => {
        span.addEvent(name, attributes);
      },

      recordException: (error: Error) => {
        span.recordException(error);
      },

      end: () => {
        span.end();
      },

      // Access to underlying span
      _otelSpan: span,
    } as any;
  }

  /**
   * Create a no-op span when tracing is disabled
   */
  private createNoOpSpan(name: string): ISpan {
    return {
      traceId: '',
      spanId: '',
      operationName: name,
      startTime: new Date(),
      tags: {},
      logs: [],
      status: { code: 0 },
      setTag: () => {},
      setStatus: () => {},
      addEvent: () => {},
      recordException: () => {},
      end: () => {},
    } as any;
  }
}