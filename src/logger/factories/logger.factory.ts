/**
 * Logger Factory - 2025 Enterprise Logger Creation
 *
 * @description
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance Enterprise Factory Pattern
 * @patterns Factory, Builder, Singleton
 */

import { UnifiedLoggerService } from '../core/unified-logger.service';
import {
  type IUnifiedLogger,
  type ILoggerFactory,
  type UnifiedLoggerConfig,
  LogLevel,
  type LogContext,
  LoggerAdapter,
} from '../interfaces/logger.interface';
import { ConsoleTransport } from '../transports/console.transport';

/**
 */
export enum LoggerPreset {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  HIGH_PERFORMANCE = 'high-performance',
  DEBUGGING = 'debugging',
  TRADING_HFT = 'trading-hft',
  MICROSERVICE = 'microservice',
  API_GATEWAY = 'api-gateway',
  SECURITY_AUDIT = 'security-audit',
  TESTING = 'testing',
}

/**
 */
export interface EnvironmentConfig {
  name: string;
  logLevel: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  enableRemote: boolean;
  sensitiveDataMasking: boolean;
  performanceOptimized: boolean;
}

/**
 * Unified Logger Factory - 2025
 */
export class UnifiedLoggerFactory implements ILoggerFactory {
  private static instance: UnifiedLoggerFactory;
  private readonly loggerCache = new Map<string, IUnifiedLogger>();

  private constructor() {}

  /**
   * Singleton instance
   */
  static getInstance(): UnifiedLoggerFactory {
    if (!UnifiedLoggerFactory.instance) {
      UnifiedLoggerFactory.instance = new UnifiedLoggerFactory();
    }
    return UnifiedLoggerFactory.instance;
  }

  /**
   */
  create(config: UnifiedLoggerConfig): IUnifiedLogger {
    const cacheKey = this.generateCacheKey(config);

    if (this.loggerCache.has(cacheKey)) {
      return this.loggerCache.get(cacheKey)!;
    }

    const logger = new UnifiedLoggerService(config);

    // Add transports based on configuration
    this.addConfiguredTransports(logger, config);

    this.loggerCache.set(cacheKey, logger);
    return logger;
  }

  /**
   */
  createChild(parent: IUnifiedLogger, context: Partial<LogContext>): IUnifiedLogger {
    return parent.child(context);
  }

  /**
   */
  createWithPreset(
    preset: LoggerPreset,
    service: string,
    version: string = '1.0.0',
    environment: string = 'development',
    overrides: Partial<UnifiedLoggerConfig> = {}
  ): IUnifiedLogger {
    const config = this.getPresetConfig(preset, service, version, environment);
    const finalConfig = { ...config, ...overrides };

    return this.create(finalConfig);
  }

  /**
   * development
   */
  createDevelopment(service: string, level: LogLevel = LogLevel.DEBUG): IUnifiedLogger {
    return this.createWithPreset(LoggerPreset.DEVELOPMENT, service, '1.0.0', 'development', {
      defaultLevel: level,
    });
  }

  /**
   * production
   */
  createProduction(
    service: string,
    version: string,
    logFile?: string
  ): IUnifiedLogger {
    const transportsValue = logFile ? [
      {
        adapter: LoggerAdapter.WINSTON,
        level: LogLevel.INFO,
        enabled: true,
        options: { filename: logFile },
      },
      {
        adapter: LoggerAdapter.WINSTON,
        level: LogLevel.INFO,
        enabled: true,
        options: { colorize: true },
      },
    ] : undefined;

    return this.createWithPreset(LoggerPreset.PRODUCTION, service, version, 'production', {
      ...(transportsValue !== undefined && { transports: transportsValue }),
    });
  }

  /**
   */
  createTradingHFT(
    service: string,
    exchange?: string,
    logFile?: string
  ): IUnifiedLogger {
    const config = this.getPresetConfig(LoggerPreset.TRADING_HFT, service, '1.0.0', 'production');

    if (logFile) {
      config.transports = [
        {
          adapter: LoggerAdapter.PINO,
          level: LogLevel.INFO,
          enabled: true,
          options: {
            filename: logFile,
            bufferSize: 500,
            flushSync: false,
          },
        },
      ];
    }

    const logger = this.create(config);

    // Add trading-specific context
    logger.setContext({
      service: service,
      ...(exchange !== undefined && { exchange }),
      tradingMode: 'hft',
      performanceOptimized: true,
    });

    return logger;
  }

  /**
   */
  createMicroservice(
    serviceName: string,
    version: string,
    environment: string,
    traceId?: string
  ): IUnifiedLogger {
    const logger = this.createWithPreset(LoggerPreset.MICROSERVICE, serviceName, version, environment);

    const traceIdValue = traceId;

    logger.setContext({
      service: serviceName,
      version,
      environment,
      ...(traceIdValue !== undefined && { traceId: traceIdValue }),
      component: 'microservice',
    });

    return logger;
  }

