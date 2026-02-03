/**
 * Logger Interfaces - 2025 Enterprise Logging Contracts
 *
 * @description enterprise-grade
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance GDPR, SOX, ISO27001
 * @patterns Strategy, Factory, Observer
 */

import type { Request } from 'express';

/**
 * 2025
 */
export enum LogLevel {
  EMERGENCY = 'emergency', // System unusable - immediate attention
  ALERT = 'alert',         // Immediate action required
  CRITICAL = 'critical',   // Critical conditions
  ERROR = 'error',         // Error conditions
  WARNING = 'warning',     // Warning conditions
  NOTICE = 'notice',       // Normal but significant
  INFO = 'info',           // Informational messages
  DEBUG = 'debug',         // Debug-level messages
  TRACE = 'trace',         // Trace-level messages (most verbose)
}

/**
 */
export enum LoggerAdapter {
  WINSTON = 'winston',
  PINO = 'pino',
  CONSOLE = 'console',
  ELASTIC = 'elasticsearch',
  SYSLOG = 'syslog',
  FILE = 'file',
  HTTP = 'http',
}

/**
 * - 2025
 */
export interface LogContext {
  // Request Context
  correlationId: string;
  requestId?: string;
  sessionId?: string;
  userId?: string;

  // Distributed Tracing
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  baggage?: Record<string, string>;

  // Application Context
  service: string;
  version: string;
  environment: string;
  component?: string;
  operation?: string;

  // Business Context
  tenantId?: string;
  organizationId?: string;
  workspaceId?: string;

  // Technical Context
  hostname: string;
  processId: number;
  threadId?: string;

  // Security Context
  ipAddress?: string;
  userAgent?: string;
  securityLevel?: 'public' | 'internal' | 'confidential' | 'restricted';

  // Trading Context ( specific)
  symbol?: string;
  exchange?: string;
  orderId?: string;
  portfolioId?: string;
  strategyId?: string;
  tradingMode?: string;

  // Gateway Context
  gatewayVersion?: string;

  // Testing Context
  testSuite?: string;
  testMode?: boolean;

  // Performance Context
  performanceOptimized?: boolean;

  // Metadata
  metadata?: Record<string, any>;
  tags?: string[];
  labels?: Record<string, string>;
}

/**
 */
export interface LogTransportConfig {
  adapter: LoggerAdapter;
  level: LogLevel;
  enabled: boolean;

  // Transport specific options
  options?: {
    // File transport
    filename?: string;
    maxSize?: string;
    maxFiles?: number;
    destination?: string; // Pino destination

    // HTTP transport
    url?: string;
    headers?: Record<string, string>;
    timeout?: number;

    // Elasticsearch
    esHost?: string;
    index?: string;

    // Console formatting
    colorize?: boolean;
    json?: boolean;
    prettyPrint?: boolean;
    timestamp?: boolean | string;

    // Common options
    format?: string;
    datePattern?: string;
    zippedArchive?: boolean;

    // Performance options
    bufferSize?: number;
    flushSync?: boolean;
    extreme?: boolean; // Pino extreme mode
  };
}

/**
 */
export interface UnifiedLoggerConfig {
  // Base configuration
  service: string;
  version: string;
  environment: string;
  defaultLevel: LogLevel;

  // Context preservation
  enableContextPreservation: boolean;
  contextNamespace?: string;

  // Performance
  bufferSize?: number;
  flushInterval?: number;
  asyncLogging?: boolean;

  // Security
  enableSensitiveDataMasking: boolean;
  sensitiveFields?: string[];
  enableEncryption?: boolean;
  encryptionKey?: string;

  // OpenTelemetry integration
  enableOpenTelemetry: boolean;
  otelServiceName?: string;
  otelEndpoint?: string;

  // Correlation tracking
  enableCorrelationTracking: boolean;
  correlationHeaderNames?: string[];

  // Transports
  transports: LogTransportConfig[];

