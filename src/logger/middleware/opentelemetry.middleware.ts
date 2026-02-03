/**
 * OpenTelemetry Middleware - 2025 Observability Integration
 *
 * @description OpenTelemetry distributed tracing
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance OpenTelemetry Standards, W3C Trace Context
 * @patterns Middleware, Observer, Strategy
 */

import { trace, context, propagation, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import type { Span, Tracer } from '@opentelemetry/api';

import {
  type ILoggerMiddleware,
  type IUnifiedLogger,
  type LogMessage,
  type LogContext,
  LogLevel,
} from '../interfaces/logger.interface';

/**
 * OpenTelemetry middleware
 */
export interface OpenTelemetryMiddlewareConfig {
  serviceName: string;
  serviceVersion: string;
  enableAutoInstrumentation: boolean;
  enableSpanEvents: boolean;
  enableSpanAttributes: boolean;
  enableMetrics: boolean;

  // Span configuration
  spanNamePrefix?: string;
  spanKind: SpanKind;

  // Filtering
  enabledLevels: LogLevel[];
  enabledComponents: string[];

  // Performance
  maxSpanAttributes: number;
  maxSpanEvents: number;

  // Custom attributes
  customAttributes?: Record<string, string | number | boolean>;
}

/**
 */
interface TracingContext {
  span: Span;
  tracer: Tracer;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * OpenTelemetry Logger Middleware
 */
export class OpenTelemetryMiddleware implements ILoggerMiddleware {
  private readonly config: OpenTelemetryMiddlewareConfig;
  private readonly tracer: Tracer;

  // Active spans tracking
  private readonly activeSpans = new Map<string, TracingContext>();

  // Metrics
  private logEventCount = 0;
  private spanEventCount = 0;

  constructor(config: Partial<OpenTelemetryMiddlewareConfig> = {}) {
    this.config = {
      serviceName: 'unified-logger',
      serviceVersion: '3.0.0',
      enableAutoInstrumentation: true,
      enableSpanEvents: true,
      enableSpanAttributes: true,
      enableMetrics: true,
      spanKind: SpanKind.INTERNAL,
      enabledLevels: [
        LogLevel.EMERGENCY,
        LogLevel.ALERT,
        LogLevel.CRITICAL,
        LogLevel.ERROR,
        LogLevel.WARNING,
        LogLevel.INFO,
      ],
      enabledComponents: [],
      maxSpanAttributes: 64,
      maxSpanEvents: 128,
      ...config,
    };

    this.tracer = trace.getTracer(
      this.config.serviceName,
      this.config.serviceVersion
    );
  }

  /**
   */
  attach(_logger: IUnifiedLogger): void {
    // Logger attachment point for future middleware integration
    // Currently middleware operates independently of attached logger

    if (this.config.enableAutoInstrumentation) {
      this.setupAutoInstrumentation();
    }
  }

  /**
   */
  async process(message: LogMessage): Promise<LogMessage> {
    try {
      if (!this.shouldProcess(message)) {
        return message;
      }

      const enrichedMessage = await this.enrichWithTracing(message);

      // span events
      if (this.config.enableSpanEvents) {
        await this.createSpanEvents(enrichedMessage);
      }

      this.updateMetrics(enrichedMessage);

      return enrichedMessage;
    } catch (error) {
      console.error('[OpenTelemetryMiddleware] Error processing message:', error);
      return message; // Fallback to original message
    }
  }

  /**
   * span
   */
  createSpan(
    operationName: string,
    parentContext?: any,
    options: {
      kind?: SpanKind;
      attributes?: Record<string, any>;
    } = {}
  ): TracingContext {
    const spanName = this.config.spanNamePrefix ?
      `${this.config.spanNamePrefix}:${operationName}` :
      operationName;

    const span = this.tracer.startSpan(spanName, {
      kind: options.kind || this.config.spanKind,
      attributes: {
        'service.name': this.config.serviceName,
        'service.version': this.config.serviceVersion,
        'operation.name': operationName,
        ...this.config.customAttributes,
        ...options.attributes,
      },
    }, parentContext);

    const spanContext = span.spanContext();
    const parentSpanIdValue = parentContext ? trace.getActiveSpan()?.spanContext().spanId : undefined;

    const tracingContext: TracingContext = {
      span,
      tracer: this.tracer,
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      ...(parentSpanIdValue !== undefined && { parentSpanId: parentSpanIdValue }),
    };

    // span
    this.activeSpans.set(spanContext.spanId, tracingContext);

    return tracingContext;
  }

  /**
   * span
   */
  finishSpan(
    spanId: string,
    success: boolean = true,
    error?: Error,
    attributes?: Record<string, any>
  ): void {
    const tracingContext = this.activeSpans.get(spanId);
    if (!tracingContext) {return;}

    const { span } = tracingContext;

    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        span.setAttributes({ [key]: value });
      });
    }

    if (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    } else {
      span.setStatus({
        code: success ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      });
    }

    span.end();
    this.activeSpans.delete(spanId);
  }

  /**
   */
  createChildContext(parentSpanId: string): any {
    const parentContext = this.activeSpans.get(parentSpanId);
    if (!parentContext) {return context.active();}

    return trace.setSpan(context.active(), parentContext.span);
  }

  /**
   * headers
   */
  extractTracingContext(headers: Record<string, string>): any {
    return propagation.extract(context.active(), headers);
  }

  /**
   * headers
   */
  injectTracingContext(headers: Record<string, string>, ctx?: any): Record<string, string> {
    const activeContext = ctx || context.active();
    propagation.inject(activeContext, headers);
    return headers;
  }

  /**
   * middleware
   */
  getStats(): Record<string, any> {
    return {
      serviceName: this.config.serviceName,
      serviceVersion: this.config.serviceVersion,
      logEventCount: this.logEventCount,
      spanEventCount: this.spanEventCount,
      activeSpans: this.activeSpans.size,
      enabledFeatures: {
        autoInstrumentation: this.config.enableAutoInstrumentation,
        spanEvents: this.config.enableSpanEvents,
        spanAttributes: this.config.enableSpanAttributes,
        metrics: this.config.enableMetrics,
      },
    };
  }

  // ==================== PRIVATE METHODS ====================

  private shouldProcess(message: LogMessage): boolean {
    if (!this.config.enabledLevels.includes(message.level)) {
      return false;
    }

    if (this.config.enabledComponents.length > 0) {
      const component = message.context.component;
      if (!component || !this.config.enabledComponents.includes(component)) {
        return false;
      }
    }

    return true;
  }

  private async enrichWithTracing(message: LogMessage): Promise<LogMessage> {
    const activeSpan = trace.getActiveSpan();

    if (!activeSpan) {
      return message;
    }

    const spanContext = activeSpan.spanContext();

    const enrichedContext: Partial<LogContext> = {
      ...message.context,
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };

    // baggage
    const baggage = propagation.getBaggage(context.active());
    if (baggage) {
      const baggageEntries: Record<string, string> = {};
      baggage.getAllEntries().forEach(([key, entry]) => {
        baggageEntries[key] = entry.value;
      });
      enrichedContext.baggage = baggageEntries;
    }

    return {
      ...message,
      context: enrichedContext,
    };
  }

  private async createSpanEvents(message: LogMessage): Promise<void> {
    const activeSpan = trace.getActiveSpan();
    if (!activeSpan) {return;}

    try {
      // span event
      const eventName = `log.${message.level}`;
      const eventAttributes: Record<string, any> = {
        'log.level': message.level,
        'log.message': message.message,
        'log.logger': 'unified-logger',
      };

      if (message.context.correlationId) {
        eventAttributes['log.correlation_id'] = message.context.correlationId;
      }

      if (message.context.component) {
        eventAttributes['log.component'] = message.context.component;
      }

      if (message.context.userId) {
        eventAttributes['log.user_id'] = message.context.userId;
      }

      if (message.data) {
        eventAttributes['log.data'] = JSON.stringify(message.data);
      }

      if (message.error) {
        eventAttributes['log.error.name'] = message.error.name;
        eventAttributes['log.error.message'] = message.error.message;
        if (message.error.stack) {
          eventAttributes['log.error.stack'] = message.error.stack;
        }
      }

      const limitedAttributes = this.limitAttributes(eventAttributes);

      activeSpan.addEvent(eventName, limitedAttributes);
      this.spanEventCount++;
    } catch (error) {
      console.error('[OpenTelemetryMiddleware] Error creating span event:', error);
    }
  }

  private limitAttributes(attributes: Record<string, any>): Record<string, any> {
    const entries = Object.entries(attributes);
    if (entries.length <= this.config.maxSpanAttributes) {
      return attributes;
    }

    const priorityKeys = [
      'log.level',
      'log.message',
      'log.correlation_id',
      'log.component',
      'log.error.name',
      'log.error.message',
    ];

    const limitedAttributes: Record<string, any> = {};
    let count = 0;

    for (const [key, value] of entries) {
      if (count >= this.config.maxSpanAttributes) {break;}
      if (priorityKeys.includes(key)) {
        limitedAttributes[key] = value;
        count++;
      }
    }

    for (const [key, value] of entries) {
      if (count >= this.config.maxSpanAttributes) {break;}
      if (!priorityKeys.includes(key)) {
        limitedAttributes[key] = value;
        count++;
      }
    }

    return limitedAttributes;
  }

  private setupAutoInstrumentation(): void {

    // , HTTP , database calls, etc.
    // OpenTelemetry
  }

  private updateMetrics(_message: LogMessage): void {
    this.logEventCount++;

    // OpenTelemetry Metrics API
    if (this.config.enableMetrics) {
      // Increment counters, update histograms, etc.
    }
  }
}

