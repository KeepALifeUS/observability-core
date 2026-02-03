/**
 * Unified Logger - 2025 Enterprise Logging Export Index
 *
 * @description
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance Enterprise Standards
 */

// ==================== CORE INTERFACES ====================
export {
  type IUnifiedLogger,
  type ILogTransport,
  type ILoggerFactory,
  type ILoggerMiddleware,
  type LogMessage,
  type LogContext,
  LogLevel,
  LoggerAdapter,
  type LogResult,
  type LogStats,
  type LogFilter,
  type LogTransportConfig,
  type UnifiedLoggerConfig,
  type SensitiveDataMask,
} from './interfaces/logger.interface';

// ==================== CORE LOGGER SERVICE ====================
export { UnifiedLoggerService } from './core/unified-logger.service';

// ==================== FACTORIES ====================
export { SimpleLoggerFactory } from './factories/simple-logger.factory';

// Full factory (may require additional dependencies)
// export {
//   UnifiedLoggerFactory,
//   LoggerFactory,
//   globalLoggerFactory,
//   LoggerPreset,
// } from './factories/logger.factory';

// ==================== TRANSPORTS ====================
export { ConsoleTransport } from './transports/console.transport';

// ==================== INTERNAL IMPORTS FOR FUNCTIONS ====================
import { UnifiedLoggerService } from './core/unified-logger.service';
import { SimpleLoggerFactory } from './factories/simple-logger.factory';
import { LogLevel, LoggerAdapter } from './interfaces/logger.interface';
import type {
  IUnifiedLogger,
  UnifiedLoggerConfig,
  ILogTransport,
  LogTransportConfig,
} from './interfaces/logger.interface';
import { ConsoleTransport } from './transports/console.transport';
import { CorrelationUtils } from './utils/correlation-id.utils';

// Import types for function signatures

// Optional transports (may not be available in all environments)
// export {
//   WinstonTransport,
//   WinstonTransportFactory,
// } from './transports/winston.transport';

// export {
//   PinoTransport,
//   PinoTransportFactory,
// } from './transports/pino.transport';

// ==================== UTILITIES ====================
export {
  EnhancedCorrelationManager,
  CorrelationUtils,
  CorrelationStrategy,
  CORRELATION_CONFIGS,
} from './utils/correlation-id.utils';

export {
  SensitiveDataMasker,
  MaskingLevel,
  SensitiveDataType,
  MASKING_RULES,
  MASKING_CONFIGS,
} from './utils/sensitive-data.utils';

export type {
  CorrelationConfig,
  ParsedCorrelationId,
  W3CTraceContext,
} from './utils/correlation-id.utils';

export type {
  MaskingConfig,
  MaskingRule,
  MaskingResult,
  MaskingContext,
} from './utils/sensitive-data.utils';

// ==================== MIDDLEWARE ====================
export {
  OpenTelemetryMiddleware,
  OpenTelemetryMiddlewareFactory,
} from './middleware/opentelemetry.middleware';

export type {
  OpenTelemetryMiddlewareConfig,
} from './middleware/opentelemetry.middleware';

// ==================== CONVENIENCE FUNCTIONS ====================

/**
 * development
 */
export function createDevLogger(service: string, _level?: LogLevel): IUnifiedLogger {
  return SimpleLoggerFactory.createDev(service);
}

/**
 * production
 */
export function createProdLogger(service: string): IUnifiedLogger {
  return SimpleLoggerFactory.createProd(service);
}

/**
 */
export function createTradingLogger(service: string): IUnifiedLogger {
  return SimpleLoggerFactory.createProd(service);
}

/**
 */
export function createTestLogger(testSuite: string): IUnifiedLogger {
  return SimpleLoggerFactory.createTest(testSuite);
}

/**
 */
