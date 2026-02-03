/**
 * Unified Logger Service - 2025 Enterprise Logging Core
 *
 * @description Enterprise patterns
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance SOX, GDPR, PCI DSS, ISO 27001
 * @patterns Singleton, Strategy, Observer, Chain of Responsibility
 */

import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { hostname } from 'os';

import type { Request } from 'express';

import {
  type IUnifiedLogger,
  type ILogTransport,
  type LogMessage,
  type LogContext,
  LogLevel,
  LoggerAdapter,
  type LogResult,
  type LogStats,
  type UnifiedLoggerConfig,
} from '../interfaces/logger.interface';
import { EnhancedCorrelationManager, CorrelationStrategy } from '../utils/correlation-id.utils';
import { SensitiveDataMasker, MASKING_CONFIGS } from '../utils/sensitive-data.utils';

/**
 */
interface PerformanceTimer {
  id: string;
  operationName: string;
  startTime: number;
  metadata?: any;
}

/**
 * Logger Service - 2025 Enterprise
 */
export class UnifiedLoggerService implements IUnifiedLogger {
  private readonly config: UnifiedLoggerConfig;
  private readonly transports: Map<string, ILogTransport> = new Map();
  private readonly correlationManager: EnhancedCorrelationManager;
  private readonly dataMasker: SensitiveDataMasker;
  private readonly contextStorage = new AsyncLocalStorage<LogContext>();

  // Performance tracking
  private readonly activeTimers = new Map<string, PerformanceTimer>();
  private readonly stats: LogStats = {
    totalMessages: 0,
    messagesByLevel: {} as Record<LogLevel, number>,
    messagesByTransport: {} as any,
    errors: 0,
    avgResponseTime: 0,
    lastMessageTime: '',
  };

  // Internal state
  private defaultContext: Partial<LogContext> = {};
  private circuitBreakerOpen = false;
  private lastCircuitBreakerReset = Date.now();

  constructor(config: UnifiedLoggerConfig) {
    // Merge config - spread
    this.config = {
      ...{
        bufferSize: 100,
        flushInterval: 5000,
        asyncLogging: true,
        enableContextPreservation: true,
        contextNamespace: 'unified-logger',
        enableSensitiveDataMasking: true,
        sensitiveFields: [],
        enableOpenTelemetry: true,
        enableCorrelationTracking: true,
        correlationHeaderNames: ['x-correlation-id', 'x-request-id'],
      },
      ...config,
    };

    this.correlationManager = new EnhancedCorrelationManager({
      strategy: CorrelationStrategy.UUID_V4,
    });

    this.dataMasker = new SensitiveDataMasker(
      this.config.environment === 'production' ?
        MASKING_CONFIGS.PRODUCTION :
        MASKING_CONFIGS.DEVELOPMENT
    );

    this.initializeDefaultContext();
    this.initializeTransports();
    this.initializeStats();
    this.setupPeriodicFlush();
  }

  // ==================== CORE LOGGING METHODS ====================