/**
 * OpenTelemetry middleware
 */
export class OpenTelemetryMiddlewareFactory {
  /**
   * middleware development
   */
  static createDevelopment(serviceName: string): OpenTelemetryMiddleware {
    return new OpenTelemetryMiddleware({
      serviceName,
      enableAutoInstrumentation: true,
      enableSpanEvents: true,
      enableSpanAttributes: true,
      enabledLevels: [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARNING, LogLevel.ERROR],
    });
  }

  /**
   * middleware production
   */
  static createProduction(
    serviceName: string,
    serviceVersion: string
  ): OpenTelemetryMiddleware {
    return new OpenTelemetryMiddleware({
      serviceName,
      serviceVersion,
      enableAutoInstrumentation: true,
      enableSpanEvents: true,
      enableSpanAttributes: true,
      enableMetrics: true,
      enabledLevels: [LogLevel.INFO, LogLevel.WARNING, LogLevel.ERROR, LogLevel.CRITICAL],
      maxSpanAttributes: 32, // Reduced for performance
      maxSpanEvents: 64,
    });
  }

  /**
   * middleware
   */
  static createHighPerformance(serviceName: string): OpenTelemetryMiddleware {
    return new OpenTelemetryMiddleware({
      serviceName,
      enableAutoInstrumentation: false,
      enableSpanEvents: false,
      enableSpanAttributes: true,
      enableMetrics: false,
      enabledLevels: [LogLevel.WARNING, LogLevel.ERROR, LogLevel.CRITICAL],
      maxSpanAttributes: 16,
      maxSpanEvents: 32,
    });
  }

  /**
   * middleware
   */
  static createTrading(serviceName: string, exchange?: string): OpenTelemetryMiddleware {
    return new OpenTelemetryMiddleware({
      serviceName,
      spanNamePrefix: 'trading',
      enableAutoInstrumentation: true,
      enableSpanEvents: true,
      enableSpanAttributes: true,
      customAttributes: {
        'trading.exchange': exchange || 'unknown',
        'trading.system': '',
      },
      enabledLevels: [LogLevel.INFO, LogLevel.WARNING, LogLevel.ERROR],
      enabledComponents: ['trading', 'order', 'position', 'risk'],
    });
  }
}