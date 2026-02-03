/**
 * NestJS Logger Module - 2025 Enterprise Integration
 *
 * @description NestJS
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance NestJS Module Standards
 * @patterns Module, Provider, Injection
 */

import {
  Module,
  DynamicModule,
  Provider,
  Inject,
  Injectable,
  LoggerService as NestLoggerService,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';


import { UnifiedLoggerService } from '../core/unified-logger.service';
import { UnifiedLoggerFactory, LoggerPreset } from '../factories/logger.factory';
import {
  type IUnifiedLogger,
  type UnifiedLoggerConfig,
  LogLevel,
  type LogContext,
} from '../interfaces/logger.interface';
import { PinoTransport } from '../transports/pino.transport';
import { WinstonTransport } from '../transports/winston.transport';

/**
 * dependency injection
 */
export const UNIFIED_LOGGER = Symbol('UNIFIED_LOGGER');
export const LOGGER_CONFIG = Symbol('LOGGER_CONFIG');
export const LOGGER_FACTORY = Symbol('LOGGER_FACTORY');

/**
 */
export interface UnifiedLoggerModuleOptions {
  config?: UnifiedLoggerConfig;

  // preset
  preset?: LoggerPreset;
  service?: string;
  version?: string;
  environment?: string;

  // Async
  useFactory?: (...args: any[]) => Promise<UnifiedLoggerConfig> | UnifiedLoggerConfig;
  inject?: any[];

  isGlobal?: boolean;
  replaceNestLogger?: boolean;
  enableRequestContext?: boolean;
}

/**
 * NestJS
 */
@Injectable()
export class NestUnifiedLogger implements NestLoggerService {
  constructor(
    @Inject(UNIFIED_LOGGER) private readonly unifiedLogger: IUnifiedLogger
  ) {}

  /**
   * NestJS Logger interface methods
   */
  log(message: any, context?: string): void {
    const logContext = context ? { component: context } : undefined;
    this.unifiedLogger.info(this.formatMessage(message), undefined, logContext);
  }

  error(message: any, trace?: string, context?: string): void {
    const error = trace ? new Error(trace) : undefined;
    const logContext = context ? { component: context } : undefined;
    this.unifiedLogger.error(this.formatMessage(message), error, undefined, logContext);
  }

  warn(message: any, context?: string): void {
    const logContext = context ? { component: context } : undefined;
    this.unifiedLogger.warn(this.formatMessage(message), undefined, logContext);
  }

  debug(message: any, context?: string): void {
    const logContext = context ? { component: context } : undefined;
    this.unifiedLogger.debug(this.formatMessage(message), undefined, logContext);
  }

  verbose(message: any, context?: string): void {
    const logContext = context ? { component: context } : undefined;
    this.unifiedLogger.trace(this.formatMessage(message), undefined, logContext);
  }

  /**
   */
  getUnifiedLogger(): IUnifiedLogger {
    return this.unifiedLogger;
  }

  child(context: Partial<LogContext>): NestUnifiedLogger {
    const childLogger = this.unifiedLogger.child(context);
    return new NestUnifiedLogger(childLogger);
  }

  private formatMessage(message: any): string {
    return typeof message === 'string' ? message : JSON.stringify(message);
  }
}

/**
 */
@Module({})
export class UnifiedLoggerModule {
  /**
   */
  static register(options: UnifiedLoggerModuleOptions = {}): DynamicModule {
    const providers = this.createProviders(options);

    return {
      module: UnifiedLoggerModule,
      imports: options.enableRequestContext ? [ConfigModule] : [],
      providers,
      exports: providers.map(p => (typeof p === 'object' ? p.provide! : p)),
      global: options.isGlobal ?? true,
    };
  }

  /**
   */
  static registerAsync(options: UnifiedLoggerModuleOptions): DynamicModule {
    const providers = this.createAsyncProviders(options);

    return {
      module: UnifiedLoggerModule,
      imports: [ConfigModule, ...(options.inject || [])],
      providers,
      exports: [UNIFIED_LOGGER, LOGGER_FACTORY, NestUnifiedLogger],
      global: options.isGlobal ?? true,
    };
  }

  /**
   * development
   */
  static forDevelopment(service: string, options: Partial<UnifiedLoggerModuleOptions> = {}): DynamicModule {
    return this.register({
      preset: LoggerPreset.DEVELOPMENT,
      service,
      environment: 'development',
      replaceNestLogger: true,
      ...options,
    });
  }

  /**
   * production
   */
  static forProduction(
    service: string,
    version: string,
    options: Partial<UnifiedLoggerModuleOptions> = {}
  ): DynamicModule {
    return this.register({
      preset: LoggerPreset.PRODUCTION,
      service,
      version,
      environment: 'production',
      replaceNestLogger: true,
      ...options,
    });
  }

  /**
   * trading
   */
  static forTrading(
    service: string,
    _exchange?: string,
    options: Partial<UnifiedLoggerModuleOptions> = {}
  ): DynamicModule {
    return this.register({
      preset: LoggerPreset.TRADING_HFT,
      service,
      environment: 'production',
      config: {
        service,
        version: '1.0.0',
        environment: 'production',
        defaultLevel: LogLevel.INFO,
        enableSensitiveDataMasking: false,
        asyncLogging: true,
        bufferSize: 500,
        flushInterval: 1000,
        enableContextPreservation: true,
        enableCorrelationTracking: true,
        enableOpenTelemetry: true,
        transports: [],
      },
      ...options,
    });
  }

  // ==================== PRIVATE METHODS ====================

  private static createProviders(options: UnifiedLoggerModuleOptions): Provider[] {
    const configProvider = this.createConfigProvider(options);
    const loggerProvider = this.createLoggerProvider(options);
    const factoryProvider = this.createFactoryProvider();
    const nestLoggerProvider = this.createNestLoggerProvider();

    const providers = [
      configProvider,
      loggerProvider,
      factoryProvider,
      nestLoggerProvider,
    ];

    return providers;
  }

  private static createAsyncProviders(options: UnifiedLoggerModuleOptions): Provider[] {
    const configProvider = this.createAsyncConfigProvider(options);
    const loggerProvider = this.createAsyncLoggerProvider();
    const factoryProvider = this.createFactoryProvider();
    const nestLoggerProvider = this.createNestLoggerProvider();

    return [
      configProvider,
      loggerProvider,
      factoryProvider,
      nestLoggerProvider,
    ];
  }

  private static createConfigProvider(options: UnifiedLoggerModuleOptions): Provider {
    return {
      provide: LOGGER_CONFIG,
      useValue: this.resolveConfig(options),
    };
  }

  private static createAsyncConfigProvider(options: UnifiedLoggerModuleOptions): Provider {
    if (options.useFactory) {
      return {
        provide: LOGGER_CONFIG,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    return {
      provide: LOGGER_CONFIG,
      useFactory: (_configService: ConfigService) => {
        return this.createConfigFromEnvironment(_configService, options);
      },
      inject: [ConfigService],
    };
  }

  private static createLoggerProvider(_options: UnifiedLoggerModuleOptions): Provider {
    return {
      provide: UNIFIED_LOGGER,
      useFactory: (config: UnifiedLoggerConfig) => {
        return new UnifiedLoggerService(config);
      },
      inject: [LOGGER_CONFIG],
    };
  }

  private static createAsyncLoggerProvider(): Provider {
    return {
      provide: UNIFIED_LOGGER,
      useFactory: (config: UnifiedLoggerConfig) => {
        const logger = new UnifiedLoggerService(config);

        config.transports.forEach((transportConfig, index) => {
          try {
            let transport;
            const transportName = `${transportConfig.adapter}-${index}`;

            switch (transportConfig.adapter) {
              case 'winston':
                transport = new WinstonTransport(transportConfig as any);
                break;
              case 'pino':
                transport = new PinoTransport(transportConfig as any);
                break;
              default:
                console.warn(`Unsupported transport: ${transportConfig.adapter}`);
                return;
            }

            logger.addTransport(transportName, transport);
          } catch (error) {
            console.error(`Failed to create transport:`, error);
          }
        });

        return logger;
      },
      inject: [LOGGER_CONFIG],
    };
  }

  private static createFactoryProvider(): Provider {
    return {
      provide: LOGGER_FACTORY,
      useValue: UnifiedLoggerFactory,
    };
  }

  private static createNestLoggerProvider(): Provider {
    return {
      provide: NestUnifiedLogger,
      useFactory: (unifiedLogger: IUnifiedLogger) => {
        return new NestUnifiedLogger(unifiedLogger);
      },
      inject: [UNIFIED_LOGGER],
    };
  }

  private static resolveConfig(options: UnifiedLoggerModuleOptions): UnifiedLoggerConfig {
    if (options.config) {
      return options.config;
    }

    if (options.preset && options.service) {
      const factory = UnifiedLoggerFactory.getInstance();
      return (factory as any)['getPresetConfig'](
        options.preset,
        options.service,
        options.version || '1.0.0',
        options.environment || 'development'
      );
    }

    // Fallback basic
    return {
      service: options.service || 'nestjs-app',
      version: options.version || '1.0.0',
      environment: options.environment || 'development',
      defaultLevel: LogLevel.INFO,
      enableContextPreservation: true,
      enableSensitiveDataMasking: true,
      enableOpenTelemetry: true,
      enableCorrelationTracking: true,
      transports: [],
    };
  }

  private static createConfigFromEnvironment(
    configService: ConfigService,
    options: UnifiedLoggerModuleOptions
  ): UnifiedLoggerConfig {
    const environment = configService.get('NODE_ENV', 'development');
    const service = configService.get('APP_NAME', options.service || 'nestjs-app');
    const version = configService.get('APP_VERSION', options.version || '1.0.0');

    return {
      service,
      version,
      environment,
      defaultLevel: this.parseLogLevel(configService.get('LOG_LEVEL', 'info')),
      enableContextPreservation: configService.get('LOGGER_ENABLE_CONTEXT', true),
      enableSensitiveDataMasking: configService.get('LOGGER_ENABLE_MASKING', environment === 'production'),
      enableOpenTelemetry: configService.get('LOGGER_ENABLE_OTEL', true),
      enableCorrelationTracking: configService.get('LOGGER_ENABLE_CORRELATION', true),
      asyncLogging: configService.get('LOGGER_ASYNC', environment === 'production'),
      bufferSize: parseInt(configService.get('LOGGER_BUFFER_SIZE', '100'), 10),
      flushInterval: parseInt(configService.get('LOGGER_FLUSH_INTERVAL', '5000'), 10),
      transports: this.createTransportsFromEnvironment(configService),
    };
  }

  private static createTransportsFromEnvironment(configService: ConfigService): any[] {
    const transports: any[] = [];

    // Console transport
    if (configService.get('LOGGER_CONSOLE_ENABLED', true)) {
      transports.push({
        adapter: 'winston',
        level: this.parseLogLevel(configService.get('LOGGER_CONSOLE_LEVEL', 'info')),
        enabled: true,
        options: {
          colorize: configService.get('NODE_ENV') === 'development',
        },
      });
    }

    // File transport
    const logFile = configService.get('LOGGER_FILE_PATH');
    if (logFile) {
      transports.push({
        adapter: 'winston',
        level: this.parseLogLevel(configService.get('LOGGER_FILE_LEVEL', 'info')),
        enabled: true,
        options: {
          filename: logFile,
          maxSize: configService.get('LOGGER_FILE_MAX_SIZE', '10MB'),
          maxFiles: parseInt(configService.get('LOGGER_FILE_MAX_FILES', '5'), 10),
        },
      });
    }

    return transports;
  }

  private static parseLogLevel(level: string): LogLevel {
    const levelMap: Record<string, LogLevel> = {
      emergency: LogLevel.EMERGENCY,
      alert: LogLevel.ALERT,
      critical: LogLevel.CRITICAL,
      error: LogLevel.ERROR,
      warning: LogLevel.WARNING,
      warn: LogLevel.WARNING,
      notice: LogLevel.NOTICE,
      info: LogLevel.INFO,
      debug: LogLevel.DEBUG,
      trace: LogLevel.TRACE,
    };

    return levelMap[level.toLowerCase()] || LogLevel.INFO;
  }
}

/**
 */

/**
 */
export const InjectLogger = () => Inject(UNIFIED_LOGGER);

/**
 */
export const InjectLoggerFactory = () => Inject(LOGGER_FACTORY);

/**
 */
export const InjectLoggerConfig = () => Inject(LOGGER_CONFIG);