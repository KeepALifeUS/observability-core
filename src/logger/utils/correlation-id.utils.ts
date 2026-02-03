/**
 * Enhanced Correlation ID Utilities - 2025 Enterprise Edition
 *
 * @description Enterprise patterns
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance OpenTelemetry, W3C Trace Context, OWASP
 * @patterns Strategy, Factory, Builder
 */

import { randomUUID, randomBytes, createHash } from 'crypto';
import { hostname } from 'os';

import type { Request } from 'express';

import { type LogContext } from '../interfaces/logger.interface';

/**
 * Correlation ID 2025 patterns
 */
export enum CorrelationStrategy {
  // Standard strategies
  UUID_V4 = 'uuid-v4',                    // RFC 4122 compliant UUID
  SHORT_UUID = 'short-uuid',              // 16-char shortened UUID
  TIMESTAMP = 'timestamp',                // Timestamp + random
  SEQUENTIAL = 'sequential',              // Sequential with prefix

  // Distributed tracing strategies
  W3C_TRACE = 'w3c-trace',               // W3C Trace Context format
  JAEGER = 'jaeger',                     // Jaeger compatible format
  ZIPKIN = 'zipkin',                     // Zipkin B3 format
  OPENTELEMETRY = 'opentelemetry',       // OpenTelemetry format

  // Hierarchical strategies
  HIERARCHICAL = 'hierarchical',          // Parent.child structure
  PATH_BASED = 'path-based',             // URL path based

  // Custom strategies
  CRYPTO_TRADING = 'crypto-trading',      //  trading specific
  CUSTOM = 'custom',                     // User-defined generator
}

/**
 * Correlation ID
 */
export interface CorrelationConfig {
  strategy: CorrelationStrategy;
  prefix?: string;
  suffix?: string;
  separator?: string;
  length?: number;
  includeTimestamp?: boolean;
  includePid?: boolean;
  includeHostname?: boolean;

  // Security options
  enableHashing?: boolean;
  hashAlgorithm?: 'md5' | 'sha1' | 'sha256';

  // Custom generator
  customGenerator?: (context?: any) => string;

  // Validation rules
  minLength?: number;
  maxLength?: number;
  allowedChars?: RegExp;
}

/**
 * Correlation ID
 */
export interface ParsedCorrelationId {
  original: string;
  normalized: string;
  strategy?: CorrelationStrategy;
  prefix?: string;
  suffix?: string;
  timestamp?: number;
  processId?: number;
  hostname?: string;
  sequence?: number;
  parentId?: string;
  level: number;
  metadata: Record<string, any>;
  isValid: boolean;
  validationErrors: string[];
}

/**
 * W3C Trace Context
 */
export interface W3CTraceContext {
  version: string;
  traceId: string;
  parentId: string;
  traceFlags: string;
  traceState?: string;
}

/**
 * Correlation ID - 2025
 */
export class EnhancedCorrelationManager {
  private static readonly DEFAULT_CONFIG: Required<CorrelationConfig> = {
    strategy: CorrelationStrategy.UUID_V4,
    prefix: '',
    suffix: '',
    separator: '.',
    length: 16,
    includeTimestamp: false,
    includePid: false,
    includeHostname: false,
    enableHashing: false,
    hashAlgorithm: 'sha256',
    customGenerator: () => randomUUID(),
    minLength: 8,
    maxLength: 128,
    allowedChars: /^[a-zA-Z0-9\-_.]+$/,
  };

  private readonly config: Required<CorrelationConfig>;
  private sequenceCounter = 0;
  private readonly hostname: string;
  private readonly processId: number;

  constructor(config?: Partial<CorrelationConfig>) {
    this.config = { ...EnhancedCorrelationManager.DEFAULT_CONFIG, ...config };
    this.hostname = hostname();
    this.processId = process.pid;
  }

  /**
   * Correlation ID
   */
  generate(parentId?: string, context?: any): string {
    let correlationId: string;

    switch (this.config.strategy) {
      case CorrelationStrategy.UUID_V4:
        correlationId = this.generateUUID();
        break;

      case CorrelationStrategy.SHORT_UUID:
        correlationId = this.generateShortUUID();
        break;

      case CorrelationStrategy.TIMESTAMP:
        correlationId = this.generateTimestampBased();
        break;

      case CorrelationStrategy.SEQUENTIAL:
        correlationId = this.generateSequential();
        break;

      case CorrelationStrategy.W3C_TRACE:
        correlationId = this.generateW3CTrace(parentId);
        break;

      case CorrelationStrategy.JAEGER:
        correlationId = this.generateJaegerFormat();
        break;

      case CorrelationStrategy.ZIPKIN:
        correlationId = this.generateZipkinFormat();
        break;

      case CorrelationStrategy.OPENTELEMETRY:
        correlationId = this.generateOpenTelemetryFormat();
        break;

      case CorrelationStrategy.HIERARCHICAL:
        correlationId = this.generateHierarchical(parentId);
        break;

      case CorrelationStrategy.PATH_BASED:
        correlationId = this.generatePathBased(context);
        break;

      case CorrelationStrategy.CRYPTO_TRADING:
        correlationId = this.generateCryptoTrading(context);
        break;

      case CorrelationStrategy.CUSTOM:
        correlationId = this.config.customGenerator(context);
        break;

      default:
        correlationId = this.generateUUID();
    }

    return this.applyFormatting(correlationId);
  }