export function createCustomLogger(config: UnifiedLoggerConfig): IUnifiedLogger {
  const logger = new UnifiedLoggerService(config);

  // Add console transport by default if no transports configured
  if (config.transports.length === 0) {
    const consoleTransport = new ConsoleTransport({
      adapter: LoggerAdapter.CONSOLE,
      level: config.defaultLevel,
      enabled: true,
      options: {},
    });
    logger.addTransport('console', consoleTransport);
  }

  return logger;
}

// ==================== DEFAULT CONFIGURATIONS ====================

/**
 * development
 */
export const DEFAULT_DEV_CONFIG: Partial<UnifiedLoggerConfig> = {
  defaultLevel: LogLevel.DEBUG,
  enableSensitiveDataMasking: false,
  asyncLogging: false,
  enableContextPreservation: true,
  enableCorrelationTracking: true,
};

/**
 * production
 */
export const DEFAULT_PROD_CONFIG: Partial<UnifiedLoggerConfig> = {
  defaultLevel: LogLevel.INFO,
  enableSensitiveDataMasking: true,
  asyncLogging: true,
  bufferSize: 100,
  flushInterval: 5000,
  enableContextPreservation: true,
  enableCorrelationTracking: true,
  enableOpenTelemetry: true,
  circuitBreaker: {
    enabled: true,
    failureThreshold: 10,
    resetTimeout: 60000,
  },
};

/**
 * (HFT)
 */
export const DEFAULT_HFT_CONFIG: Partial<UnifiedLoggerConfig> = {
  defaultLevel: LogLevel.INFO,
  enableSensitiveDataMasking: false, // Disabled for performance
  asyncLogging: true,
  bufferSize: 500,
  flushInterval: 1000,
  enableContextPreservation: false, // Disabled for performance
  enableCorrelationTracking: true,
  enableOpenTelemetry: false, // Disabled for ultra-low latency
};

// ==================== GLOBAL INSTANCE ====================

/**
 */
export const logger = SimpleLoggerFactory;

// ==================== VERSION INFO ====================
export const VERSION = '3.0.0';
export const CONTEXT7_VERSION = '2025';

// ==================== LEGACY COMPATIBILITY ====================

/**
 * v2.x
 * @deprecated LoggerFactory.create()
 */
export function createLogger(service: string, _level: LogLevel = LogLevel.INFO): IUnifiedLogger {
 console.warn('[DEPRECATED] createLogger() , SimpleLoggerFactory.createDev() SimpleLoggerFactory.createProd()');

  const environment = process.env['NODE_ENV'] || 'development';

  if (environment === 'production') {
    return SimpleLoggerFactory.createProd(service);
  } else {
    return SimpleLoggerFactory.createDev(service);
  }
}

/**
 * ID v2.x
 * @deprecated CorrelationUtils.generate()
 */
export function generateCorrelationId(): string {
 console.warn('[DEPRECATED] generateCorrelationId() , CorrelationUtils.generate()');
  return CorrelationUtils.generate();
}

// ==================== TYPE EXPORTS FOR CONVENIENCE ====================

// Re-export common types for easy access
export type Logger = IUnifiedLogger;
export type LoggerConfig = UnifiedLoggerConfig;
export type Transport = ILogTransport;
export type TransportConfig = LogTransportConfig;

// ==================== CONSTANTS ====================

/**
 */
export const LOG_LEVELS = {
  EMERGENCY: 'emergency' as const,
  ALERT: 'alert' as const,
  CRITICAL: 'critical' as const,
  ERROR: 'error' as const,
  WARNING: 'warning' as const,
  NOTICE: 'notice' as const,
  INFO: 'info' as const,
  DEBUG: 'debug' as const,
  TRACE: 'trace' as const,
} as const;

/**
 */
export const ADAPTERS = {
  WINSTON: 'winston' as const,
  PINO: 'pino' as const,
  CONSOLE: 'console' as const,
  ELASTIC: 'elasticsearch' as const,
  SYSLOG: 'syslog' as const,
  FILE: 'file' as const,
  HTTP: 'http' as const,
} as const;