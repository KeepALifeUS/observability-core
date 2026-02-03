# Unified Logger Service - Context7 2025 Enterprise Edition

Enterprise-grade унифицированная система логирования для Crypto Trading Bot v5.0 с Context7 2025 patterns и zero-tolerance принципами.

## 🚀 Основные возможности

### ✅ **Context7 2025 Compliance**

- Cloud-native архитектура
- Enterprise-grade security
- High-performance patterns
- Observability-first подход

### 🏗️ **Архитектурные паттерны**

- **Strategy Pattern**: Различные адаптеры логгеров (Winston, Pino)
- **Factory Pattern**: Удобное создание логгеров с предустановками
- **Adapter Pattern**: Унификация различных транспортов
- **Observer Pattern**: OpenTelemetry интеграция
- **Middleware Pattern**: Обработка лог сообщений

### 🔧 **Enterprise Features**

- **Correlation ID Tracking**: Сквозное отслеживание запросов
- **Context Preservation**: AsyncLocalStorage для контекста
- **Sensitive Data Masking**: GDPR/PCI DSS compliance
- **OpenTelemetry Integration**: Distributed tracing
- **Circuit Breaker**: Защита от каскадных отказов
- **Performance Monitoring**: Встроенные метрики

### ⚡ **Производительность**

- **Async Logging**: Неблокирующее логирование
- **Buffer Management**: Батчевая обработка
- **HFT Optimized**: Оптимизация для высокочастотной торговли
- **Memory Efficient**: Контроль использования памяти

## 📦 Структура пакета

```

src/logger/
├── interfaces/              # Интерфейсы и типы
│   └── logger.interface.ts   # Основные интерфейсы
├── core/                    # Основной сервис
│   └── unified-logger.service.ts
├── transports/              # Адаптеры транспортов
│   ├── winston.transport.ts
│   └── pino.transport.ts
├── factories/               # Фабрики логгеров
│   └── logger.factory.ts
├── utils/                   # Утилиты
│   ├── correlation-id.utils.ts
│   └── sensitive-data.utils.ts
├── middleware/              # Middleware
│   └── opentelemetry.middleware.ts
├── nestjs/                  # NestJS интеграция
│   └── logger.module.ts
└── index.ts                 # Главный экспорт

```

## 🎯 Быстрый старт

### Простое использование

```typescript
import { LoggerFactory, LogLevel } from '@crypto-trading-bot/observability-core';

// Development логгер
const logger = LoggerFactory.createDev('my-service', LogLevel.DEBUG);

await logger.info('Application started', {
  version: '1.0.0',
  environment: 'development'
});

// Trading специфичный логгер
const tradingLogger = LoggerFactory.createTrading('trading-engine', 'binance');

await tradingLogger.logTradingEvent('order', {
  symbol: 'BTCUSDT',
  side: 'BUY',
  quantity: 0.001,
  price: 45000
});

```

### NestJS интеграция

```typescript
import { Module } from '@nestjs/common';
import { UnifiedLoggerModule } from '@crypto-trading-bot/observability-core';

@Module({
  imports: [
    // Development
    UnifiedLoggerModule.forDevelopment('my-app'),

    // Production
    UnifiedLoggerModule.forProduction('my-app', '1.0.0'),

    // Trading HFT
    UnifiedLoggerModule.forTrading('trading-engine', 'binance'),
  ],
})
export class AppModule {}

```

### В сервисах

```typescript
import { Injectable } from '@nestjs/common';
import { InjectLogger, IUnifiedLogger } from '@crypto-trading-bot/observability-core';

@Injectable()
export class TradingService {
  constructor(
    @InjectLogger() private readonly logger: IUnifiedLogger
  ) {}

  async placeOrder(orderData: any) {
    const timerId = this.logger.startTimer('place-order');

    try {
      // Business logic
      await this.executeOrder(orderData);

      await this.logger.endTimer(timerId, true);
      await this.logger.auditBusiness('order-placed', 'trading', orderData);

    } catch (error) {
      await this.logger.endTimer(timerId, false);
      await this.logger.error('Order placement failed', error, orderData);
      throw error;
    }
  }
}

```

## 🔧 Конфигурация

