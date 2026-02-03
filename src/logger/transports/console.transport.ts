/**
 * Console Transport - Simple Console Logging
 *
 * @description
 * @author  Trading Team
 * @version 3.0.0 - 2025
 */

import { ILogTransport, LogMessage, LogTransportConfig, LoggerAdapter } from '../interfaces/logger.interface';

/**
 * Console Transport Implementation
 */
export class ConsoleTransport implements ILogTransport {
  public readonly adapter = LoggerAdapter.CONSOLE;
  public readonly config: LogTransportConfig;

  constructor(config: LogTransportConfig) {
    this.config = config;
  }

  async write(message: LogMessage): Promise<void> {
    if (!this.config.enabled) {return;}

    const timestamp = new Date(message.timestamp).toISOString();
    const level = message.level.toUpperCase().padEnd(9);
    const service = message.context.service || 'unknown';
    const correlationId = message.context.correlationId || 'n/a';

    let logLine = `${timestamp} [${level}] [${service}] [${correlationId}] ${message.message}`;

    if (message.data) {
      logLine += ` | Data: ${JSON.stringify(message.data)}`;
    }

    if (message.error) {
      logLine += ` | Error: ${message.error.message}`;
      if (message.error.stack) {
        logLine += `\nStack: ${message.error.stack}`;
      }
    }

    // Use appropriate console method
    switch (message.level) {
      case 'emergency':
      case 'alert':
      case 'critical':
      case 'error':
        console.error(logLine);
        break;
      case 'warning':
        console.warn(logLine);
        break;
      default:
        console.log(logLine);
    }
  }

  async isHealthy(): Promise<boolean> {
    return true; // Console is always healthy
  }

  async close(): Promise<void> {
    // Nothing to close for console
  }
}