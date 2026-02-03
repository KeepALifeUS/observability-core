# Observability Core

Enterprise-grade observability framework for Node.js/NestJS applications. Provides unified logging, distributed tracing, metrics collection, health checks, alerting, and circuit breaker patterns using OpenTelemetry.

## Architecture

```
src/
├── controllers/
│   ├── health.controller.ts         # Health check endpoints (/health, /ready, /live)
│   ├── metrics.controller.ts        # Prometheus metrics endpoint
│   └── observability.controller.ts  # Observability dashboard API
├── services/
│   ├── observability.service.ts     # Core orchestration service
│   ├── tracing.service.ts           # Distributed tracing (OpenTelemetry + Jaeger)
│   ├── metrics.service.ts           # Metrics collection (Prometheus)
│   ├── logging.service.ts           # Structured logging coordination
│   ├── health.service.ts            # Health check management
│   ├── alerting.service.ts          # Alert rules and notifications
│   ├── apm.service.ts               # Application Performance Monitoring
│   ├── sli.service.ts               # Service Level Indicators
│   └── circuit-breaker.service.ts   # Circuit breaker pattern (Opossum)
├── interceptors/
│   ├── tracing.interceptor.ts       # Automatic span creation for requests
│   ├── metrics.interceptor.ts       # Request metrics collection
│   └── performance.interceptor.ts   # Performance timing
├── guards/
│   └── circuit-breaker.guard.ts     # Circuit breaker protection
├── filters/
│   └── observability-exception.filter.ts  # Error tracking and reporting
├── logger/
│   ├── core/
│   │   └── unified-logger.service.ts     # Unified logging service
│   ├── factories/
│   │   ├── logger.factory.ts             # Logger factory
│   │   └── simple-logger.factory.ts      # Simple logger for testing
│   ├── transports/
│   │   ├── console.transport.ts          # Console output
│   │   ├── winston.transport.ts          # Winston with file rotation
│   │   └── pino.transport.ts             # High-performance Pino logging
│   ├── middleware/
│   │   └── opentelemetry.middleware.ts   # OTel context propagation
│   ├── utils/
│   │   ├── correlation-id.utils.ts       # Request correlation
│   │   └── sensitive-data.utils.ts       # PII/secret masking
│   └── nestjs/
│       └── logger.module.ts              # NestJS module integration
├── modules/
│   └── observability.module.ts      # Main NestJS module
├── interfaces/
│   └── observability.interface.ts   # Type definitions
└── types/
    └── index.ts                     # Shared types
```

## Key Features

### Distributed Tracing
- OpenTelemetry SDK integration
- Automatic instrumentation for HTTP, Express, NestJS, PostgreSQL, Redis
- Jaeger exporter for trace visualization
- Context propagation across services
- Custom span attributes and events

### Metrics Collection
- Prometheus client integration
- Built-in metrics: request count, latency histograms, error rates
- Custom metric registration (counters, gauges, histograms)
- SLI/SLO tracking
- Cardinality management

### Unified Logging
- Multiple transport support (Console, Winston, Pino)
- Structured JSON logging
- Log levels with runtime configuration
- Correlation ID propagation
- Sensitive data masking (passwords, tokens, PII)
- OpenTelemetry trace context injection

### Health Checks
- Kubernetes-compatible endpoints (/health, /ready, /live)
- Dependency health monitoring
- Custom health check registration
- Graceful degradation reporting

### Circuit Breaker
- Opossum-based circuit breaker
- Configurable thresholds and timeouts
- Fallback handling
- Circuit state monitoring and metrics

### Alerting
- Rule-based alert definitions
- Threshold and anomaly detection
- Multiple notification channels
- Alert deduplication and grouping

## Usage

```typescript
import { ObservabilityModule } from 'observability-core';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'my-service',
      environment: 'production',
      tracing: {
        enabled: true,
        jaegerEndpoint: 'http://jaeger:14268/api/traces',
        samplingRate: 0.1,
      },
      metrics: {
        enabled: true,
        prefix: 'myapp',
        defaultLabels: { service: 'my-service' },
      },
      logging: {
        level: 'info',
        transport: 'pino',
        prettyPrint: false,
      },
      health: {
        enabled: true,
        checks: ['database', 'redis', 'external-api'],
      },
    }),
  ],
})
export class AppModule {}
```

### Using the Logger

```typescript
import { UnifiedLoggerService } from 'observability-core';

@Injectable()
export class MyService {
  constructor(private readonly logger: UnifiedLoggerService) {
    this.logger.setContext('MyService');
  }

  async process(data: any) {
    this.logger.info('Processing started', { dataId: data.id });

    try {
      // ... processing logic
      this.logger.info('Processing completed', { dataId: data.id, duration: 150 });
    } catch (error) {
      this.logger.error('Processing failed', { dataId: data.id, error });
      throw error;
    }
  }
}
```

### Custom Metrics

```typescript
import { MetricsService } from 'observability-core';

@Injectable()
export class OrderService {
  private orderCounter: Counter;
  private orderValueHistogram: Histogram;

  constructor(private readonly metrics: MetricsService) {
    this.orderCounter = this.metrics.createCounter({
      name: 'orders_total',
      help: 'Total number of orders',
      labelNames: ['status', 'type'],
    });

    this.orderValueHistogram = this.metrics.createHistogram({
      name: 'order_value_usd',
      help: 'Order value in USD',
      buckets: [10, 50, 100, 500, 1000, 5000],
    });
  }

  async createOrder(order: Order) {
    this.orderCounter.inc({ status: 'created', type: order.type });
    this.orderValueHistogram.observe(order.value);
  }
}
```

## Tech Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** NestJS 11
- **Tracing:** OpenTelemetry SDK, Jaeger
- **Metrics:** Prometheus client (prom-client)
- **Logging:** Winston, Pino
- **Circuit Breaker:** Opossum
- **Testing:** Jest

## License

MIT