### Полная конфигурация

```typescript
import {
  LoggerFactory,
  LogLevel,
  LoggerAdapter,
  UnifiedLoggerConfig
} from '@crypto-trading-bot/observability-core';

const config: UnifiedLoggerConfig = {
  service: 'crypto-trading-bot',
  version: '3.0.0',
  environment: 'production',
  defaultLevel: LogLevel.INFO,

  // Context & Correlation
  enableContextPreservation: true,
  enableCorrelationTracking: true,
  correlationHeaderNames: ['x-correlation-id', 'x-request-id'],

  // Security
  enableSensitiveDataMasking: true,
  sensitiveFields: ['apiKey', 'secret', 'password'],

  // Performance
  asyncLogging: true,
  bufferSize: 100,
  flushInterval: 5000,

  // OpenTelemetry
  enableOpenTelemetry: true,
  otelServiceName: 'crypto-trading-bot',

  // Circuit Breaker
  circuitBreaker: {
    enabled: true,
    failureThreshold: 10,
    resetTimeout: 60000,
  },

  // Transports
  transports: [
    // Console transport
    {
      adapter: LoggerAdapter.WINSTON,
      level: LogLevel.INFO,
      enabled: true,
      options: {
        colorize: true,
        timestamp: true,
      },
    },

    // File transport
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

    // High-performance Pino transport for trading
    {
      adapter: LoggerAdapter.PINO,
      level: LogLevel.INFO,
      enabled: true,
      options: {
        destination: 'logs/trading.log',
        bufferSize: 500,
        extreme: true,
      },
    },
  ],
};

const logger = LoggerFactory.create(config);

```

### Environment переменные

```bash
# Basic configuration
NODE_ENV=production
APP_NAME=crypto-trading-bot
APP_VERSION=3.0.0
LOG_LEVEL=info

# Logger features
LOGGER_ENABLE_CONTEXT=true
LOGGER_ENABLE_MASKING=true
LOGGER_ENABLE_OTEL=true
LOGGER_ENABLE_CORRELATION=true

# Performance
LOGGER_ASYNC=true
LOGGER_BUFFER_SIZE=100
LOGGER_FLUSH_INTERVAL=5000

# Transports
LOGGER_CONSOLE_ENABLED=true
LOGGER_CONSOLE_LEVEL=info
LOGGER_FILE_PATH=logs/application.log
LOGGER_FILE_LEVEL=info
LOGGER_FILE_MAX_SIZE=10MB
LOGGER_FILE_MAX_FILES=5

```

## 📊 Специализированное логирование

### Security Audit

```typescript
await logger.auditSecurity('login-attempt', 'success', {
  userId: 'user123',
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0...',
});

await logger.auditSecurity('api-access', 'blocked', {
  reason: 'rate-limit-exceeded',
  endpoint: '/api/v1/orders',
});

```

### Business Events

```typescript
await logger.auditBusiness('order-executed', 'trading', {
  orderId: 'order123',
  symbol: 'BTCUSDT',
  side: 'BUY',
  quantity: 0.5,
  price: 45000,
  value: 22500,
  currency: 'USDT',
});

```

### HTTP Request Logging

```typescript
// В middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', async () => {
    const responseTime = Date.now() - start;
    await logger.logHttpRequest(req, res, responseTime);
  });

  next();
});

```

### Trading Events

```typescript
// Order events
await logger.logTradingEvent('order', {
  symbol: 'BTCUSDT',
  exchange: 'binance',
  orderId: 'order123',
  type: 'LIMIT',
  side: 'BUY',
  quantity: 1.0,
  price: 45000,
});

// Position events
await logger.logTradingEvent('position', {
  symbol: 'BTCUSDT',
  positionId: 'pos123',
  size: 2.5,
  unrealizedPnl: 1250.50,
});

```

## 🎯 Context & Correlation

### Context Management

```typescript
// Set default context
logger.setContext({
  userId: 'user123',
  sessionId: 'session456',
  tenantId: 'tenant789',
});

// Create child logger with additional context
const childLogger = logger.child({
  component: 'order-service',
  operation: 'place-order',
});

// Use context for specific operation
await logger.withContext({ orderId: 'order123' }, async () => {
  await logger.info('Processing order');
  // All logs in this scope will include orderId
});

```