  /**
   * Correlation ID HTTP
   * 2025: Fastify-compatible header extraction
   */
  extractFromRequest(req: Request): string | undefined {
    const headerNames = [
      'x-correlation-id',
      'x-correlationid',
      'correlation-id',
      'correlationid',
      'x-request-id',
      'x-trace-id',
      'traceparent',
      'x-cloud-trace-context',
      'x-amzn-trace-id',
    ];

    // Check headers (Fastify headers can be string | string[] | undefined)
    for (const headerName of headerNames) {
      const headerValue = req.headers[headerName.toLowerCase()];
      const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (value && this.validate(value).isValid) {
        return this.normalize(value);
      }
    }

    // Check query parameters
    const queryId = req.query['correlationId'] as string;
    if (queryId && this.validate(queryId).isValid) {
      return this.normalize(queryId);
    }

    return undefined;
  }

  /**
   * Correlation ID
   */
  createChild(parentId: string, suffix?: string, context?: any): string {
    const childSuffix = suffix || this.generateShortId();

    if (this.config.strategy === CorrelationStrategy.HIERARCHICAL) {
      return `${parentId}${this.config.separator}${childSuffix}`;
    }

    // For other strategies, create related ID
    const baseId = this.generate(parentId, context);
    return `${baseId}-${childSuffix}`;
  }

  /**
   * Correlation ID
   */
  validate(correlationId: string): ParsedCorrelationId {
    const result: ParsedCorrelationId = {
      original: correlationId,
      normalized: '',
      level: 1,
      metadata: {},
      isValid: false,
      validationErrors: [],
    };

    try {
      // Basic validation
      if (!correlationId || typeof correlationId !== 'string') {
        result.validationErrors.push('Correlation ID must be a non-empty string');
        return result;
      }

      const normalized = correlationId.trim();
      result.normalized = normalized;

      if (normalized.length < this.config.minLength) {
        result.validationErrors.push(`Correlation ID too short (min: ${this.config.minLength})`);
      }

      if (normalized.length > this.config.maxLength) {
        result.validationErrors.push(`Correlation ID too long (max: ${this.config.maxLength})`);
      }

      if (!this.config.allowedChars.test(normalized)) {
        result.validationErrors.push('Correlation ID contains invalid characters');
      }

      // Parse structure
      this.parseStructure(normalized, result);

      // Mark as valid if no errors
      result.isValid = result.validationErrors.length === 0;

      return result;
    } catch (error: unknown) {
      result.validationErrors.push(`Parse error: ${(error as Error).message}`);
      return result;
    }
  }

  /**
   * Correlation ID
   */
  normalize(correlationId: string): string {
    if (!correlationId) {return '';}

    let normalized = correlationId.trim();

    // Remove invalid characters
    normalized = normalized.replace(/[^a-zA-Z0-9\-_.]/g, '');

    // Ensure length constraints
    if (normalized.length > this.config.maxLength) {
      normalized = normalized.substring(0, this.config.maxLength);
    }

    return normalized;
  }

  /**
   */
  createTracingContext(correlationId: string, parentContext?: LogContext): Partial<LogContext> {
    const parentSpanIdValue = parentContext?.spanId;

    const context: Partial<LogContext> = {
      correlationId,
      traceId: parentContext?.traceId || this.generateTraceId(),
      spanId: this.generateSpanId(),
      ...(parentSpanIdValue !== undefined && { parentSpanId: parentSpanIdValue }),
    };

    // Add baggage if available
    if (parentContext?.baggage) {
      context.baggage = { ...parentContext.baggage };
    }

    return context;
  }

  /**
   * W3C Trace Context
   */
  createW3CTraceContext(correlationId: string): W3CTraceContext {
    return {
      version: '00',
      traceId: this.generateTraceId(),
      parentId: correlationId.padEnd(16, '0').substring(0, 16),
      traceFlags: '01',
    };
  }

