/**
 * 2025 Enterprise Observability Service
 * Core orchestration service for all observability components
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  IObservabilityConfig,
  IHealthCheckResult,
  IPerformanceMetrics,
  IMetricValue,
  IAlert
} from '../interfaces/observability.interface';

import { AlertingService, AlertSeverity } from './alerting.service';
import { APMService } from './apm.service';
import { CircuitBreakerService } from './circuit-breaker.service';
import { HealthService } from './health.service';
import { LoggingService } from './logging.service';
import { MetricsService } from './metrics.service';
import { SLIService } from './sli.service';
import { TracingService } from './tracing.service';

@Injectable()
export class ObservabilityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObservabilityService.name);
  private isInitialized = false;
  private shutdownInProgress = false;
  private healthCheckInterval!: NodeJS.Timeout;
  private metricsCollectionInterval!: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    private readonly metricsService: MetricsService,
    private readonly tracingService: TracingService,
    private readonly loggingService: LoggingService,
    private readonly healthService: HealthService,
    private readonly alertingService: AlertingService,
    private readonly sliService: SLIService,
    private readonly apmService: APMService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  async onModuleDestroy(): Promise<void> {
    await this.shutdown();
  }

  /**
   * Initialize all observability components
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Observability service already initialized');
      return;
    }

    try {
      this.logger.log('🚀 Initializing 2025 Observability System...');

      // Get configuration
      const config = this.getObservabilityConfig();

      // Initialize core components in dependency order
      await this.initializeComponents(config);

      // Start background processes
      await this.startBackgroundProcesses(config);

      // Register event listeners
      this.registerEventListeners();

      // Mark as initialized
      this.isInitialized = true;

      // Emit initialization event
      this.eventEmitter.emit('observability.initialized', {
        timestamp: new Date(),
        service: config.service,
        components: this.getComponentStatus(),
      });

      this.logger.log('✅ 2025 Observability System initialized successfully');
      this.logger.log(`📊 Service: ${config.service.name} v${config.service.version}`);
      this.logger.log(`🌍 Environment: ${config.service.environment}`);
      this.logger.log(`🆔 Instance: ${config.service.instanceId}`);

    } catch (error: unknown) {
      this.logger.error(`❌ Failed to initialize observability system: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Graceful shutdown of observability system
   */
  async shutdown(): Promise<void> {
    if (this.shutdownInProgress) {
      return;
    }

    this.shutdownInProgress = true;
    this.logger.log('🛑 Shutting down observability system...');

    try {
      // Clear intervals
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
      if (this.metricsCollectionInterval) {
        clearInterval(this.metricsCollectionInterval);
      }

      // Shutdown components in reverse order
      await this.circuitBreakerService.shutdown();
      await this.apmService.shutdown();
      await this.sliService.shutdown();
      await this.alertingService.shutdown();
      await this.healthService.shutdown();
      await this.tracingService.shutdown();
      await this.metricsService.shutdown();
      await this.loggingService.shutdown();

      this.logger.log('✅ Observability system shutdown completed');

    } catch (error: unknown) {
      this.logger.error(`❌ Error during observability shutdown: ${(error as Error).message}`, (error as Error).stack);
    } finally {
      this.isInitialized = false;
      this.shutdownInProgress = false;
    }
  }

  /**
   * Get comprehensive system health status
   */
  async getHealthStatus(): Promise<IHealthCheckResult> {
    if (!this.isInitialized) {
      throw new Error('Observability service not initialized');
    }

    return await this.healthService.getHealthStatus();
  }

  /**
   * Get current performance metrics
   */
  async getPerformanceMetrics(): Promise<IPerformanceMetrics> {
    if (!this.isInitialized) {
      throw new Error('Observability service not initialized');
    }

    return await this.apmService.getPerformanceMetrics();
  }

  /**
   * Record custom metric
   */
  async recordMetric(metric: IMetricValue): Promise<void> {
    if (!this.isInitialized) {
      this.logger.warn('Cannot record metric: observability service not initialized');
      return;
    }

    await this.metricsService.recordMetric(metric);
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(): Promise<IAlert[]> {
    if (!this.isInitialized) {
      throw new Error('Observability service not initialized');
    }

    return await this.alertingService.getActiveAlerts() as unknown as IAlert[];
  }

  /**
   * Trigger manual health check
   */
  async triggerHealthCheck(): Promise<IHealthCheckResult> {
    if (!this.isInitialized) {
      throw new Error('Observability service not initialized');
    }

    return await this.healthService.performHealthCheck();
  }

  /**
   * Get component status
   */
  getComponentStatus(): Record<string, boolean> {
    return {
      initialized: this.isInitialized,
      metrics: this.metricsService.getIsEnabled(),
      tracing: this.tracingService.getIsEnabled(),
      logging: this.loggingService.isEnabled(),
      health: this.healthService.getIsEnabled(),
      alerting: this.alertingService.isEnabled(),
      sli: this.sliService.isEnabled(),
      apm: this.apmService.isEnabled(),
      circuitBreaker: this.circuitBreakerService.getIsEnabled(),
    };
  }

  /**
   * Initialize all components
   */
  private async initializeComponents(config: IObservabilityConfig): Promise<void> {
    this.logger.log('🔧 Initializing observability components...');

    // Initialize logging first (other components depend on it)
    if (config.logging.enabled) {
      await this.loggingService.initialize(config.logging as any);
      this.logger.log('✅ Logging service initialized');
    }

    // Initialize metrics
    if (config.metrics.enabled) {
      await this.metricsService.initialize(config.metrics);
      this.logger.log('✅ Metrics service initialized');
    }

    // Initialize tracing
    if (config.tracing.enabled) {
      await this.tracingService.initialize(config.tracing);
      this.logger.log('✅ Tracing service initialized');
    }

    // Initialize health checks
    if (config.health.enabled) {
      await this.healthService.initialize(config.health);
      this.logger.log('✅ Health service initialized');
    }

    // Initialize alerting
    if (config.alerting.enabled) {
      await this.alertingService.initialize(config.alerting as any);
      this.logger.log('✅ Alerting service initialized');
    }

    // Initialize SLI/SLO monitoring
    if (config.sli.enabled) {
      await this.sliService.initialize(config.sli);
      this.logger.log('✅ SLI/SLO service initialized');
    }

    // Initialize APM
    if (config.apm.enabled) {
      await this.apmService.initialize(config.apm as any);
      this.logger.log('✅ APM service initialized');
    }

    // Initialize circuit breaker
    if (config.circuitBreaker.enabled) {
      await this.circuitBreakerService.initialize(config.circuitBreaker);
      this.logger.log('✅ Circuit breaker service initialized');
    }
  }

  /**
   * Start background monitoring processes
   */
  private async startBackgroundProcesses(config: IObservabilityConfig): Promise<void> {
    this.logger.log('🔄 Starting background monitoring processes...');

    // Health check monitoring
    if (config.health.enabled) {
      const healthCheckInterval = this.configService.get<number>('HEALTH_CHECK_INTERVAL', 30000);
      this.healthCheckInterval = setInterval(async () => {
        try {
          const healthResult = await this.healthService.performHealthCheck();

          // Emit health check event
          this.eventEmitter.emit('health.check.completed', healthResult);

          // Check for unhealthy services and alert
          if (healthResult.status !== 'healthy') {
            this.eventEmitter.emit('health.check.unhealthy', healthResult);
          }
        } catch (error: unknown) {
          this.logger.error(`Health check failed: ${(error as Error).message}`);
        }
      }, healthCheckInterval);
    }

    // Metrics collection
    if (config.metrics.enabled) {
      const metricsInterval = this.configService.get<number>('METRICS_COLLECTION_INTERVAL', 15000);
      this.metricsCollectionInterval = setInterval(async () => {
        try {
          await this.metricsService.collectSystemMetrics();
        } catch (error: unknown) {
          this.logger.error(`Metrics collection failed: ${(error as Error).message}`);
        }
      }, metricsInterval);
    }
  }

  /**
   * Register event listeners for cross-component communication
   */
  private registerEventListeners(): void {
    this.logger.log('📡 Registering event listeners...');

    // Health check events
    this.eventEmitter.on('health.check.unhealthy', async (result: IHealthCheckResult) => {
      await this.alertingService.sendAlert({
        id: `health-${Date.now()}`,
        title: 'Service Health Check Failed',
        name: 'Service Health Check Failed',
        message: `Health check for ${result.info.service.name} returned ${result.status}`,
        severity: result.status === 'degraded' ? AlertSeverity.MEDIUM : AlertSeverity.CRITICAL,
        source: 'health-check',
        status: 'firing',
        startsAt: new Date(),
        labels: {
          service: result.info.service.name,
          environment: result.info.service.environment,
          instance: result.info.service.instanceId,
        },
        annotations: {
          summary: `Service health check failed: ${result.status}`,
          description: `Health check for ${result.info.service.name} returned ${result.status}`,
        },
        generatorURL: `${this.configService.get('BASE_URL', 'http://localhost:3000')}/health`,
      });
    });

    // Circuit breaker events
    this.eventEmitter.on('circuit-breaker.opened', async (data) => {
      await this.alertingService.sendAlert({
        id: `circuit-breaker-${data.service}-${Date.now()}`,
        title: 'Circuit Breaker Opened',
        name: 'Circuit Breaker Opened',
        message: `Circuit breaker for ${data.service} has opened due to ${data.reason}`,
        severity: AlertSeverity.MEDIUM,
        source: 'circuit-breaker',
        status: 'firing',
        startsAt: new Date(),
        labels: {
          service: data.service,
          circuit: data.circuit,
        },
        annotations: {
          summary: `Circuit breaker opened for ${data.service}`,
          description: `Circuit breaker for ${data.service} has opened due to ${data.reason}`,
        },
        generatorURL: `${this.configService.get('BASE_URL', 'http://localhost:3000')}/metrics`,
      });
    });

    // Performance threshold events
    this.eventEmitter.on('performance.threshold.exceeded', async (data) => {
      await this.alertingService.sendAlert({
        id: `performance-${data.metric}-${Date.now()}`,
        title: 'Performance Threshold Exceeded',
        name: 'Performance Threshold Exceeded',
        message: `${data.metric} value ${data.value} exceeded threshold ${data.threshold}`,
        severity: data.severity || AlertSeverity.MEDIUM,
        source: 'performance-monitor',
        status: 'firing',
        startsAt: new Date(),
        labels: {
          metric: data.metric,
          threshold: data.threshold.toString(),
          value: data.value.toString(),
        },
        annotations: {
          summary: `Performance threshold exceeded for ${data.metric}`,
          description: `${data.metric} value ${data.value} exceeded threshold ${data.threshold}`,
        },
        generatorURL: `${this.configService.get('BASE_URL', 'http://localhost:3000')}/metrics`,
      });
    });

    this.logger.log('✅ Event listeners registered');
  }

  /**
   * Get observability configuration from environment
   */
  private getObservabilityConfig(): IObservabilityConfig {
    const config: IObservabilityConfig = {
      service: {
        name: this.configService.get<string>('SERVICE_NAME', '-service'),
        version: this.configService.get<string>('SERVICE_VERSION', '1.0.0'),
        environment: this.configService.get<string>('NODE_ENV', 'development'),
        instanceId: this.configService.get<string>('INSTANCE_ID', `instance-${Date.now()}`),
        deployment: {
          region: this.configService.get<string>('DEPLOY_REGION', 'us-east-1'),
          zone: this.configService.get<string>('DEPLOY_ZONE', 'us-east-1a'),
          cluster: this.configService.get<string>('CLUSTER_NAME', '-cluster'),
          namespace: this.configService.get<string>('NAMESPACE', 'default'),
        },
        labels: {
          app: this.configService.get<string>('SERVICE_NAME', '-service'),
          version: this.configService.get<string>('SERVICE_VERSION', '1.0.0'),
          environment: this.configService.get<string>('NODE_ENV', 'development'),
        },
      },

      telemetry: {
        enabled: this.configService.get<boolean>('TELEMETRY_ENABLED', true),
        endpoints: {
          metrics: this.configService.get<string>('METRICS_ENDPOINT', 'http://localhost:9090'),
          traces: this.configService.get<string>('TRACES_ENDPOINT', 'http://localhost:14268'),
          logs: this.configService.get<string>('LOGS_ENDPOINT', 'http://localhost:9200'),
        },
        sampling: {
          traceRatio: this.configService.get<number>('TRACE_SAMPLE_RATIO', 0.1),
          errorSampling: this.configService.get<boolean>('ERROR_SAMPLING', true),
          slowRequestSampling: this.configService.get<boolean>('SLOW_REQUEST_SAMPLING', true),
        },
        export: {
          batchTimeout: this.configService.get<number>('EXPORT_BATCH_TIMEOUT', 5000),
          maxBatchSize: this.configService.get<number>('EXPORT_MAX_BATCH_SIZE', 512),
          maxQueueSize: this.configService.get<number>('EXPORT_MAX_QUEUE_SIZE', 2048),
        },
      },

      // Add other configuration sections based on environment variables
      metrics: {
        enabled: this.configService.get<boolean>('METRICS_ENABLED', true),
        prometheus: {
          enabled: this.configService.get<boolean>('PROMETHEUS_ENABLED', true),
          port: this.configService.get<number>('PROMETHEUS_PORT', 9464),
          path: this.configService.get<string>('PROMETHEUS_PATH', '/metrics'),
          prefix: this.configService.get<string>('PROMETHEUS_PREFIX', '_'),
        },
        custom: {
          enabled: this.configService.get<boolean>('CUSTOM_METRICS_ENABLED', true),
          trading: {
            orders: true,
            executions: true,
            positions: true,
            pnl: true,
          },
          api: {
            requestDuration: true,
            requestSize: true,
            responseSize: true,
            requestRate: true,
          },
          database: {
            queryDuration: true,
            connectionPool: true,
            transactionRate: true,
          },
        },
        business: {
          enabled: this.configService.get<boolean>('BUSINESS_METRICS_ENABLED', true),
          revenue: {
            enabled: true,
            currency: 'USD',
            updateInterval: 60000,
          },
          userActivity: {
            enabled: true,
            sessionTracking: true,
            featureUsage: true,
          },
          tradingVolume: {
            enabled: true,
            bySymbol: true,
            byUser: true,
          },
        },
        system: {
          enabled: this.configService.get<boolean>('SYSTEM_METRICS_ENABLED', true),
          process: {
            memory: true,
            cpu: true,
            eventLoop: true,
            gc: true,
          },
          nodejs: {
            version: true,
            uptime: true,
            activeHandles: true,
            activeRequests: true,
          },
        },
      },

      logging: {
        enabled: this.configService.get<boolean>('LOGGING_ENABLED', true),
        level: this.configService.get<string>('LOG_LEVEL', 'info') as any,
        format: this.configService.get<string>('LOG_FORMAT', 'json') as any,
        structured: {
          enabled: this.configService.get<boolean>('STRUCTURED_LOGGING', true),
          correlationId: true,
          requestId: true,
          userId: true,
          sessionId: true,
        },
        outputs: {
          console: {
            enabled: this.configService.get<boolean>('LOG_CONSOLE', true),
            colorize: this.configService.get<boolean>('LOG_COLORIZE', false),
            timestamp: true,
          },
          file: {
            enabled: this.configService.get<boolean>('LOG_FILE', false),
            path: this.configService.get<string>('LOG_FILE_PATH', './logs'),
            filename: 'app.log',
            maxSize: '10MB',
            maxFiles: 5,
            rotation: true,
          },
          elasticsearch: {
            enabled: this.configService.get<boolean>('LOG_ELASTICSEARCH', false),
            node: this.configService.get<string>('ELASTICSEARCH_NODE', 'http://localhost:9200'),
            index: this.configService.get<string>('LOG_ELASTICSEARCH_INDEX', '-logs'),
          },
          loki: {
            enabled: this.configService.get<boolean>('LOG_LOKI', false),
            host: this.configService.get<string>('LOKI_HOST', 'http://localhost:3100'),
            labels: {
              service: this.configService.get<string>('SERVICE_NAME', '-service'),
              environment: this.configService.get<string>('NODE_ENV', 'development'),
            },
          },
        },
        enrichment: {
          timestamp: true,
          hostname: true,
          processId: true,
          memoryUsage: true,
          requestInfo: true,
          userContext: true,
          errorStack: true,
        },
      },

      tracing: {
        enabled: this.configService.get<boolean>('TRACING_ENABLED', true),
        serviceName: this.configService.get<string>('SERVICE_NAME', '-service'),
        sampling: {
          probability: this.configService.get<number>('TRACE_SAMPLE_RATE', 0.1),
          errorSampling: true,
          slowRequestSampling: true,
          rules: [],
        },
        exporters: {
          jaeger: {
            enabled: this.configService.get<boolean>('JAEGER_ENABLED', true),
            endpoint: this.configService.get<string>('JAEGER_ENDPOINT', 'http://localhost:14268/api/traces'),
          },
          zipkin: {
            enabled: this.configService.get<boolean>('ZIPKIN_ENABLED', false),
            endpoint: this.configService.get<string>('ZIPKIN_ENDPOINT', 'http://localhost:9411/api/v2/spans'),
            serviceName: this.configService.get<string>('SERVICE_NAME', '-service'),
          },
          otlp: {
            enabled: this.configService.get<boolean>('OTLP_ENABLED', false),
            endpoint: this.configService.get<string>('OTLP_ENDPOINT', 'http://localhost:4318/v1/traces'),
            compression: 'gzip',
          },
        },
        instrumentation: {
          http: true,
          express: true,
          nestjs: true,
          pg: true,
          redis: true,
          mongodb: false,
          custom: [],
        },
      },

      health: {
        enabled: this.configService.get<boolean>('HEALTH_ENABLED', true),
        endpoint: this.configService.get<string>('HEALTH_ENDPOINT', '/health'),
        checks: [],
        kubernetes: {
          enabled: this.configService.get<boolean>('K8S_PROBES_ENABLED', true),
          livenessProbe: {
            enabled: true,
            path: '/health/live',
            initialDelaySeconds: 30,
            periodSeconds: 10,
            timeoutSeconds: 5,
            failureThreshold: 3,
          },
          readinessProbe: {
            enabled: true,
            path: '/health/ready',
            initialDelaySeconds: 5,
            periodSeconds: 5,
            timeoutSeconds: 3,
            failureThreshold: 3,
          },
          startupProbe: {
            enabled: true,
            path: '/health/startup',
            initialDelaySeconds: 10,
            periodSeconds: 10,
            timeoutSeconds: 5,
            failureThreshold: 30,
          },
        },
        dependencies: [],
      },

      alerting: {
        enabled: this.configService.get<boolean>('ALERTING_ENABLED', true),
        channels: [],
        rules: [],
        escalation: {
          enabled: false,
          rules: [],
        },
      },

      sli: {
        enabled: this.configService.get<boolean>('SLI_ENABLED', true),
        indicators: [],
        objectives: [],
        errorBudget: {
          enabled: true,
          calculation: 'request',
          burnRateAlert: {
            enabled: true,
            shortWindow: '5m',
            longWindow: '1h',
            threshold: 14.4,
          },
        },
      },

      apm: {
        enabled: this.configService.get<boolean>('APM_ENABLED', true),
        sampling: {
          transactionSampleRate: this.configService.get<number>('APM_TRANSACTION_SAMPLE_RATE', 1.0),
          errorSampleRate: this.configService.get<number>('APM_ERROR_SAMPLE_RATE', 1.0),
        },
        performance: {
          slowTransactionThreshold: this.configService.get<number>('APM_SLOW_TRANSACTION_THRESHOLD', 1000),
          enableRealUserMonitoring: this.configService.get<boolean>('APM_RUM_ENABLED', true),
          enableResourceTiming: this.configService.get<boolean>('APM_RESOURCE_TIMING', true),
        },
        profiling: {
          enabled: this.configService.get<boolean>('APM_PROFILING_ENABLED', false),
          cpuProfiling: this.configService.get<boolean>('APM_CPU_PROFILING', false),
          memoryProfiling: this.configService.get<boolean>('APM_MEMORY_PROFILING', false),
          profilingInterval: this.configService.get<number>('APM_PROFILING_INTERVAL', 60000),
        },
      },

      circuitBreaker: {
        enabled: this.configService.get<boolean>('CIRCUIT_BREAKER_ENABLED', true),
        default: {
          failureThreshold: this.configService.get<number>('CB_FAILURE_THRESHOLD', 5),
          successThreshold: this.configService.get<number>('CB_SUCCESS_THRESHOLD', 3),
          timeout: this.configService.get<number>('CB_TIMEOUT', 5000),
          errorThresholdPercentage: this.configService.get<number>('CB_ERROR_THRESHOLD_PERCENTAGE', 50),
          resetTimeout: this.configService.get<number>('CB_RESET_TIMEOUT', 60000),
          monitoringPeriod: this.configService.get<number>('CB_MONITORING_PERIOD', 10000),
        },
        services: {},
      },
    };

    return config;
  }
}