### Correlation ID

```typescript
import { CorrelationUtils } from '@crypto-trading-bot/observability-core';

// Extract from request
const correlationId = CorrelationUtils.extractFromSources(req);

// Generate new
const newCorrelationId = CorrelationUtils.generate();

// Trading specific
const tradingCorrelationId = CorrelationUtils.generateTradingId(
  'order',
  'binance',
  'BTCUSDT'
);

// Create headers for outgoing requests
const headers = CorrelationUtils.createHeaders(context);

```

## 🔒 Security & Data Masking

### Automatic Data Masking

```typescript
const logger = LoggerFactory.createProd('my-service', '1.0.0');

// Sensitive data will be automatically masked
await logger.info('User login', {
  email: 'user@example.com',          // -> us**@ex******.com
  password: 'secretpassword',         // -> [MASKED]
  apiKey: 'abc123xyz789',            // -> [MASKED]
  cardNumber: '4111111111111111',    // -> 4111****1111
});

```

### Custom Masking Rules

```typescript
import {
  SensitiveDataMasker,
  MaskingLevel,
  SensitiveDataType
} from '@crypto-trading-bot/observability-core';

const masker = new SensitiveDataMasker({
  enabled: true,
  defaultLevel: MaskingLevel.PARTIAL,
  rules: [
    {
      name: 'wallet-addresses',
      dataType: SensitiveDataType.WALLET_ADDRESS,
      level: MaskingLevel.PARTIAL,
      matcher: /wallet[_-]?address/i,
    },
    {
      name: 'trading-keys',
      dataType: SensitiveDataType.TRADING_KEY,
      level: MaskingLevel.FULL,
      matcher: /trading[_-]?(key|secret)/i,
    },
  ],
});

```

## 📈 Performance Monitoring

### Performance Timers

```typescript
// Start timer
const timerId = logger.startTimer('database-query', {
  query: 'SELECT * FROM orders',
  table: 'orders',
});

try {
  const result = await database.query('SELECT * FROM orders');

  // End timer with success
  await logger.endTimer(timerId, true, {
    rowCount: result.length,
  });

} catch (error) {
  // End timer with failure
  await logger.endTimer(timerId, false, {
    errorCode: error.code,
  });
  throw error;
}

```

### Metrics Collection

```typescript
// Performance metrics are automatically included
await logger.info('Operation completed', data, context, {
  performance: {
    duration: 150,
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
  }
});

```

## 🌐 OpenTelemetry Integration

### Automatic Tracing

```typescript
import { OpenTelemetryMiddleware } from '@crypto-trading-bot/observability-core';

const otelMiddleware = new OpenTelemetryMiddleware({
  serviceName: 'trading-engine',
  serviceVersion: '3.0.0',
  enableSpanEvents: true,
  enableSpanAttributes: true,
});

logger.addMiddleware(otelMiddleware);

```

### Manual Span Management

```typescript
// Create span
const tracingContext = otelMiddleware.createSpan('place-order', undefined, {
  attributes: {
    'trading.symbol': 'BTCUSDT',
    'trading.side': 'BUY',
  },
});

try {
  // Business logic
  await placeOrder();

  // Finish span with success
  otelMiddleware.finishSpan(tracingContext.spanId, true);

} catch (error) {
  // Finish span with error
  otelMiddleware.finishSpan(tracingContext.spanId, false, error);
  throw error;
}

```

## 🧪 Testing Support

### Test Logger

```typescript
import { LoggerFactory } from '@crypto-trading-bot/observability-core';

describe('TradingService', () => {
  let logger: IUnifiedLogger;
  let service: TradingService;

  beforeEach(() => {
    logger = LoggerFactory.createTest('trading-service-test');
    service = new TradingService(logger);
  });

  it('should log order placement', async () => {
    await service.placeOrder(orderData);

    // Verify logs were created
    const stats = logger.getStats();
    expect(stats.totalMessages).toBeGreaterThan(0);
  });
});

```

## 📚 Migration Guide

### От v2.x к v3.x