  // ==================== PRIVATE METHODS ====================

  private generateUUID(): string {
    return randomUUID();
  }

  private generateShortUUID(): string {
    return randomUUID().replace(/-/g, '').substring(0, this.config.length);
  }

  private generateTimestampBased(): string {
    const timestamp = Date.now();
    const random = randomBytes(4).toString('hex');
    return `${timestamp}-${random}`;
  }

  private generateSequential(): string {
    const sequence = (++this.sequenceCounter).toString().padStart(6, '0');
    const random = randomBytes(2).toString('hex');
    return `${sequence}-${random}`;
  }

  private generateW3CTrace(parentId?: string): string {
    // W3C Trace Context format: version-traceId-parentId-traceFlags
    const version = '00';
    const traceId = randomBytes(16).toString('hex');
    const parentSpanId = parentId ?
      createHash('md5').update(parentId).digest('hex').substring(0, 16) :
      randomBytes(8).toString('hex');
    const traceFlags = '01';

    return `${version}-${traceId}-${parentSpanId}-${traceFlags}`;
  }

  private generateJaegerFormat(): string {
    // Jaeger format: traceId:spanId:parentSpanId:flags
    const traceId = randomBytes(16).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    const flags = '1';

    return `${traceId}:${spanId}:0:${flags}`;
  }

  private generateZipkinFormat(): string {
    // Zipkin B3 format
    return randomBytes(16).toString('hex');
  }

  private generateOpenTelemetryFormat(): string {
    return randomBytes(16).toString('hex');
  }

  private generateHierarchical(parentId?: string): string {
    const childId = this.generateShortId();
    return parentId ?
      `${parentId}${this.config.separator}${childId}` :
      childId;
  }

  private generatePathBased(context?: any): string {
    const path = context?.path || context?.url || 'unknown';
    const pathHash = createHash('md5').update(path).digest('hex').substring(0, 8);
    const timestamp = Date.now().toString(36);
    return `${pathHash}-${timestamp}`;
  }

  private generateCryptoTrading(context?: any): string {
    const prefix = '';
    const operation = context?.operation || 'general';
    const exchange = context?.exchange || 'generic';
    const timestamp = Date.now().toString(36);
    const random = randomBytes(2).toString('hex');

    return `${prefix}-${operation}-${exchange}-${timestamp}-${random}`;
  }

  private generateShortId(): string {
    return randomBytes(4).toString('hex');
  }

  private generateTraceId(): string {
    return randomBytes(16).toString('hex');
  }

  private generateSpanId(): string {
    return randomBytes(8).toString('hex');
  }

  private applyFormatting(correlationId: string): string {
    let formatted = correlationId;

    if (this.config.prefix) {
      formatted = `${this.config.prefix}${this.config.separator}${formatted}`;
    }

    if (this.config.suffix) {
      formatted = `${formatted}${this.config.separator}${this.config.suffix}`;
    }

    if (this.config.includeTimestamp) {
      const timestamp = Date.now().toString(36);
      formatted = `${formatted}${this.config.separator}${timestamp}`;
    }

    if (this.config.includePid) {
      formatted = `${formatted}${this.config.separator}${this.processId}`;
    }

    if (this.config.includeHostname) {
      const hostname = this.hostname.substring(0, 8);
      formatted = `${formatted}${this.config.separator}${hostname}`;
    }

    if (this.config.enableHashing) {
      const hash = createHash(this.config.hashAlgorithm)
        .update(formatted)
        .digest('hex')
        .substring(0, 16);
      formatted = `${hash}`;
    }

    return formatted;
  }

  private parseStructure(correlationId: string, result: ParsedCorrelationId): void {
    // Parse hierarchical structure
    const parts = correlationId.split(this.config.separator);
    result.level = parts.length;

    if (parts.length > 1) {
      result.parentId = parts.slice(0, -1).join(this.config.separator);
    }

    // Extract prefix
    const prefixMatch = correlationId.match(/^([a-zA-Z]+)[-_.]/);
    const prefixValue = prefixMatch?.[1];
    if (prefixValue !== undefined) {
      result.prefix = prefixValue;
    }

    // Extract suffix
    const suffixMatch = correlationId.match(/[-_.]([a-zA-Z]+)$/);
    const suffixValue = suffixMatch?.[1];
    if (suffixValue !== undefined) {
      result.suffix = suffixValue;
    }

    // Extract timestamp (13-digit unix timestamp)
    const timestampMatch = correlationId.match(/(\d{13})/);
    if (timestampMatch && timestampMatch[1]) {
      result.timestamp = parseInt(timestampMatch[1], 10);
    }

    // Extract process ID
    const pidMatch = correlationId.match(/[-_.](\d{4,6})[-_.]/);
    if (pidMatch && pidMatch[1]) {
      result.processId = parseInt(pidMatch[1], 10);
    }

    // Detect strategy
    if (correlationId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      result.strategy = CorrelationStrategy.UUID_V4;
    } else if (correlationId.includes('-') && parts.length > 1) {
      result.strategy = CorrelationStrategy.HIERARCHICAL;
    } else if (correlationId.match(/^\d{13}-[0-9a-f]+$/)) {
      result.strategy = CorrelationStrategy.TIMESTAMP;
    }
  }
}

