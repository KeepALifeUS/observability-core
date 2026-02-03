/**
 * Simple Logger Factory - 2025 Basic Implementation
 *
 * @description
 * @author  Trading Team
 * @version 3.0.0 - 2025
 */

import { UnifiedLoggerService } from '../core/unified-logger.service';
import {
  type IUnifiedLogger,
  type UnifiedLoggerConfig,
  LogLevel,
  LoggerAdapter,
} from '../interfaces/logger.interface';
import { ConsoleTransport } from '../transports/console.transport';

/**
 * Simple Logger Factory
 */
export class SimpleLoggerFactory {
  /**
   */
  static createConsole(service: string, level: LogLevel = LogLevel.INFO): IUnifiedLogger {
    const config: UnifiedLoggerConfig = {
      service,
      version: '1.0.0',
      environment: process.env['NODE_ENV'] || 'development',
      defaultLevel: level,
      enableContextPreservation: true,
      enableSensitiveDataMasking: false,
      enableOpenTelemetry: false,
      enableCorrelationTracking: true,
      transports: [
        {
          adapter: LoggerAdapter.CONSOLE,
          level,
          enabled: true,
          options: {},
        },
      ],
    };

    const logger = new UnifiedLoggerService(config);

    // Add console transport if configured
    const consoleConfig = config.transports[0];
    if (consoleConfig) {
      const transport = new ConsoleTransport(consoleConfig);
      logger.addTransport('console', transport);
    }

    return logger;
  }

  /**
   */
  static createDev(service: string): IUnifiedLogger {
    return this.createConsole(service, LogLevel.DEBUG);
  }

  /**
   * production
   */
  static createProd(service: string): IUnifiedLogger {
    return this.createConsole(service, LogLevel.INFO);
  }

  /**
   */
  static createTest(service: string): IUnifiedLogger {
    return this.createConsole(service, LogLevel.DEBUG);
  }
}