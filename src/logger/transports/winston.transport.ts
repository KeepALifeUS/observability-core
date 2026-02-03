/**
 * Winston Transport Adapter - 2025 Enterprise Logging
 *
 * @description Winston
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance Enterprise Logging Standards
 * @patterns Adapter, Strategy, Circuit Breaker
 */

import { hostname } from 'os';
import * as winston from 'winston';

import { type ILogTransport, type LogMessage, type LogTransportConfig, LoggerAdapter, LogLevel } from '../interfaces/logger.interface';

/**
 * Winston
 */
export interface WinstonTransportConfig extends LogTransportConfig {
  adapter: LoggerAdapter.WINSTON;
  winstonOptions?: {
    // File transport options
    filename?: string;
    dirname?: string;
    maxsize?: number;
    maxFiles?: number;
    tailable?: boolean;
    zippedArchive?: boolean;
    datePattern?: string;

    // Console transport options
    colorize?: boolean;
    prettyPrint?: boolean;
    timestamp?: boolean;
    handleExceptions?: boolean;
    humanReadableUnhandledException?: boolean;

    // HTTP transport options
    host?: string;
    port?: number;
    path?: string;
    ssl?: boolean;
    headers?: Record<string, string>;

    // ElasticSearch transport options
    index?: string;
    indexPrefix?: string;
    esHost?: string;
    mappingTemplate?: any;

    // Custom formatter
    customFormatter?: winston.Logform.Format;

    // Performance options
    bufferSize?: number;
    flushTimeout?: number;
  };
}

/**
 * Winston Transport Adapter - 2025
 */
export class WinstonTransport implements ILogTransport {
  public readonly adapter = LoggerAdapter.WINSTON;
  public readonly config: WinstonTransportConfig;

  private logger: winston.Logger;
  private isHealthyFlag = true;
  private lastError: Error | null = null;
  private failureCount = 0;
  private lastHealthCheck = 0;
  private readonly healthCheckInterval = 60000; // 1 minute

  constructor(config: WinstonTransportConfig) {
    this.config = {
      options: {},
      ...config,
      level: config.level ?? LogLevel.INFO,
      enabled: config.enabled ?? true,
    };

    this.logger = this.createWinstonLogger();
    this.setupErrorHandlers();
  }

  /**
   */
  async write(message: LogMessage): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Convert our LogMessage to Winston format
      const winstonLevel = this.mapLogLevel(message.level);
      const winstonMessage = this.formatMessage(message);