```typescript
// OLD (v2.x)
import { AppLoggerService } from './app-logger.service';
const logger = new AppLoggerService(configService);

// NEW (v3.x)
import { LoggerFactory } from '@crypto-trading-bot/observability-core';
const logger = LoggerFactory.createDev('my-service');

```

### Замена существующих логгеров

1. **Замените импорты**:

   ```typescript
   // Заменить все импорты существующих логгеров
   import { LoggerFactory, IUnifiedLogger } from '@crypto-trading-bot/observability-core';
   ```

2. **Обновите инициализацию**:

   ```typescript
   // Вместо создания собственных экземпляров
   const logger = LoggerFactory.createProd('service-name', '1.0.0');
   ```

3. **Используйте новые методы**:

   ```typescript
   // Используйте специализированные методы
   await logger.auditSecurity('event', 'success', details);
   await logger.auditBusiness('event', 'category', data);
   await logger.logTradingEvent('order', orderData);
   ```

## 🚨 Best Practices

### 1. **Correlation Tracking**

```typescript
// Всегда передавайте correlation ID
const correlationId = CorrelationUtils.extractFromSources(req);
logger.setContext({ correlationId });

```

### 2. **Structured Logging**

```typescript
// Используйте структурированные данные
await logger.info('Order placed', {
  orderId: 'order123',
  symbol: 'BTCUSDT',
  quantity: 1.0,
  price: 45000,
});

```

### 3. **Error Handling**

```typescript
// Всегда передавайте Error объекты
try {
  await riskyOperation();
} catch (error) {
  await logger.error('Operation failed', error, context);
  throw error;
}

```

### 4. **Performance Monitoring**

```typescript
// Используйте таймеры для критических операций
const timerId = logger.startTimer('critical-operation');
try {
  await criticalOperation();
  await logger.endTimer(timerId, true);
} catch (error) {
  await logger.endTimer(timerId, false);
  throw error;
}

```

### 5. **Security Compliance**

```typescript
// Включайте маскирование в production
const logger = LoggerFactory.createProd('service', '1.0.0');
// Sensitive data будет автоматически замаскирована

```

## 📊 Мониторинг и метрики

### Health Checks

```typescript
// Проверка состояния транспортов
const health = await logger.checkTransportsHealth();
console.log('Transport health:', health);

// Статистика логгера
const stats = logger.getStats();
console.log('Logger stats:', stats);

```

### Performance Metrics

```typescript
// Статистика производительности
const stats = logger.getStats();
console.log(`
  Total messages: ${stats.totalMessages}
  Average response time: ${stats.avgResponseTime}ms
  Errors: ${stats.errors}
  Last message: ${stats.lastMessageTime}
`);

```

## 🔧 Troubleshooting

### Общие проблемы

1. **Логи не записываются**
   - Проверьте уровень логирования
   - Убедитесь что транспорты enabled
   - Проверьте права доступа к файлам

2. **Низкая производительность**
   - Включите asyncLogging
   - Увеличьте bufferSize
   - Используйте Pino для HFT

3. **Ошибки транспортов**
   - Проверьте circuit breaker статус
   - Мониторьте health checks
   - Проверьте конфигурацию транспортов

### Debug режим

```typescript
// Включите debug логирование
const logger = LoggerFactory.createDev('service', LogLevel.TRACE);

// Мониторинг внутреннего состояния
logger.on('error', (error) => {
  console.error('Logger internal error:', error);
});

```

## 📝 Changelog

### v3.0.0 - Context7 2025 Edition

- ✅ Полная переработка архитектуры
- ✅ Context7 2025 compliance
- ✅ OpenTelemetry интеграция
- ✅ Enhanced security masking
- ✅ HFT performance optimizations
- ✅ NestJS модуль
- ✅ Backward compatibility layer

### v2.x Legacy

- Поддерживается для миграции
- Deprecated warnings
- Security patches only

---

## 📞 Support

- **Documentation**: `/docs/logging/`
- **Issues**: GitHub Issues
- **Security**: <security@crypto-trading-bot.com>

**Enterprise Support**: Контактируйте команду CTB3 для enterprise поддержки и кастомизации.

---

*Generated by Context7 2025 Enterprise Documentation System*
