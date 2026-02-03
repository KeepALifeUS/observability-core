/**
 * Pino Transport Adapter - 2025 High-Performance Logging
 *
 * @description Pino
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance High-Frequency Trading Performance Standards
 * @patterns Adapter, Strategy, Async Buffer
 */

import { hostname } from 'os';
import * as pino from 'pino';

import { type ILogTransport, type LogMessage, type LogTransportConfig, LoggerAdapter, LogLevel } from '../interfaces/logger.interface';

/**
 * SonicBoom type definition (minimal for our needs)
 */
interface SonicBoom extends NodeJS.EventEmitter {
  write(str: string): boolean;
  flush(cb?: (err?: Error) => void): void;
  end(): void;
  destroy(): void;
}

/**
 * Pino
 */
export interface PinoTransportConfig extends LogTransportConfig {
  adapter: LoggerAdapter.PINO;
  pinoOptions?: {
    // Basic options
    prettyPrint?: boolean | Record<string, any>;
    safe?: boolean;
    redact?: string[] | pino.redactOptions;

    // Performance options
    disableRequestLogging?: boolean;
    extreme?: boolean;

    // Serializers
    serializers?: Record<string, pino.SerializerFn>;

    // Pretty printing options
    colorize?: boolean;
    translateTime?: boolean | string;
    ignore?: string;
    include?: string;

    // Destination options
    destination?: string | pino.DestinationStream;

    // Custom options for high-frequency trading
    bufferSize?: number;
    flushSync?: boolean;
    minLength?: number;

    // Custom hooks
    hooks?: {
      logMethod?: (inputArgs: any[], method: pino.LogFn) => void;
    };
  };
}

/**
 * Pino Transport Adapter - Optimized for HFT
 */
export class PinoTransport implements ILogTransport {
  public readonly adapter = LoggerAdapter.PINO;
  public readonly config: PinoTransportConfig;

  private logger: pino.Logger;
  private destination: pino.DestinationStream | SonicBoom | undefined;
  private isHealthyFlag = true;
  private lastError: Error | null = null;
  private failureCount = 0;
  private messageCount = 0;
  private lastFlush = Date.now();
  private buffer: LogMessage[] = [];

  constructor(config: PinoTransportConfig) {
    // Merge config properly to avoid duplicates
    const { level, enabled, ...restConfig } = config;
    this.config = {
      ...restConfig,
      level: level ?? LogLevel.INFO,
      enabled: enabled ?? true,
    };

    this.setupDestination();
    this.logger = this.createPinoLogger();
    this.setupErrorHandlers();
    this.setupPeriodicFlush();
  }

  /**
   */
  async write(message: LogMessage): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      this.messageCount++;

      // Buffer messages for batch processing if configured
      if (this.shouldBufferMessage()) {
        this.buffer.push(message);

        if (this.shouldFlushBuffer()) {
          await this.flushBuffer();
        }
        return;
      }