  // Sampling (for high-volume systems)
  sampling?: {
    enabled: boolean;
    rate: number; // 0.1 = 10% of logs
    priorityLevels?: LogLevel[]; // Always log these levels
  };

  // Circuit breaker for transport failures
  circuitBreaker?: {
    enabled: boolean;
    failureThreshold: number;
    resetTimeout: number;
  };
}

/**
 */
export interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: string;
  context: Partial<LogContext>;

  // Structured data
  data?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    cause?: any;
  };

  // Performance metrics
  performance?: {
    duration?: number;
    memoryUsage?: NodeJS.MemoryUsage;
    cpuUsage?: NodeJS.CpuUsage;
  };

  // Security audit
  security?: {
    eventType: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    actor?: string;
    resource?: string;
    action?: string;
    result: 'success' | 'failure' | 'blocked';
  };

  // Business events
  business?: {
    eventType: string;
    category: string;
    value?: number;
    currency?: string;
    metadata?: Record<string, any>;
  };
}

/**
 */
export interface SensitiveDataMask {
  field: string | RegExp;
  replacement: string | ((value: any) => string);
  level: 'partial' | 'full' | 'hash';
}

/**
 */
export interface LogResult {
  success: boolean;
  messageId?: string;
  errors?: Array<{
    transport: LoggerAdapter;
    error: Error;
  }>;
  timestamp: string;
  retryable: boolean;
}

/**
 */
export interface LogFilter {
  levels?: LogLevel[];
  services?: string[];
  components?: string[];
  tags?: string[];
  timeRange?: {
    from: Date;
    to: Date;
  };
  customFilter?: (message: LogMessage) => boolean;
}

/**
 */
export interface LogStats {
  totalMessages: number;
  messagesByLevel: Record<LogLevel, number>;
  messagesByTransport: Record<LoggerAdapter, number>;
  errors: number;
  avgResponseTime: number;
  lastMessageTime: string;
}

/**
 */
export interface IUnifiedLogger {
  // Core logging methods
  log(level: LogLevel, message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult>;
  emergency(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult>;
  alert(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult>;
  critical(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult>;
  error(message: string, error?: Error, data?: any, context?: Partial<LogContext>): Promise<LogResult>;
  warn(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult>;
  notice(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult>;
  info(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult>;
  debug(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult>;
  trace(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult>;

  // Context management
  setContext(context: Partial<LogContext>): void;
  getContext(): Partial<LogContext>;
  clearContext(): void;
  withContext<T>(context: Partial<LogContext>, fn: () => Promise<T>): Promise<T>;

  // Child loggers
  child(context: Partial<LogContext>): IUnifiedLogger;

  // Performance tracking
  startTimer(operationName: string, metadata?: any): string;
  endTimer(timerId: string, success?: boolean, metadata?: any): Promise<LogResult>;

  // Business & Security events
  auditSecurity(eventType: string, result: 'success' | 'failure' | 'blocked', details?: any): Promise<LogResult>;
  auditBusiness(eventType: string, category: string, data?: any): Promise<LogResult>;

  // HTTP request logging
  logHttpRequest(req: Request, res: { statusCode: number }, responseTime: number): Promise<LogResult>;

  // Trading specific ()
  logTradingEvent(eventType: 'order' | 'execution' | 'position' | 'risk', data: any): Promise<LogResult>;

  // Utilities
  flush(): Promise<void>;
  getStats(): LogStats;
  isEnabled(level: LogLevel): boolean;
}

/**
 */
export interface ILogTransport {
  readonly adapter: LoggerAdapter;
  readonly config: LogTransportConfig;

  write(message: LogMessage): Promise<void>;
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 */
export interface ILoggerFactory {
  create(config: UnifiedLoggerConfig): IUnifiedLogger;
  createChild(parent: IUnifiedLogger, context: Partial<LogContext>): IUnifiedLogger;
}

/**
 * middleware
 */
export interface ILoggerMiddleware {
  attach(logger: IUnifiedLogger): void;
  process(message: LogMessage): Promise<LogMessage>;
}