  /**
   * API Gateway
   */
  createApiGateway(environment: string = 'development'): IUnifiedLogger {
    const logger = this.createWithPreset(LoggerPreset.API_GATEWAY, 'api-gateway', '1.0.0', environment);

    logger.setContext({
      component: 'api-gateway',
      gatewayVersion: '3.0.0',
    });

    return logger;
  }

  /**
   */
  createSecurityAudit(environment: string = 'production'): IUnifiedLogger {
    return this.createWithPreset(LoggerPreset.SECURITY_AUDIT, 'security-audit', '1.0.0', environment);
  }

  /**
   */
  createTesting(testSuite: string): IUnifiedLogger {
    const logger = this.createWithPreset(LoggerPreset.TESTING, 'test-runner', '1.0.0', 'test');

    logger.setContext({
      testSuite,
      testMode: true,
    });

    return logger;
  }

  /**
   */
  clearCache(): void {
    this.loggerCache.clear();
  }

  /**
   */
  getFactoryStats(): {
    cachedLoggers: number;
    cacheKeys: string[];
    memoryUsage: NodeJS.MemoryUsage;
  } {
    return {
      cachedLoggers: this.loggerCache.size,
      cacheKeys: Array.from(this.loggerCache.keys()),
      memoryUsage: process.memoryUsage(),
    };
  }

  // ==================== PRIVATE METHODS ====================

  private getPresetConfig(
    preset: LoggerPreset,
    service: string,
    version: string,
    environment: string
  ): UnifiedLoggerConfig {
    const baseConfig: UnifiedLoggerConfig = {
      service,
      version,
      environment,
      defaultLevel: LogLevel.INFO,
      enableContextPreservation: true,
      enableSensitiveDataMasking: true,
      enableOpenTelemetry: true,
      enableCorrelationTracking: true,
      transports: [],
    };

    switch (preset) {
      case LoggerPreset.DEVELOPMENT:
        return {
          ...baseConfig,
          defaultLevel: LogLevel.DEBUG,
          asyncLogging: false,
          transports: [
            {
              adapter: LoggerAdapter.WINSTON,
              level: LogLevel.DEBUG,
              enabled: true,
              options: {
                colorize: true,
                prettyPrint: true,
                timestamp: true,
              },
            },
          ],
        };

      case LoggerPreset.PRODUCTION:
        return {
          ...baseConfig,
          defaultLevel: LogLevel.INFO,
          asyncLogging: true,
          bufferSize: 100,
          flushInterval: 5000,
          enableSensitiveDataMasking: true,
          circuitBreaker: {
            enabled: true,
            failureThreshold: 10,
            resetTimeout: 60000,
          },
          transports: [
            {
              adapter: LoggerAdapter.WINSTON,
              level: LogLevel.INFO,
              enabled: true,
              options: {
                filename: 'logs/application.log',
                maxSize: '10MB',
                maxFiles: 5,
                zippedArchive: true,
              },
            },
            {
              adapter: LoggerAdapter.WINSTON,
              level: LogLevel.ERROR,
              enabled: true,
              options: {
                filename: 'logs/error.log',
                maxSize: '10MB',
                maxFiles: 5,
              },
            },
          ],
        };

      case LoggerPreset.HIGH_PERFORMANCE:
      case LoggerPreset.TRADING_HFT:
        return {
          ...baseConfig,
          defaultLevel: LogLevel.INFO,
          asyncLogging: true,
          bufferSize: 500,
          flushInterval: 1000,
          enableSensitiveDataMasking: false, // Disabled for performance
          transports: [
            {
              adapter: LoggerAdapter.PINO,
              level: LogLevel.INFO,
              enabled: true,
              options: {
                destination: 'logs/trading.log',
                bufferSize: 500,
                flushSync: false,
                extreme: true,
              },
            },
          ],
        };

      case LoggerPreset.DEBUGGING:
        return {
          ...baseConfig,
          defaultLevel: LogLevel.TRACE,
          asyncLogging: false,
          enableContextPreservation: true,
          transports: [
            {
              adapter: LoggerAdapter.WINSTON,
              level: LogLevel.TRACE,
              enabled: true,
              options: {
                colorize: true,
                prettyPrint: true,
                timestamp: true,
              },
            },
            {
              adapter: LoggerAdapter.WINSTON,
              level: LogLevel.TRACE,
              enabled: true,
              options: {
                filename: 'logs/debug.log',
                maxSize: '50MB',
                maxFiles: 3,
              },
            },
          ],
        };

      case LoggerPreset.MICROSERVICE:
        return {
          ...baseConfig,
          defaultLevel: LogLevel.INFO,
          enableCorrelationTracking: true,
          correlationHeaderNames: ['x-correlation-id', 'x-trace-id', 'x-request-id'],
          transports: [
            {
              adapter: LoggerAdapter.WINSTON,
              level: LogLevel.INFO,
              enabled: true,
              options: {
                json: true,
                timestamp: true,
              },
            },
          ],
        };

      case LoggerPreset.API_GATEWAY:
        return {
          ...baseConfig,
          defaultLevel: LogLevel.INFO,
          enableCorrelationTracking: true,
          transports: [
            {
              adapter: LoggerAdapter.WINSTON,
              level: LogLevel.INFO,
              enabled: true,
              options: {
                colorize: environment === 'development',
                json: environment !== 'development',
              },
            },
            {
              adapter: LoggerAdapter.WINSTON,
              level: LogLevel.INFO,
              enabled: environment === 'production',
              options: {
                filename: 'logs/access.log',
                maxSize: '20MB',
                maxFiles: 7,
              },
            },
          ],
        };

      case LoggerPreset.SECURITY_AUDIT:
        return {
          ...baseConfig,
          defaultLevel: LogLevel.WARNING,
          enableSensitiveDataMasking: true,
          asyncLogging: false, // Ensure security logs are written synchronously
          transports: [
            {
              adapter: LoggerAdapter.WINSTON,
              level: LogLevel.WARNING,
              enabled: true,
              options: {
                filename: 'logs/security.log',
                maxSize: '100MB',
                maxFiles: 10,
                json: true,
                timestamp: true,
              },
            },
          ],
        };

      case LoggerPreset.TESTING:
        return {
          ...baseConfig,
          defaultLevel: LogLevel.DEBUG,
          asyncLogging: false,
          enableContextPreservation: true,
          transports: [
            {
              adapter: LoggerAdapter.WINSTON,
              level: LogLevel.DEBUG,
              enabled: true,
              options: {
                colorize: true,
                prettyPrint: true,
                timestamp: true,
              },
            },
          ],
        };

      default:
        return baseConfig;
    }
  }

