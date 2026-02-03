/**
 * Unified Logger Service Tests - 2025 Test Suite
 *
 * @description Comprehensive test suite for the unified logger service
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance Jest Testing Standards
 */

import { jest } from '@jest/globals';
import type {
  IUnifiedLogger,
  ILogTransport,
  LogMessage,
  LogLevel,
  UnifiedLoggerConfig,
  LoggerAdapter,
} from '../interfaces/logger.interface';

import { UnifiedLoggerService } from '../core/unified-logger.service';
import { LogLevel as LogLevelEnum } from '../interfaces/logger.interface';

/**
 * Mock transport for testing
 */
class MockTransport implements ILogTransport {
  public readonly adapter = 'mock' as LoggerAdapter;
  public readonly config: any = {
    adapter: 'mock',
    level: LogLevelEnum.INFO,
    enabled: true,
  };

  public messages: LogMessage[] = [];
  public healthy = true;
  public writeError: Error | null = null;

  async write(message: LogMessage): Promise<void> {
    if (this.writeError) {
      throw this.writeError;
    }
    this.messages.push(message);
  }

  async isHealthy(): Promise<boolean> {
    return this.healthy;
  }

  async close(): Promise<void> {
    // Mock implementation
  }

  getLastMessage(): LogMessage | undefined {
    return this.messages[this.messages.length - 1];
  }

  clear(): void {
    this.messages = [];
  }
}