  async log(level: LogLevel, message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult> {
    return this.writeLog(level, message, data, undefined, context);
  }

  async emergency(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult> {
    return this.writeLog(LogLevel.EMERGENCY, message, data, undefined, context);
  }

  async alert(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult> {
    return this.writeLog(LogLevel.ALERT, message, data, undefined, context);
  }

  async critical(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult> {
    return this.writeLog(LogLevel.CRITICAL, message, data, undefined, context);
  }

  async error(message: string, error?: Error, data?: any, context?: Partial<LogContext>): Promise<LogResult> {
    return this.writeLog(LogLevel.ERROR, message, data, error, context);
  }

  async warn(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult> {
    return this.writeLog(LogLevel.WARNING, message, data, undefined, context);
  }

  async notice(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult> {
    return this.writeLog(LogLevel.NOTICE, message, data, undefined, context);
  }

  async info(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult> {
    return this.writeLog(LogLevel.INFO, message, data, undefined, context);
  }

  async debug(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult> {
    return this.writeLog(LogLevel.DEBUG, message, data, undefined, context);
  }

  async trace(message: string, data?: any, context?: Partial<LogContext>): Promise<LogResult> {
    return this.writeLog(LogLevel.TRACE, message, data, undefined, context);
  }

  // ==================== CONTEXT MANAGEMENT ====================

  setContext(context: Partial<LogContext>): void {
    this.defaultContext = { ...this.defaultContext, ...context };
  }

  getContext(): Partial<LogContext> {
    const asyncContext = this.contextStorage.getStore();
    return {
      ...this.defaultContext,
      ...asyncContext,
    };
  }

  clearContext(): void {
    this.defaultContext = {};
  }

  async withContext<T>(context: Partial<LogContext>, fn: () => Promise<T>): Promise<T> {
    if (!this.config.enableContextPreservation) {
      return fn();
    }

    const mergedContext = {
      ...this.getContext(),
      ...context,
    };

    return this.contextStorage.run(mergedContext as LogContext, fn);
  }

  // ==================== CHILD LOGGER ====================

  child(context: Partial<LogContext>): IUnifiedLogger {
    const childConfig = { ...this.config };
    const childLogger = new UnifiedLoggerService(childConfig);

    // Copy transports
    this.transports.forEach((transport, key) => {
      childLogger.transports.set(key, transport);
    });

    // Merge context
    childLogger.setContext({
      ...this.getContext(),
      ...context,
    });

    return childLogger;
  }

  // ==================== PERFORMANCE TRACKING ====================

  startTimer(operationName: string, metadata?: any): string {
    const timerId = randomUUID();
    const timer: PerformanceTimer = {
      id: timerId,
      operationName,
      startTime: Date.now(),
      metadata,
    };

    this.activeTimers.set(timerId, timer);

    // Log timer start if debug enabled
    if (this.isEnabled(LogLevel.DEBUG)) {
      this.debug(`Performance timer started: ${operationName}`, {
        timerId,
        operationName,
        metadata,
      });
    }

    return timerId;
  }

  async endTimer(timerId: string, success: boolean = true, metadata?: any): Promise<LogResult> {
    const timer = this.activeTimers.get(timerId);
    if (!timer) {
      return this.warn(`Timer not found: ${timerId}`, { timerId });
    }

    const endTime = Date.now();
    const duration = endTime - timer.startTime;

    this.activeTimers.delete(timerId);

    const performance = {
      duration,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
    };

    const level = success ? LogLevel.INFO : LogLevel.WARNING;
    const message = `Performance timer ended: ${timer.operationName} (${duration}ms)`;

    return this.writeLog(level, message, {
      timerId,
      operationName: timer.operationName,
      success,
      startMetadata: timer.metadata,
      endMetadata: metadata,
    }, undefined, undefined, { performance });
  }

  // ==================== SPECIALIZED LOGGING ====================

  async auditSecurity(
    eventType: string,
    result: 'success' | 'failure' | 'blocked',
    details?: any
  ): Promise<LogResult> {
    const context = this.getContext();
    const security = {
      eventType,
      severity: result === 'blocked' ? 'high' as const : 'medium' as const,
      actor: context.userId || 'anonymous',
      resource: details?.resource || 'unknown',
      action: eventType,
      result,
    };

    const level = result === 'failure' || result === 'blocked' ? LogLevel.WARNING : LogLevel.INFO;
    return this.writeLog(level, `Security event: ${eventType}`, details, undefined, undefined, { security });
  }

  async auditBusiness(eventType: string, category: string, data?: any): Promise<LogResult> {
    const business = {
      eventType,
      category,
      value: data?.value,
      currency: data?.currency,
      metadata: data,
    };

    return this.writeLog(LogLevel.INFO, `Business event: ${eventType}`, data, undefined, undefined, { business });
  }

  async logHttpRequest(req: Request, res: { statusCode: number }, responseTime: number): Promise<LogResult> {
    const correlationId = this.correlationManager.extractFromRequest(req) ||
      this.correlationManager.generate();

    // context ( undefined)
    const context: Partial<LogContext> = {
      correlationId,
    };

    if (req.ip) {
      context.ipAddress = req.ip;
    }
    const userAgent = req.headers['user-agent'.toLowerCase()];
    if (userAgent) {
      context.userAgent = Array.isArray(userAgent) ? userAgent.join(', ') : userAgent;
    }

    const data = {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      responseTime,
      headers: this.filterHeaders(req.headers),
      query: req.query,
    };

    const level = res.statusCode >= 400 ? LogLevel.WARNING : LogLevel.INFO;
    return this.writeLog(level, `HTTP ${req.method} ${req.url}`, data, undefined, context);
  }

  async logTradingEvent(eventType: 'order' | 'execution' | 'position' | 'risk', data: any): Promise<LogResult> {
    const correlationId = this.correlationManager.generate(undefined, { operation: eventType });

    const context: Partial<LogContext> = {
      correlationId,
      symbol: data.symbol,
      exchange: data.exchange,
      orderId: data.orderId,
      portfolioId: data.portfolioId,
      strategyId: data.strategyId,
    };

    return this.writeLog(LogLevel.INFO, `Trading ${eventType}`, data, undefined, context);
  }

  // ==================== UTILITY METHODS ====================

  async flush(): Promise<void> {
    const flushPromises = Array.from(this.transports.values()).map(transport => {
      if ('flush' in transport && typeof transport.flush === 'function') {
        return transport.flush();
      }
      return Promise.resolve();
    });

    await Promise.allSettled(flushPromises);
  }

  getStats(): LogStats {
    return { ...this.stats };
  }

  isEnabled(level: LogLevel): boolean {
    return this.isLevelEnabled(level) && !this.circuitBreakerOpen;
  }

  // ==================== PRIVATE METHODS ====================

  private async writeLog(
    level: LogLevel,
    message: string,
    data?: any,
    error?: Error,
    context?: Partial<LogContext>,
    additionalFields?: any
  ): Promise<LogResult> {
    const startTime = Date.now();

    // Check if level is enabled
    if (!this.isEnabled(level)) {
      return {
        success: true,
        timestamp: new Date().toISOString(),
        retryable: false,
      };
    }

    // Check circuit breaker
    if (this.circuitBreakerOpen) {
      return this.handleCircuitBreakerOpen();
    }

    try {
      // Build complete context
      const completeContext = this.buildCompleteContext(context);

      // Mask sensitive data
      const maskedData = this.config.enableSensitiveDataMasking ?
        this.dataMasker.maskShallow(data) : data;

      // Create log message
      const logMessage: LogMessage = {
        level,
        message,
        timestamp: new Date().toISOString(),
        context: completeContext,
        data: maskedData,
        error: error ? this.serializeError(error) : undefined,
        ...additionalFields,
      };

      // Write to all transports
      const result = await this.writeToTransports(logMessage);

      // Update stats
      this.updateStats(level, Date.now() - startTime);

      return result;
    } catch (error) {
      return this.handleLogError(error as Error);
    }
  }

  private buildCompleteContext(context?: Partial<LogContext>): Partial<LogContext> {
    const asyncContext = this.contextStorage.getStore();

    return {
      ...this.defaultContext,
      ...asyncContext,
      ...context,
      correlationId: context?.correlationId ||
        asyncContext?.correlationId ||
        this.defaultContext.correlationId ||
        this.correlationManager.generate(),
    };
  }

  private async writeToTransports(message: LogMessage): Promise<LogResult> {
    const errors: Array<{ transport: LoggerAdapter; error: Error }> = [];
    const promises: Promise<void>[] = [];

    for (const [_name, transport] of this.transports) {
      if (!transport.config.enabled) {continue;}

      const promise = transport.write(message).catch((error) => {
        errors.push({ transport: transport.adapter, error });
      });

      if (this.config.asyncLogging) {
        promises.push(promise);
      } else {
        await promise;
      }
    }

    if (this.config.asyncLogging) {
      await Promise.allSettled(promises);
    }

    const success = errors.length === 0;
    if (errors.length > 0) {
      this.stats.errors += errors.length;
    }

    // result
    const result: LogResult = {
      success,
      messageId: message.context.correlationId || 'unknown',
      timestamp: message.timestamp,
      retryable: errors.some(e => this.isRetryableError(e.error)),
    };

    // errors
    if (errors.length > 0) {
      result.errors = errors;
    }

    return result;
  }

  private initializeDefaultContext(): void {
    this.defaultContext = {
      service: this.config.service,
      version: this.config.version,
      environment: this.config.environment,
      hostname: hostname(),
      processId: process.pid,
    };
  }

  private initializeTransports(): void {
    this.config.transports.forEach((_transportConfig, _index) => {
      // Transport initialization would be done by factory
      // This is a placeholder for transport registration
      // Transport addTransport()
    });
  }

  private initializeStats(): void {
    // Initialize stats for all log levels
    const levels = ['emergency', 'alert', 'critical', 'error', 'warning', 'notice', 'info', 'debug', 'trace'];
    levels.forEach(level => {
      this.stats.messagesByLevel[level as LogLevel] = 0;
    });

    this.config.transports.forEach(transport => {
      this.stats.messagesByTransport[transport.adapter] = 0;
    });
  }

  private setupPeriodicFlush(): void {
    if (this.config.flushInterval && this.config.flushInterval > 0) {
      setInterval(() => {
        this.flush().catch(console.error);
      }, this.config.flushInterval);
    }
  }

  private isLevelEnabled(level: LogLevel): boolean {
    const levelPriority = this.getLevelPriority(level);
    const configPriority = this.getLevelPriority(this.config.defaultLevel);
    return levelPriority <= configPriority;
  }

  private getLevelPriority(level: LogLevel): number {
    const priorities: Record<LogLevel, number> = {
      [LogLevel.EMERGENCY]: 0,
      [LogLevel.ALERT]: 1,
      [LogLevel.CRITICAL]: 2,
      [LogLevel.ERROR]: 3,
      [LogLevel.WARNING]: 4,
      [LogLevel.NOTICE]: 5,
      [LogLevel.INFO]: 6,
      [LogLevel.DEBUG]: 7,
      [LogLevel.TRACE]: 8,
    };

    return priorities[level] ?? 6;
  }

  private updateStats(level: LogLevel, responseTime: number): void {
    this.stats.totalMessages++;
    this.stats.messagesByLevel[level]++;
    this.stats.lastMessageTime = new Date().toISOString();

    // Update average response time
    const totalTime = this.stats.avgResponseTime * (this.stats.totalMessages - 1) + responseTime;
    this.stats.avgResponseTime = totalTime / this.stats.totalMessages;
  }

  private serializeError(error: Error): any {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as any).code,
      cause: (error as any).cause,
    };
  }

  private filterHeaders(headers: any): any {
    const filtered = { ...headers };
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];

    sensitiveHeaders.forEach(header => {
      if (filtered[header]) {
        filtered[header] = '[REDACTED]';
      }
    });

    return filtered;
  }

  private isRetryableError(error: Error): boolean {
    // Network errors, timeouts, etc. are typically retryable
    return error.message.includes('timeout') ||
           error.message.includes('network') ||
           error.message.includes('ECONNRESET');
  }

  private handleCircuitBreakerOpen(): LogResult {
    const now = Date.now();
    const resetTimeout = this.config.circuitBreaker?.resetTimeout || 60000;

    if (now - this.lastCircuitBreakerReset > resetTimeout) {
      this.circuitBreakerOpen = false;
      this.lastCircuitBreakerReset = now;
    }

    return {
      success: false,
      timestamp: new Date().toISOString(),
      retryable: true,
      errors: [{ transport: LoggerAdapter.CONSOLE, error: new Error('Circuit breaker is open') }],
    };
  }

  private handleLogError(error: Error): LogResult {
    this.stats.errors++;

    // Open circuit breaker if too many failures
    if (this.config.circuitBreaker?.enabled) {
      const threshold = this.config.circuitBreaker.failureThreshold;
      if (this.stats.errors >= threshold) {
        this.circuitBreakerOpen = true;
        this.lastCircuitBreakerReset = Date.now();
      }
    }

    return {
      success: false,
      timestamp: new Date().toISOString(),
      retryable: this.isRetryableError(error),
      errors: [{ transport: LoggerAdapter.CONSOLE, error }],
    };
  }

  /**
   */
  addTransport(name: string, transport: ILogTransport): void {
    this.transports.set(name, transport);
    this.stats.messagesByTransport[transport.adapter] = 0;
  }

  /**
   */
  removeTransport(name: string): boolean {
    return this.transports.delete(name);
  }

  /**
   */
  getTransports(): Map<string, ILogTransport> {
    return new Map(this.transports);
  }

  /**
   */
  async checkTransportsHealth(): Promise<Record<string, boolean>> {
    const health: Record<string, boolean> = {};

    for (const [name, transport] of this.transports) {
      try {
        health[name] = await transport.isHealthy();
      } catch {
        health[name] = false;
      }
    }

    return health;
  }
}