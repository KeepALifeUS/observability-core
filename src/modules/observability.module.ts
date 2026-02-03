/**
 * 2025 Observability Module
 * Complete enterprise observability integration
 */

import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Controllers
import { HealthController } from '../controllers/health.controller';
import { MetricsController } from '../controllers/metrics.controller';
import { ObservabilityController } from '../controllers/observability.controller';
// Filters and Guards
import { ObservabilityExceptionFilter } from '../filters/observability-exception.filter';
import { CircuitBreakerGuard } from '../guards/circuit-breaker.guard';
// Interceptors
import { MetricsInterceptor } from '../interceptors/metrics.interceptor';
import { PerformanceInterceptor } from '../interceptors/performance.interceptor';
import { TracingInterceptor } from '../interceptors/tracing.interceptor';
// Services
import { AlertingService } from '../services/alerting.service';
import { APMService } from '../services/apm.service';
import { CircuitBreakerService } from '../services/circuit-breaker.service';
import { HealthService } from '../services/health.service';
import { LoggingService } from '../services/logging.service';
import { MetricsService } from '../services/metrics.service';
import { ObservabilityService } from '../services/observability.service';
import { SLIService } from '../services/sli.service';
import { TracingService } from '../services/tracing.service';

// Note: Real implementations of these classes should be created in their respective files
// TODO: Implement these interceptors, filters, and guards with full functionality

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),
  ],
  controllers: [
    ObservabilityController,
    MetricsController,
    HealthController,
  ],
  providers: [
    // Core services
    ObservabilityService,
    MetricsService,
    TracingService,
    HealthService,
    CircuitBreakerService,

    // Supporting services
    LoggingService,
    AlertingService,
    SLIService,
    APMService,

    // Interceptors
    TracingInterceptor,
    MetricsInterceptor,
    PerformanceInterceptor,

    // Filters
    ObservabilityExceptionFilter,

    // Guards
    CircuitBreakerGuard,
  ],
  exports: [
    ObservabilityService,
    MetricsService,
    TracingService,
    HealthService,
    CircuitBreakerService,
    LoggingService,
    AlertingService,
    SLIService,
    APMService,
  ],
})
export class ObservabilityModule {}