  private generateCacheKey(config: UnifiedLoggerConfig): string {
    const keyParts = [
      config.service,
      config.version,
      config.environment,
      config.defaultLevel,
      config.transports.length.toString(),
      config.enableSensitiveDataMasking ? 'masked' : 'unmasked',
    ];

    return keyParts.join(':');
  }

  private addConfiguredTransports(logger: UnifiedLoggerService, config: UnifiedLoggerConfig): void {
    config.transports.forEach((transportConfig, index) => {
      const transportName = `${transportConfig.adapter}-${index}`;

      try {
        let transport;

        switch (transportConfig.adapter) {
          case LoggerAdapter.CONSOLE:
            transport = new ConsoleTransport(transportConfig);
            break;

          // Other transports can be added when available
          // case LoggerAdapter.WINSTON:
          //   transport = new WinstonTransport(transportConfig as any);
          //   break;

          // case LoggerAdapter.PINO:
          //   transport = new PinoTransport(transportConfig as any);
          //   break;

          default:
            console.warn(`Unsupported transport adapter: ${transportConfig.adapter}`);
            return;
        }

        logger.addTransport(transportName, transport);
      } catch (error) {
        console.error(`Failed to create transport ${transportName}:`, error);
      }
    });
  }
}

/**
 */
export class LoggerFactory {
  private static factory = UnifiedLoggerFactory.getInstance();

  /**
   * development
   */
  static createDev(service: string, level: LogLevel = LogLevel.DEBUG): IUnifiedLogger {
    return this.factory.createDevelopment(service, level);
  }

  /**
   * production
   */
  static createProd(service: string, version: string, logFile?: string): IUnifiedLogger {
    return this.factory.createProduction(service, version, logFile);
  }

  /**
   */
  static createTrading(service: string, exchange?: string, logFile?: string): IUnifiedLogger {
    return this.factory.createTradingHFT(service, exchange, logFile);
  }

  /**
   */
  static createTest(testSuite: string): IUnifiedLogger {
    return this.factory.createTesting(testSuite);
  }

  /**
   */
  static create(config: UnifiedLoggerConfig): IUnifiedLogger {
    return this.factory.create(config);
  }

  /**
   */
  static createChild(parent: IUnifiedLogger, context: Partial<LogContext>): IUnifiedLogger {
    return this.factory.createChild(parent, context);
  }
}

/**
 * (singleton)
 */
export const globalLoggerFactory = UnifiedLoggerFactory.getInstance();