describe('UnifiedLoggerService', () => {
  let logger: UnifiedLoggerService;
  let mockTransport: MockTransport;

  const defaultConfig: UnifiedLoggerConfig = {
    service: 'test-service',
    version: '1.0.0',
    environment: 'test',
    defaultLevel: LogLevelEnum.DEBUG,
    enableContextPreservation: false, // Disabled for testing simplicity
    enableSensitiveDataMasking: false,
    enableOpenTelemetry: false,
    enableCorrelationTracking: true,
    transports: [],
  };

  beforeEach(() => {
    logger = new UnifiedLoggerService(defaultConfig);
    mockTransport = new MockTransport();
    logger.addTransport('mock', mockTransport);
    mockTransport.clear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Logging', () => {
    test('should log info message', async () => {
      const message = 'Test info message';
      const data = { key: 'value' };

      const result = await logger.info(message, data);

      expect(result.success).toBe(true);
      expect(mockTransport.messages).toHaveLength(1);

      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.message).toBe(message);
      expect(loggedMessage?.level).toBe(LogLevelEnum.INFO);
      expect(loggedMessage?.data).toEqual(data);
    });

    test('should log error message with error object', async () => {
      const message = 'Test error message';
      const error = new Error('Test error');
      const data = { context: 'test' };

      const result = await logger.error(message, error, data);

      expect(result.success).toBe(true);
      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.message).toBe(message);
      expect(loggedMessage?.level).toBe(LogLevelEnum.ERROR);
      expect(loggedMessage?.error?.name).toBe('Error');
      expect(loggedMessage?.error?.message).toBe('Test error');
    });

    test('should log all levels', async () => {
      await logger.emergency('Emergency message');
      await logger.alert('Alert message');
      await logger.critical('Critical message');
      await logger.error('Error message');
      await logger.warn('Warning message');
      await logger.notice('Notice message');
      await logger.info('Info message');
      await logger.debug('Debug message');
      await logger.trace('Trace message');

      expect(mockTransport.messages).toHaveLength(9);
      expect(mockTransport.messages.map(m => m.level)).toEqual([
        LogLevelEnum.EMERGENCY,
        LogLevelEnum.ALERT,
        LogLevelEnum.CRITICAL,
        LogLevelEnum.ERROR,
        LogLevelEnum.WARNING,
        LogLevelEnum.NOTICE,
        LogLevelEnum.INFO,
        LogLevelEnum.DEBUG,
        LogLevelEnum.TRACE,
      ]);
    });
  });

  describe('Context Management', () => {
    test('should set and merge context', async () => {
      const context = {
        userId: 'user123',
        sessionId: 'session456',
        component: 'test-component',
      };

      logger.setContext(context);
      await logger.info('Test message');

      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.context.userId).toBe('user123');
      expect(loggedMessage?.context.sessionId).toBe('session456');
      expect(loggedMessage?.context.component).toBe('test-component');
    });

    test('should create child logger with merged context', async () => {
      logger.setContext({ service: 'parent-service' });

      const childLogger = logger.child({
        component: 'child-component',
        operation: 'test-operation',
      });

      await childLogger.info('Child message');

      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.context.service).toBe('parent-service');
      expect(loggedMessage?.context.component).toBe('child-component');
      expect(loggedMessage?.context.operation).toBe('test-operation');
    });

    test('should clear context', async () => {
      logger.setContext({ userId: 'user123' });
      logger.clearContext();
      await logger.info('Test message');

      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.context.userId).toBeUndefined();
    });
  });

  describe('Performance Timers', () => {
    test('should create and end performance timer', async () => {
      const operationName = 'test-operation';
      const metadata = { category: 'test' };

      const timerId = logger.startTimer(operationName, metadata);
      expect(timerId).toBeDefined();

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await logger.endTimer(timerId, true, { result: 'success' });

      expect(result.success).toBe(true);
      expect(mockTransport.messages).toHaveLength(2); // Start and end messages

      const endMessage = mockTransport.getLastMessage();
      expect(endMessage?.data?.operationName).toBe(operationName);
      expect(endMessage?.data?.success).toBe(true);
      expect(endMessage?.performance?.duration).toBeGreaterThan(0);
    });

    test('should handle missing timer gracefully', async () => {
      const result = await logger.endTimer('nonexistent-timer', false);

      expect(result.success).toBe(true);
      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.level).toBe(LogLevelEnum.WARNING);
      expect(loggedMessage?.message).toContain('Timer not found');
    });
  });

  describe('Specialized Logging', () => {
    test('should log security audit event', async () => {
      await logger.auditSecurity('login-attempt', 'success', {
        userId: 'user123',
        ipAddress: '192.168.1.1',
      });

      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.level).toBe(LogLevelEnum.INFO);
      expect(loggedMessage?.message).toContain('Security event: login-attempt');
      expect(loggedMessage?.security?.eventType).toBe('login-attempt');
      expect(loggedMessage?.security?.result).toBe('success');
    });

    test('should log business audit event', async () => {
      await logger.auditBusiness('order-placed', 'trading', {
        orderId: 'order123',
        value: 1000,
        currency: 'USDT',
      });

      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.level).toBe(LogLevelEnum.INFO);
      expect(loggedMessage?.message).toContain('Business event: order-placed');
      expect(loggedMessage?.business?.eventType).toBe('order-placed');
      expect(loggedMessage?.business?.category).toBe('trading');
    });

    test('should log trading event', async () => {
      const orderData = {
        symbol: 'BTCUSDT',
        exchange: 'binance',
        orderId: 'order123',
        side: 'BUY',
        quantity: 1.0,
      };

      await logger.logTradingEvent('order', orderData);

      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.level).toBe(LogLevelEnum.INFO);
      expect(loggedMessage?.message).toContain('Trading order');
      expect(loggedMessage?.context.symbol).toBe('BTCUSDT');
      expect(loggedMessage?.context.exchange).toBe('binance');
      expect(loggedMessage?.context.orderId).toBe('order123');
    });
  });

  describe('Level Filtering', () => {
    test('should respect log level filtering', async () => {
      // Create logger with INFO level
      const infoLogger = new UnifiedLoggerService({
        ...defaultConfig,
        defaultLevel: LogLevelEnum.INFO,
      });
      infoLogger.addTransport('mock', mockTransport);
      mockTransport.clear();

      await infoLogger.debug('Debug message'); // Should be filtered
      await infoLogger.info('Info message');   // Should be logged
      await infoLogger.error('Error message'); // Should be logged

      expect(mockTransport.messages).toHaveLength(2);
      expect(mockTransport.messages[0].level).toBe(LogLevelEnum.INFO);
      expect(mockTransport.messages[1].level).toBe(LogLevelEnum.ERROR);
    });

    test('should check if level is enabled', () => {
      const infoLogger = new UnifiedLoggerService({
        ...defaultConfig,
        defaultLevel: LogLevelEnum.INFO,
      });

      expect(infoLogger.isEnabled(LogLevelEnum.DEBUG)).toBe(false);
      expect(infoLogger.isEnabled(LogLevelEnum.INFO)).toBe(true);
      expect(infoLogger.isEnabled(LogLevelEnum.ERROR)).toBe(true);
    });
  });

  describe('Transport Management', () => {
    test('should add and remove transports', async () => {
      const secondTransport = new MockTransport();

      logger.addTransport('second', secondTransport);
      await logger.info('Test message');

      expect(mockTransport.messages).toHaveLength(1);
      expect(secondTransport.messages).toHaveLength(1);

      const removed = logger.removeTransport('second');
      expect(removed).toBe(true);

      secondTransport.clear();
      await logger.info('Another message');

      expect(mockTransport.messages).toHaveLength(2);
      expect(secondTransport.messages).toHaveLength(0); // Should not receive new messages
    });

    test('should get transport list', () => {
      const transports = logger.getTransports();
      expect(transports.size).toBe(1);
      expect(transports.has('mock')).toBe(true);
    });

    test('should check transports health', async () => {
      const health = await logger.checkTransportsHealth();
      expect(health['mock']).toBe(true);

      mockTransport.healthy = false;
      const unhealthyHealth = await logger.checkTransportsHealth();
      expect(unhealthyHealth['mock']).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should handle transport write errors', async () => {
      const error = new Error('Transport write failed');
      mockTransport.writeError = error;

      const result = await logger.info('Test message');

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].error.message).toBe('Transport write failed');
    });

    test('should continue with other transports when one fails', async () => {
      const secondTransport = new MockTransport();
      logger.addTransport('second', secondTransport);

      mockTransport.writeError = new Error('First transport failed');

      const result = await logger.info('Test message');

      expect(result.success).toBe(false); // Overall failed due to one transport failure
      expect(result.errors).toHaveLength(1);
      expect(mockTransport.messages).toHaveLength(0); // Failed transport
      expect(secondTransport.messages).toHaveLength(1); // Successful transport
    });
  });

  describe('Statistics', () => {
    test('should track logging statistics', async () => {
      await logger.info('Info message');
      await logger.error('Error message');
      await logger.warn('Warning message');

      const stats = logger.getStats();

      expect(stats.totalMessages).toBe(3);
      expect(stats.messagesByLevel[LogLevelEnum.INFO]).toBe(1);
      expect(stats.messagesByLevel[LogLevelEnum.ERROR]).toBe(1);
      expect(stats.messagesByLevel[LogLevelEnum.WARNING]).toBe(1);
      expect(stats.lastMessageTime).toBeDefined();
      expect(stats.avgResponseTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Async Logging', () => {
    test('should handle async logging configuration', async () => {
      const asyncLogger = new UnifiedLoggerService({
        ...defaultConfig,
        asyncLogging: true,
      });
      asyncLogger.addTransport('mock', mockTransport);
      mockTransport.clear();

      await asyncLogger.info('Async message');

      expect(mockTransport.messages).toHaveLength(1);
    });
  });

  describe('Flush Functionality', () => {
    test('should flush successfully', async () => {
      await logger.flush();
      // Should not throw error
    });
  });

  describe('HTTP Request Logging', () => {
    test('should log HTTP request', async () => {
      const mockReq = {
        method: 'GET',
        originalUrl: '/api/v1/orders',
        url: '/api/v1/orders',
        ip: '192.168.1.1',
        get: jest.fn((header: string) => {
          if (header === 'user-agent') return 'Mozilla/5.0';
          return undefined;
        }),
        headers: { 'content-type': 'application/json' },
        query: { page: '1' },
      } as any;

      const mockRes = { statusCode: 200 };
      const responseTime = 150;

      await logger.logHttpRequest(mockReq, mockRes, responseTime);

      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.level).toBe(LogLevelEnum.INFO);
      expect(loggedMessage?.message).toContain('HTTP GET /api/v1/orders');
      expect(loggedMessage?.data?.statusCode).toBe(200);
      expect(loggedMessage?.data?.responseTime).toBe(150);
      expect(loggedMessage?.context.ipAddress).toBe('192.168.1.1');
      expect(loggedMessage?.context.userAgent).toBe('Mozilla/5.0');
    });

    test('should log HTTP request with error status as warning', async () => {
      const mockReq = {
        method: 'POST',
        url: '/api/v1/orders',
        ip: '192.168.1.1',
        get: jest.fn(() => undefined),
        headers: {},
        query: {},
      } as any;

      const mockRes = { statusCode: 400 };
      const responseTime = 50;

      await logger.logHttpRequest(mockReq, mockRes, responseTime);

      const loggedMessage = mockTransport.getLastMessage();
      expect(loggedMessage?.level).toBe(LogLevelEnum.WARNING);
      expect(loggedMessage?.data?.statusCode).toBe(400);
    });
  });
});

