/**
 * 2025 Observability Core - Enterprise Cloud-Native Monitoring
 *
 * Comprehensive observability package implementing Enterprise patterns:
 * - Distributed Tracing (OpenTelemetry)
 * - Prometheus Metrics
 * - Structured Logging
 * - Health Checks
 * - Circuit Breakers
 * - Service Mesh Integration
 * - Performance Monitoring
 * - SLI/SLO Management
 */

// Core Observability Module
export { ObservabilityModule } from './modules/observability.module';

// Services
export { ObservabilityService } from './services/observability.service';
export { MetricsService } from './services/metrics.service';
export { TracingService } from './services/tracing.service';
export { LoggingService } from './services/logging.service';
export { HealthService } from './services/health.service';
export { CircuitBreakerService } from './services/circuit-breaker.service';
export { AlertingService } from './services/alerting.service';
export { SLIService } from './services/sli.service';
export { APMService } from './services/apm.service';

// Controllers
export { ObservabilityController } from './controllers/observability.controller';
export { MetricsController } from './controllers/metrics.controller';
export { HealthController } from './controllers/health.controller';

// Types and Interfaces
export * from './types';

// TODO: Future exports (files need to be created):
// - Interceptors: tracing, metrics, performance
// - Filters: observability-exception
// - Guards: circuit-breaker
// - Decorators: @Trace, @Metric, @Monitor, etc.
// - Config: observability.config
// - Utils: utility functions
// - Constants: shared constants