/**
 * Correlation ID - 2025
 */
export class CorrelationUtils {
  private static manager = new EnhancedCorrelationManager();

  /**
   * Correlation ID
   */
  static generate(strategy?: CorrelationStrategy, config?: Partial<CorrelationConfig>): string {
    if (config || strategy !== CorrelationStrategy.UUID_V4) {
      const manager = new EnhancedCorrelationManager({
        strategy: strategy || CorrelationStrategy.UUID_V4,
        ...config
      });
      return manager.generate();
    }

    return this.manager.generate();
  }

  /**
   */
  static extractFromSources(
    req: Request,
    context?: Partial<LogContext>,
    fallbackStrategy: CorrelationStrategy = CorrelationStrategy.UUID_V4
  ): string {
    // Priority order:
    // 1. Explicit context correlationId
    // 2. HTTP request headers
    // 3. Generate new with fallback strategy

    if (context?.correlationId) {
      return context.correlationId;
    }

    const extracted = this.manager.extractFromRequest(req);
    if (extracted) {
      return extracted;
    }

    return this.generate(fallbackStrategy);
  }

  /**
   * Correlation ID
   */
  static validate(correlationId: string): ParsedCorrelationId {
    return this.manager.validate(correlationId);
  }

  /**
   */
  static createHeaders(context: Partial<LogContext>): Record<string, string> {
    const headers: Record<string, string> = {};

    if (context.correlationId) {
      headers['x-correlation-id'] = context.correlationId;
    }

    if (context.requestId) {
      headers['x-request-id'] = context.requestId;
    }

    if (context.traceId) {
      headers['x-trace-id'] = context.traceId;
    }

    if (context.spanId) {
      headers['x-span-id'] = context.spanId;
    }

    if (context.userId) {
      headers['x-user-id'] = context.userId;
    }

    return headers;
  }

  /**
   * trading-specific Correlation ID
   */
  static generateTradingId(
    operation: 'order' | 'trade' | 'position' | 'analysis' | 'risk',
    exchange?: string,
    symbol?: string
  ): string {
    const context = {
      operation,
      exchange: exchange?.toLowerCase(),
      symbol: symbol?.toLowerCase().replace('/', '-'),
    };

    const manager = new EnhancedCorrelationManager({
      strategy: CorrelationStrategy.CRYPTO_TRADING,
    });

    return manager.generate(undefined, context);
  }
}

/**
 * Correlation ID
 */
export const CORRELATION_CONFIGS = {
  // Standard web API
  WEB_API: {
    strategy: CorrelationStrategy.UUID_V4,
    prefix: 'web',
    minLength: 32,
    maxLength: 64,
  } as CorrelationConfig,

  // Microservices with hierarchical tracking
  MICROSERVICE: {
    strategy: CorrelationStrategy.HIERARCHICAL,
    prefix: 'ms',
    separator: '.',
    includeHostname: true,
    includePid: true,
  } as CorrelationConfig,

  // High-performance trading
  TRADING_HFT: {
    strategy: CorrelationStrategy.SHORT_UUID,
    length: 12,
    includeTimestamp: true,
    enableHashing: true,
    hashAlgorithm: 'md5',
  } as CorrelationConfig,

  // OpenTelemetry compliance
  OPENTELEMETRY: {
    strategy: CorrelationStrategy.OPENTELEMETRY,
    minLength: 32,
    maxLength: 32,
  } as CorrelationConfig,

  // Development/debugging
  DEBUG: {
    strategy: CorrelationStrategy.TIMESTAMP,
    prefix: 'debug',
    separator: '-',
    includeTimestamp: true,
    includeHostname: true,
    includePid: true,
  } as CorrelationConfig,

  // Production security-focused
  PRODUCTION: {
    strategy: CorrelationStrategy.UUID_V4,
    enableHashing: true,
    hashAlgorithm: 'sha256',
    minLength: 64,
    maxLength: 64,
  } as CorrelationConfig,
} as const;