      await new Promise<void>((resolve, reject) => {
        this.logger.log(winstonLevel, winstonMessage.message, winstonMessage.meta, (error: Error) => {
          if (error) {
            this.handleTransportError(error);
            reject(error);
          } else {
            this.resetFailureCount();
            resolve();
          }
        });
      });
    } catch (error) {
      this.handleTransportError(error as Error);
      throw error;
    }
  }

  /**
   */
  async isHealthy(): Promise<boolean> {
    const now = Date.now();

    // Use cached result if recent
    if (now - this.lastHealthCheck < this.healthCheckInterval) {
      return this.isHealthyFlag;
    }

    try {
      // Try to write a test message
      await this.writeHealthCheck();
      this.isHealthyFlag = true;
      this.lastError = null;
    } catch (error) {
      this.isHealthyFlag = false;
      this.lastError = error as Error;
    }

    this.lastHealthCheck = now;
    return this.isHealthyFlag;
  }

  /**
   */
  async close(): Promise<void> {
    try {
      await new Promise<void>((resolve) => {
        this.logger.close();
        resolve();
      });
    } catch (error) {
      console.error('Error closing Winston transport:', error);
    }
  }

  /**
   * Winston
   */
  getStats(): Record<string, any> {
    return {
      adapter: this.adapter,
      enabled: this.config.enabled,
      level: this.config.level,
      healthy: this.isHealthyFlag,
      failureCount: this.failureCount,
      lastError: this.lastError?.message,
      lastHealthCheck: new Date(this.lastHealthCheck).toISOString(),
      transports: this.logger.transports.map(t => ({
        name: t.constructor.name,
        level: t.level,
        silent: t.silent,
      })),
    };
  }

  // ==================== PRIVATE METHODS ====================

  private createWinstonLogger(): winston.Logger {
    const formats: winston.Logform.Format[] = [
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
    ];

    // Add custom formatter if provided
    if (this.config.winstonOptions?.customFormatter) {
      formats.push(this.config.winstonOptions.customFormatter);
    } else {
      // Default JSON formatter
      formats.push(winston.format.json());
    }

    const logger = winston.createLogger({
      level: this.mapLogLevel(this.config.level),
      format: winston.format.combine(...formats),
      transports: this.createTransports(),
      exitOnError: false,
      handleExceptions: this.config.winstonOptions?.handleExceptions ?? true,
      handleRejections: true,
    });

    return logger;
  }

  private createTransports(): winston.transport[] {
    const transports: winston.transport[] = [];
    const options = this.config.winstonOptions || {};

    // Console transport
    if (this.shouldCreateConsoleTransport()) {
      transports.push(new winston.transports.Console({
        level: this.mapLogLevel(this.config.level),
        format: winston.format.combine(
          winston.format.colorize({ all: options.colorize ?? true }),
          winston.format.timestamp(),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length > 0 ?
              ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}]: ${message}${metaStr}`;
          })
        ),
        handleExceptions: options.handleExceptions ?? true,
        // Note: humanReadableUnhandledException is not a valid winston Console transport option
        // Exception formatting is handled by the format configuration above
      }));
    }

    // File transport
    if (options.filename) {
      const dirnameValue = options.dirname;
      const maxsizeValue = options.maxsize;
      const maxFilesValue = options.maxFiles;

      transports.push(new winston.transports.File({
        filename: options.filename,
        ...(dirnameValue !== undefined && { dirname: dirnameValue }),
        ...(maxsizeValue !== undefined && { maxsize: maxsizeValue }),
        ...(maxFilesValue !== undefined && { maxFiles: maxFilesValue }),
        tailable: options.tailable ?? true,
        zippedArchive: options.zippedArchive ?? true,
        level: this.mapLogLevel(this.config.level),
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
      }));
    }

    // Daily rotate file transport
    if (options.datePattern) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const DailyRotateFile = require('winston-daily-rotate-file');
        transports.push(new DailyRotateFile({
          filename: options.filename || 'application-%DATE%.log',
          dirname: options.dirname,
          datePattern: options.datePattern,
          zippedArchive: options.zippedArchive ?? true,
          maxSize: `${options.maxsize || 20}m`,
          maxFiles: `${options.maxFiles || 14}d`,
          level: this.mapLogLevel(this.config.level),
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        }));
      } catch (error: unknown) {
        console.warn('winston-daily-rotate-file not available:', (error as Error).message);
      }
    }

    // HTTP transport
    if (options.host && options.port) {
      const pathValue = options.path;
      const sslValue = options.ssl;
      const headersValue = options.headers;

      transports.push(new winston.transports.Http({
        host: options.host,
        port: options.port,
        ...(pathValue !== undefined && { path: pathValue }),
        ...(sslValue !== undefined && { ssl: sslValue }),
        ...(headersValue !== undefined && { headers: headersValue }),
        level: this.mapLogLevel(this.config.level),
      }));
    }

    // ElasticSearch transport
    if (options.esHost) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const ElasticsearchTransport = require('winston-elasticsearch');
        transports.push(new ElasticsearchTransport({
          node: options.esHost,
          index: options.index || 'logs',
          indexPrefix: options.indexPrefix,
          mappingTemplate: options.mappingTemplate,
          level: this.mapLogLevel(this.config.level),
        }));
      } catch (error: unknown) {
        console.warn('winston-elasticsearch not available:', (error as Error).message);
      }
    }

    // Fallback to console if no transports configured
    if (transports.length === 0) {
      transports.push(new winston.transports.Console({
        level: this.mapLogLevel(this.config.level),
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.simple()
        ),
      }));
    }

    return transports;
  }

  private shouldCreateConsoleTransport(): boolean {
    const options = this.config.winstonOptions || {};

    // Explicit console configuration
    if (options.colorize !== undefined || options.prettyPrint !== undefined) {
      return true;
    }

    // Default console in development
    if (process.env['NODE_ENV'] === 'development') {
      return true;
    }

    // No file or other transports configured
    if (!options.filename && !options.host && !options.esHost) {
      return true;
    }

    return false;
  }

  private mapLogLevel(level: LogLevel): string {
    const levelMap: Record<LogLevel, string> = {
      [LogLevel.EMERGENCY]: 'emerg',
      [LogLevel.ALERT]: 'alert',
      [LogLevel.CRITICAL]: 'crit',
      [LogLevel.ERROR]: 'error',
      [LogLevel.WARNING]: 'warn',
      [LogLevel.NOTICE]: 'notice',
      [LogLevel.INFO]: 'info',
      [LogLevel.DEBUG]: 'debug',
      [LogLevel.TRACE]: 'silly',
    };

    return levelMap[level] || 'info';
  }

  private formatMessage(message: LogMessage): { message: string; meta: any } {
    // Extract message and metadata
    const { level, message: msg, timestamp, context, data, error, performance, security, business, ...rest } = message;

    // Build metadata object
    const meta: any = {
      timestamp,
      level,
      ...context,
      ...rest,
    };

    // Add structured data
    if (data) {
      meta.data = data;
    }

    // Add error information
    if (error) {
      meta.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
      };
    }

    // Add performance metrics
    if (performance) {
      meta.performance = performance;
    }

    // Add security audit information
    if (security) {
      meta.security = security;
    }

    // Add business event information
    if (business) {
      meta.business = business;
    }

    return { message: msg, meta };
  }

  private setupErrorHandlers(): void {
    this.logger.on('error', (error) => {
      this.handleTransportError(error);
    });

    // Handle transport-specific errors
    this.logger.transports.forEach(transport => {
      transport.on('error', (error) => {
        this.handleTransportError(error);
      });
    });
  }

  private handleTransportError(error: Error): void {
    this.lastError = error;
    this.failureCount++;
    this.isHealthyFlag = false;

    // Log error to console if not already in console mode
    if (process.env['NODE_ENV'] === 'development') {
      console.error(`[WinstonTransport] Error:`, error.message);
    }

    // Could implement circuit breaker logic here
    if (this.failureCount > 10) {
      console.error(`[WinstonTransport] Too many failures (${this.failureCount}), transport might be disabled`);
    }
  }

  private resetFailureCount(): void {
    if (this.failureCount > 0) {
      this.failureCount = 0;
      this.lastError = null;
    }
  }

  private async writeHealthCheck(): Promise<void> {
    const healthCheckMessage: LogMessage = {
      level: LogLevel.DEBUG,
      message: 'Winston transport health check',
      timestamp: new Date().toISOString(),
      context: {
        correlationId: 'health-check',
        service: 'winston-transport',
        version: '3.0.0',
        environment: process.env['NODE_ENV'] || 'development',
        component: 'health-check',
        hostname: hostname(),
        processId: process.pid,
      },
      data: {
        healthCheck: true,
        timestamp: Date.now(),
        transport: this.adapter,
      },
    };

    await this.write(healthCheckMessage);
  }
}

/**
 * Winston
 */
export class WinstonTransportFactory {
  /**
   */
  static createConsole(config: Partial<WinstonTransportConfig> = {}): WinstonTransport {
    return new WinstonTransport({
      adapter: LoggerAdapter.WINSTON,
      level: LogLevel.INFO,
      enabled: true,
      ...config,
      winstonOptions: {
        colorize: true,
        prettyPrint: true,
        timestamp: true,
        ...config.winstonOptions,
      },
    });
  }

  /**
   */
  static createFile(filename: string, config: Partial<WinstonTransportConfig> = {}): WinstonTransport {
    return new WinstonTransport({
      adapter: LoggerAdapter.WINSTON,
      level: LogLevel.INFO,
      enabled: true,
      ...config,
      winstonOptions: {
        filename,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 5,
        tailable: true,
        zippedArchive: true,
        ...config.winstonOptions,
      },
    });
  }

  /**
   */
  static createDailyRotateFile(
    filename: string,
    datePattern: string = 'YYYY-MM-DD',
    config: Partial<WinstonTransportConfig> = {}
  ): WinstonTransport {
    return new WinstonTransport({
      adapter: LoggerAdapter.WINSTON,
      level: LogLevel.INFO,
      enabled: true,
      ...config,
      winstonOptions: {
        filename,
        datePattern,
        maxsize: '20m' as any, // winston-daily-rotate-file property name
        maxFiles: '14d' as any, // winston-daily-rotate-file accepts string with time suffix
        zippedArchive: true,
        ...config.winstonOptions,
      },
    });
  }

  /**
   * HTTP
   */
  static createHttp(host: string, port: number, config: Partial<WinstonTransportConfig> = {}): WinstonTransport {
    return new WinstonTransport({
      adapter: LoggerAdapter.WINSTON,
      level: LogLevel.INFO,
      enabled: true,
      ...config,
      winstonOptions: {
        host,
        port,
        ssl: port === 443,
        ...config.winstonOptions,
      },
    });
  }

  /**
   * ElasticSearch
   */
  static createElasticSearch(esHost: string, index: string, config: Partial<WinstonTransportConfig> = {}): WinstonTransport {
    return new WinstonTransport({
      adapter: LoggerAdapter.WINSTON,
      level: LogLevel.INFO,
      enabled: true,
      ...config,
      winstonOptions: {
        esHost,
        index,
        ...config.winstonOptions,
      },
    });
  }
}