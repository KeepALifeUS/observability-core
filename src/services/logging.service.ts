/**
 * 2025 Enterprise Logging Service
 * Full-featured logging with winston, structured logs, and enterprise features
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import winston from 'winston';
import ElasticsearchTransport from 'winston-elasticsearch';

export interface LoggingConfig {
  level: string;
  enableConsole: boolean;
  enableFile: boolean;
  enableElasticsearch: boolean;
  filePath?: string;
  elasticsearch?: {
    node: string;
    index: string;
    username?: string;
    password?: string;
  };
  format: 'json' | 'simple' | 'structured';
  metadata: {
    service: string;
    version: string;
    environment: string;
  };
}

export interface LogContext {
  traceId?: string;
  spanId?: string;
  userId?: string;
  operation?: string;
  component?: string;
  [key: string]: any;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: LogContext;
  metadata?: any;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

@Injectable()
export class LoggingService implements OnModuleInit, OnModuleDestroy {
  private logger!: winston.Logger;
  private isInitialized = false;
  private config!: LoggingConfig;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initialize();
  }

  async onModuleDestroy() {
    await this.shutdown();
  }

  /**
   */
  async initialize(customConfig?: Partial<LoggingConfig>): Promise<void> {
    try {
      this.config = {
        level: this.configService.get('LOGGING_LEVEL', 'info'),
        enableConsole: this.configService.get('LOGGING_CONSOLE', 'true') === 'true',
        enableFile: this.configService.get('LOGGING_FILE', 'false') === 'true',
        enableElasticsearch: this.configService.get('LOGGING_ELASTICSEARCH', 'false') === 'true',
        filePath: this.configService.get('LOGGING_FILE_PATH', './logs/app.log'),
        format: this.configService.get('LOGGING_FORMAT', 'structured') as 'json' | 'simple' | 'structured',
        metadata: {
          service: this.configService.get('SERVICE_NAME', 'crypto-trading-bot'),
          version: this.configService.get('SERVICE_VERSION', '1.0.0'),
          environment: this.configService.get('NODE_ENV', 'development'),
        },
        elasticsearch: (() => {
          const usernameValue = this.configService.get('ELASTICSEARCH_USERNAME');
          const passwordValue = this.configService.get('ELASTICSEARCH_PASSWORD');
          return {
            node: this.configService.get('ELASTICSEARCH_NODE', 'http://localhost:9200'),
            index: this.configService.get('ELASTICSEARCH_INDEX', 'crypto-trading-logs'),
            ...(usernameValue !== undefined && { username: usernameValue }),
            ...(passwordValue !== undefined && { password: passwordValue }),
          };
        })(),
        ...customConfig,
      };

      await this.createLogger();
      this.isInitialized = true;

      this.info('LoggingService initialized successfully', {
        level: this.config.level,
        format: this.config.format,
        transports: this.getActiveTransports(),
      });
    } catch (error) {
      console.error('Failed to initialize LoggingService:', error);
      throw error;
    }
  }

  /**
   * winston logger
   */
  private async createLogger(): Promise<void> {
    const format = this.createLogFormat();
    const transports = await this.createTransports();

    this.logger = winston.createLogger({
      level: this.config.level,
      format,
      transports,
      exitOnError: false,
      handleExceptions: true,
      handleRejections: true,
    });
  }

  /**
   */
  private createLogFormat(): winston.Logform.Format {
    const baseFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.metadata(),
    );

    switch (this.config.format) {
      case 'json':
        return winston.format.combine(baseFormat, winston.format.json());

      case 'simple':
        return winston.format.combine(
          baseFormat,
          winston.format.printf(({ level, message, timestamp }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${message}`;
          }),
        );

      case 'structured':
      default:
        return winston.format.combine(
          baseFormat,
          winston.format.printf(({ level, message, timestamp, metadata, context, error }) => {
            const baseMetadata = this.config.metadata || {};
            const additionalMetadata = (metadata && typeof metadata === 'object') ? metadata : {};

            const logEntry: StructuredLogEntry = {
              timestamp: timestamp as string,
              level: level.toUpperCase(),
              message: message as string,
              metadata: {
                ...baseMetadata,
                ...additionalMetadata,
              },
            };

            // Add optional fields
            if (context && typeof context === 'object') {
              logEntry.context = context as LogContext;
            }
            if (error && typeof error === 'object') {
              logEntry.error = error as { name: string; message: string; stack?: string };
            }

            return JSON.stringify(logEntry, null, 0);
          }),
        );
    }
  }

  /**
   */
  private async createTransports(): Promise<winston.transport[]> {
    const transports: winston.transport[] = [];

    // Console transport
    if (this.config.enableConsole) {
      transports.push(
        new winston.transports.Console({
          level: this.config.level,
          handleExceptions: true,
          handleRejections: true,
        }),
      );
    }

    // File transport
    if (this.config.enableFile && this.config.filePath) {
      transports.push(
        new winston.transports.File({
          filename: this.config.filePath,
          level: this.config.level,
          maxsize: 10485760, // 10MB
          maxFiles: 10,
          tailable: true,
        }),
      );
    }

    // Elasticsearch transport
    if (this.config.enableElasticsearch && this.config.elasticsearch) {
      try {
        const esTransport = new (ElasticsearchTransport as any)({
          level: this.config.level,
          clientOpts: {
            node: this.config.elasticsearch.node,
            auth: this.config.elasticsearch.username
              ? {
                  username: this.config.elasticsearch.username,
                  password: this.config.elasticsearch.password || '',
                }
              : undefined,
          },
          index: this.config.elasticsearch.index,
          indexPrefix: 'crypto-trading',
          indexSuffixPattern: 'YYYY.MM.DD',
          transformer: (logData: any) => ({
            '@timestamp': new Date().toISOString(),
            level: logData.level,
            message: logData.message,
            service: this.config.metadata.service,
            version: this.config.metadata.version,
            environment: this.config.metadata.environment,
            ...logData.meta,
          }),
        });

        transports.push(esTransport);
      } catch (error) {
        console.warn('Failed to initialize Elasticsearch transport:', error);
      }
    }

    return transports;
  }

  /**
   */
  private getActiveTransports(): string[] {
    const active: string[] = [];
    if (this.config.enableConsole) {active.push('console');}
    if (this.config.enableFile) {active.push('file');}
    if (this.config.enableElasticsearch) {active.push('elasticsearch');}
    return active;
  }

  /**
   */
  debug(message: string, context?: LogContext, metadata?: any): void {
    this.log('debug', message, context, metadata);
  }

  info(message: string, context?: LogContext, metadata?: any): void {
    this.log('info', message, context, metadata);
  }

  warn(message: string, context?: LogContext, metadata?: any): void {
    this.log('warn', message, context, metadata);
  }

  error(message: string, error?: Error, context?: LogContext, metadata?: any): void {
    const errorInfo = error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : undefined;

    this.log('error', message, context, { ...metadata, error: errorInfo });
  }

  /**
   */
  private log(level: string, message: string, context?: LogContext, metadata?: any): void {
    if (!this.isInitialized) {
      console.warn('LoggingService not initialized, falling back to console');
      console.log(`[${level.toUpperCase()}] ${message}`, { context, metadata });
      return;
    }

    try {
      this.logger.log(level, message, {
        context,
        metadata,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to log message:', error);
      console.log(`[${level.toUpperCase()}] ${message}`, { context, metadata });
    }
  }

  /**
   */
  logTrade(action: string, symbol: string, amount: number, price: number, context?: LogContext): void {
    this.info(`Trade ${action}: ${symbol}`, {
      ...context,
      operation: 'trade',
      component: 'trading-engine',
    }, {
      trade: {
        action,
        symbol,
        amount,
        price,
        value: amount * price,
      },
    });
  }

  logOrder(action: string, orderId: string, symbol: string, context?: LogContext): void {
    this.info(`Order ${action}: ${orderId}`, {
      ...context,
      operation: 'order',
      component: 'order-management',
    }, {
      order: {
        action,
        orderId,
        symbol,
      },
    });
  }

  logPerformance(operation: string, duration: number, context?: LogContext): void {
    this.info(`Performance: ${operation} completed in ${duration}ms`, {
      ...context,
      operation: 'performance',
      component: 'monitoring',
    }, {
      performance: {
        operation,
        duration,
        timestamp: Date.now(),
      },
    });
  }

  /**
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {return;}

    try {
      this.info('LoggingService shutting down...');

      if (this.logger) {
        await new Promise<void>((resolve) => {
          this.logger.end(() => {
            resolve();
          });
        });
      }

      this.isInitialized = false;
    } catch (error) {
      console.error('Error during LoggingService shutdown:', error);
    }
  }

  /**
   */
  isEnabled(): boolean {
    return this.isInitialized && !!this.logger;
  }

  /**
   */
  getConfiguration(): LoggingConfig {
    return { ...this.config };
  }

  /**
   * runtime
   */
  setLogLevel(level: string): void {
    if (!this.isInitialized) {return;}

    this.config.level = level;
    this.logger.level = level;

    this.info('Log level updated', { operation: 'config-update' }, { newLevel: level });
  }

  /**
   */
  createChildLogger(context: LogContext): LoggingService {
    const childService = new LoggingService(this.configService);
    childService.logger = this.logger.child(context);
    childService.isInitialized = this.isInitialized;
    childService.config = this.config;
    return childService;
  }
}