describe('Integration Tests', () => {
  test('should work with real-world scenario', async () => {
    const config: UnifiedLoggerConfig = {
      service: 'crypto-trading-bot',
      version: '3.0.0',
      environment: 'test',
      defaultLevel: LogLevelEnum.INFO,
      enableContextPreservation: true,
      enableSensitiveDataMasking: false,
      enableOpenTelemetry: false,
      enableCorrelationTracking: true,
      transports: [],
    };

    const logger = new UnifiedLoggerService(config);
    const transport = new MockTransport();
    logger.addTransport('main', transport);

    // Set application context
    logger.setContext({
      service: 'trading-engine',
      version: '3.0.0',
      environment: 'test',
      component: 'order-service',
    });

    // Simulate trading workflow
    const timerId = logger.startTimer('place-order');

    await logger.info('Starting order placement', {
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1.0,
    });

    await logger.logTradingEvent('order', {
      symbol: 'BTCUSDT',
      exchange: 'binance',
      orderId: 'order123',
      side: 'BUY',
      quantity: 1.0,
      price: 45000,
    });

    await logger.auditBusiness('order-placed', 'trading', {
      orderId: 'order123',
      value: 45000,
      currency: 'USDT',
    });

    await logger.endTimer(timerId, true, { orderId: 'order123' });

    // Verify all messages were logged
    expect(transport.messages.length).toBeGreaterThan(4);

    // Verify context is preserved
    transport.messages.forEach(message => {
      expect(message.context.service).toBe('trading-engine');
      expect(message.context.component).toBe('order-service');
    });

    // Verify specialized logging worked
    const businessMessage = transport.messages.find(m =>
      m.message.includes('Business event: order-placed')
    );
    expect(businessMessage).toBeDefined();
    expect(businessMessage?.business?.eventType).toBe('order-placed');

    const tradingMessage = transport.messages.find(m =>
      m.message.includes('Trading order')
    );
    expect(tradingMessage).toBeDefined();
    expect(tradingMessage?.context.symbol).toBe('BTCUSDT');
  });
});