      await this.writeMessage(message);
      this.resetFailureCount();
    } catch (error) {
      this.handleTransportError(error as Error);
      throw error;
    }
  }

  /**
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Quick health check - try to write a small message
      const testMessage: LogMessage = {
        level: LogLevel.DEBUG,
        message: 'pino-health-check',
        timestamp: new Date().toISOString(),
        context: {
          correlationId: 'health-check',
          service: 'pino-transport',
          version: '3.0.0',
          environment: 'test',
          hostname: hostname(),
          processId: process.pid,
        },
      };

      await this.writeMessage(testMessage);
      this.isHealthyFlag = true;
      this.lastError = null;
    } catch (error) {
      this.isHealthyFlag = false;
      this.lastError = error as Error;
    }

    return this.isHealthyFlag;
  }

  /**
   */
  async close(): Promise<void> {
    try {
      // Flush any remaining buffered messages
      if (this.buffer.length > 0) {
        await this.flushBuffer();
      }

      // Close destination if it exists and is SonicBoom
      if (this.destination && this.isSonicBoom(this.destination)) {
        const sonicBoomDest = this.destination as SonicBoom;
        await new Promise<void>((resolve) => {
          sonicBoomDest.end();
          resolve();
        });
      }

      // Flush pino logger
      this.logger.flush();
    } catch (error) {
      console.error('Error closing Pino transport:', error);
    }
  }

  /**
   * Pino
   */
  getStats(): Record<string, any> {
    return {
      adapter: this.adapter,
      enabled: this.config.enabled,
      level: this.config.level,
      healthy: this.isHealthyFlag,
      failureCount: this.failureCount,
      messageCount: this.messageCount,
      bufferSize: this.buffer.length,
      lastError: this.lastError?.message,
      lastFlush: new Date(this.lastFlush).toISOString(),
      performance: {
        messagesPerSecond: this.calculateMessagesPerSecond(),
        avgMessageSize: this.calculateAvgMessageSize(),
      },
    };
  }

  /**
   * flush
   */
  async flush(): Promise<void> {
    if (this.buffer.length > 0) {
      await this.flushBuffer();
    }

    if (this.destination && this.isSonicBoom(this.destination)) {
      const sonicBoomDest = this.destination as SonicBoom;
      await new Promise<void>((resolve, reject) => {
        sonicBoomDest.flush((err?: Error) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }

    this.logger.flush();
  }

  // ==================== PRIVATE METHODS ====================

  private setupDestination(): void {
    const options = this.config.pinoOptions || {};

    if (options.destination) {
      if (typeof options.destination === 'string') {
        // File destination
        this.destination = pino.destination({
          dest: options.destination,
          minLength: options.minLength || 4096,
          sync: options.flushSync || false,
        });
      } else {
        // Custom destination stream
        this.destination = options.destination;
      }
    } else if (process.env['NODE_ENV'] === 'production' && !options.prettyPrint) {
      // High-performance destination for production
      this.destination = pino.destination({
        minLength: options.minLength || 4096,
        sync: false,
      });
    }
  }

  /**
   * Type guard , destination SonicBoom
   */
  private isSonicBoom(destination: any): destination is SonicBoom {
    return destination && typeof destination.flush === 'function' && typeof destination.end === 'function';
  }

  private createPinoLogger(): pino.Logger {
    const options = this.config.pinoOptions || {};

    // Build config incrementally to satisfy exactOptionalPropertyTypes
    const pinoConfig: pino.LoggerOptions = {
      level: this.mapLogLevel(this.config.level),
      safe: options.safe !== false, // Default to true for safety
    };

    // Add serializers
    if (options.serializers) {
      pinoConfig.serializers = {
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
        ...options.serializers,
      };
    } else {
      pinoConfig.serializers = {
        error: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      };
    }

    // Add redact
    if (options.redact) {
      pinoConfig.redact = options.redact;
    } else {
      pinoConfig.redact = ['password', 'secret', 'token', 'apiKey'];
    }

    // Add hooks if present
    if (options.hooks) {
      pinoConfig.hooks = options.hooks;
    }

    // Pretty printing for development (note: pino.pretty() not available in v8.21.0)
    // Use pino-pretty as a transport instead if needed
    if (options.prettyPrint && process.env['NODE_ENV'] !== 'production') {
      // For pretty printing in pino@8.21.0, you need to use transport option
      // This is a simplified fallback - just use destination logger
      if (this.destination) {
        return pino.default(pinoConfig, this.destination);
      }
      return pino.default(pinoConfig);
    }

    // Production logger with destination
    if (this.destination) {
      return pino.default(pinoConfig, this.destination);
    }

    // Default logger
    return pino.default(pinoConfig);
  }

  private async writeMessage(message: LogMessage): Promise<void> {
    const pinoLevel = this.mapLogLevel(message.level);
    const formattedMessage = this.formatMessage(message);

    return new Promise((resolve, reject) => {
      const logMethod = this.logger[pinoLevel as keyof pino.Logger] as pino.LogFn;

      try {
        if (message.error) {
          logMethod.call(this.logger, formattedMessage, message.error, message.message);
        } else {
          logMethod.call(this.logger, formattedMessage, message.message);
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  private shouldBufferMessage(): boolean {
    const bufferSize = this.config.pinoOptions?.bufferSize;
    return bufferSize !== undefined && bufferSize > 0;
  }

  private shouldFlushBuffer(): boolean {
    const bufferSize = this.config.pinoOptions?.bufferSize || 0;
    const timeSinceLastFlush = Date.now() - this.lastFlush;

    return this.buffer.length >= bufferSize || timeSinceLastFlush > 5000; // 5 seconds
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) {return;}

    const messages = [...this.buffer];
    this.buffer = [];
    this.lastFlush = Date.now();

    // Write all buffered messages
    for (const message of messages) {
      try {
        await this.writeMessage(message);
      } catch (error) {
        // Re-add failed message to buffer for retry
        this.buffer.unshift(message);
        throw error;
      }
    }
  }

  private mapLogLevel(level: LogLevel): string {
    const levelMap: Record<LogLevel, string> = {
      [LogLevel.EMERGENCY]: 'fatal',
      [LogLevel.ALERT]: 'fatal',
      [LogLevel.CRITICAL]: 'fatal',
      [LogLevel.ERROR]: 'error',
      [LogLevel.WARNING]: 'warn',
      [LogLevel.NOTICE]: 'info',
      [LogLevel.INFO]: 'info',
      [LogLevel.DEBUG]: 'debug',
      [LogLevel.TRACE]: 'trace',
    };

    return levelMap[level] || 'info';
  }

  private formatMessage(message: LogMessage): any {
    const { level, message: msg, timestamp, context, data, error: _error, performance, security, business, ...rest } = message;

    // Build Pino message object
    const pinoMessage: any = {
      time: new Date(timestamp).getTime(),
      level: this.mapLogLevel(level),
      msg,
      ...context,
      ...rest,
    };

    // Add structured data
    if (data) {
      pinoMessage.data = data;
    }

    // Performance metrics
    if (performance) {
      pinoMessage.performance = performance;
    }

    // Security audit
    if (security) {
      pinoMessage.security = security;
    }

    // Business events
    if (business) {
      pinoMessage.business = business;
    }

    return pinoMessage;
  }

  private setupErrorHandlers(): void {
    if (this.destination && this.isSonicBoom(this.destination)) {
      this.destination.on('error', (error: Error) => {
        this.handleTransportError(error);
      });
    }

    // Monitor process for uncaught errors
    process.on('uncaughtException', (error: Error) => {
      if (error.message?.includes('pino')) {
        this.handleTransportError(error);
      }
    });
  }

  private setupPeriodicFlush(): void {
    if (this.config.pinoOptions?.bufferSize) {
      // Set up periodic flush for buffered messages
      setInterval(() => {
        if (this.buffer.length > 0) {
          this.flushBuffer().catch((error) => {
            this.handleTransportError(error);
          });
        }
      }, 5000); // Flush every 5 seconds
    }
  }

  private handleTransportError(error: Error): void {
    this.lastError = error;
    this.failureCount++;
    this.isHealthyFlag = false;

    // Log error to console for debugging
    if (process.env['NODE_ENV'] === 'development') {
      console.error(`[PinoTransport] Error:`, error.message);
    }

    // Circuit breaker logic
    if (this.failureCount > 10) {
      console.error(`[PinoTransport] Too many failures (${this.failureCount}), disabling transport`);
      this.config.enabled = false;
    }
  }

  private resetFailureCount(): void {
    if (this.failureCount > 0) {
      this.failureCount = 0;
      this.lastError = null;

      // Re-enable if it was disabled due to failures
      if (!this.config.enabled && this.failureCount === 0) {
        this.config.enabled = true;
      }
    }
  }

  private calculateMessagesPerSecond(): number {
    // Simple calculation - could be improved with sliding window
    const uptime = process.uptime() * 1000; // Convert to milliseconds
    return uptime > 0 ? Math.round(this.messageCount / (uptime / 1000)) : 0;
  }

  private calculateAvgMessageSize(): number {
    // This is a placeholder - actual implementation would track message sizes
    return 256; // Average estimated size in bytes
  }
}

/**
 * Pino
 */
export class PinoTransportFactory {
  /**
   * pretty printing
   */
  static createConsole(config: Partial<PinoTransportConfig> = {}): PinoTransport {
    return new PinoTransport({
      adapter: LoggerAdapter.PINO,
      level: LogLevel.INFO,
      enabled: true,
      ...config,
      pinoOptions: {
        prettyPrint: true,
        colorize: true,
        translateTime: true,
        ignore: 'pid,hostname',
        ...config.pinoOptions,
      },
    });
  }

  /**
   */
  static createFile(filename: string, config: Partial<PinoTransportConfig> = {}): PinoTransport {
    return new PinoTransport({
      adapter: LoggerAdapter.PINO,
      level: LogLevel.INFO,
      enabled: true,
      ...config,
      pinoOptions: {
        destination: filename,
        minLength: 4096,
        flushSync: false,
        extreme: true,
        ...config.pinoOptions,
      },
    });
  }

  /**
   * HFT
   */
  static createBuffered(
    destination: string,
    bufferSize: number = 100,
    config: Partial<PinoTransportConfig> = {}
  ): PinoTransport {
    return new PinoTransport({
      adapter: LoggerAdapter.PINO,
      level: LogLevel.INFO,
      enabled: true,
      ...config,
      pinoOptions: {
        destination,
        bufferSize,
        minLength: 8192,
        flushSync: false,
        extreme: true,
        disableRequestLogging: true,
        ...config.pinoOptions,
      },
    });
  }

  /**
   * development
   */
  static createDevelopment(config: Partial<PinoTransportConfig> = {}): PinoTransport {
    return new PinoTransport({
      adapter: LoggerAdapter.PINO,
      level: LogLevel.DEBUG,
      enabled: true,
      ...config,
      pinoOptions: {
        prettyPrint: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
          include: 'level,time,msg',
        },
        safe: true,
        ...config.pinoOptions,
      },
    });
  }

  /**
   * production
   */
  static createProduction(
    destination?: string,
    config: Partial<PinoTransportConfig> = {}
  ): PinoTransport {
    // Build options incrementally to satisfy exactOptionalPropertyTypes
    const baseOptions: Partial<PinoTransportConfig['pinoOptions']> = {};

    if (destination) {
      baseOptions.destination = destination;
    }

    baseOptions.extreme = true;
    baseOptions.disableRequestLogging = true;
    baseOptions.redact = [
      'password', 'secret', 'token', 'apiKey', 'privateKey',
      'authorization', 'cookie', 'session', 'apiSecret'
    ];
    baseOptions.serializers = {
      error: pino.stdSerializers.err,
      req: (req: any) => ({
        method: req.method,
        url: req.url,
        headers: {
          'user-agent': req.headers['user-agent'],
          'content-type': req.headers['content-type'],
        },
      }),
      res: (res: any) => ({
        statusCode: res.statusCode,
        responseTime: res.responseTime,
      }),
    };

    return new PinoTransport({
      adapter: LoggerAdapter.PINO,
      level: config.level ?? LogLevel.INFO,
      enabled: config.enabled ?? true,
      ...config,
      pinoOptions: {
        ...baseOptions,
        ...config.pinoOptions,
      },
    });
  }
}