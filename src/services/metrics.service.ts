/**
 * 2025 Prometheus Metrics Service
 * Enterprise-grade metrics collection with safe singleton pattern
 *
 * IMPORTANT: prom-client uses global registry by default.
 * Metrics are automatically registered when created via new Histogram/Counter/Gauge().
 * This service uses getOrCreate pattern to prevent "already registered" errors.
 */

import * as os from 'os';
import * as process from 'process';

import { Injectable, Logger } from '@nestjs/common';
import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

import { IMetricsConfig, IMetricValue, IPerformanceMetrics } from '../interfaces/observability.interface';

/**
 * Helper function to get or create metric safely
 * 2025: Prevents "already registered" errors in multi-instance scenarios
 */
function getOrCreateMetric<T extends Counter<string> | Histogram<string> | Gauge<string>>(
  name: string,
  creator: () => T,
): T {
  const existing = register.getSingleMetric(name);
  if (existing) {
    return existing as T;
  }
  return creator();
}

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private _isEnabled = false;
  private config!: IMetricsConfig;

  // Core application metrics
  private readonly httpRequestDuration: Histogram<string>;
  private readonly httpRequestsTotal: Counter<string>;
  private readonly httpRequestSize: Histogram<string>;
  private readonly httpResponseSize: Histogram<string>;

  // Trading-specific metrics
  private readonly tradingOrdersTotal: Counter<string>;
  private readonly tradingOrderDuration: Histogram<string>;
  private readonly tradingPositionsActive: Gauge<string>;
  private readonly tradingPnlTotal: Gauge<string>;
  private readonly tradingVolumeTotal: Counter<string>;

  // Database metrics
  private readonly dbQueryDuration: Histogram<string>;
  private readonly dbConnectionsActive: Gauge<string>;
  private readonly dbTransactionsTotal: Counter<string>;

  // Business metrics
  private readonly revenueTotal: Gauge<string>;
  private readonly usersActive: Gauge<string>;
  private readonly sessionsTotal: Counter<string>;
  private readonly featureUsage: Counter<string>;

  // System metrics
  private readonly memoryUsage: Gauge<string>;
  private readonly cpuUsage: Gauge<string>;
  private readonly eventLoopLag: Histogram<string>;
  // @ts-expect-error - gcDuration is initialized but not directly used, collected by prom-client
  private readonly gcDuration: Histogram<string>;

  // Circuit breaker metrics
  private readonly circuitBreakerState: Gauge<string>;
  private readonly circuitBreakerFailures: Counter<string>;

  // Error metrics
  private readonly errorsTotal: Counter<string>;
  private readonly errorRate: Gauge<string>;

  constructor() {
    // 2025: Use getOrCreate pattern to handle multiple service instances
    // Metrics are automatically registered in global registry when created

    // Initialize HTTP metrics
    this.httpRequestDuration = getOrCreateMetric('_http_request_duration_seconds', () => new Histogram({
      name: '_http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code', 'service'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10],
    }));

    this.httpRequestsTotal = getOrCreateMetric('_http_requests_total', () => new Counter({
      name: '_http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code', 'service'],
    }));

    this.httpRequestSize = getOrCreateMetric('_http_request_size_bytes', () => new Histogram({
      name: '_http_request_size_bytes',
      help: 'Size of HTTP requests in bytes',
      labelNames: ['method', 'route', 'service'],
      buckets: [100, 1000, 10000, 100000, 1000000],
    }));

    this.httpResponseSize = getOrCreateMetric('_http_response_size_bytes', () => new Histogram({
      name: '_http_response_size_bytes',
      help: 'Size of HTTP responses in bytes',
      labelNames: ['method', 'route', 'status_code', 'service'],
      buckets: [100, 1000, 10000, 100000, 1000000],
    }));

    // Initialize Trading metrics
    this.tradingOrdersTotal = getOrCreateMetric('_trading_orders_total', () => new Counter({
      name: '_trading_orders_total',
      help: 'Total number of trading orders',
      labelNames: ['symbol', 'side', 'type', 'status', 'exchange'],
    }));

    this.tradingOrderDuration = getOrCreateMetric('_trading_order_duration_seconds', () => new Histogram({
      name: '_trading_order_duration_seconds',
      help: 'Duration of order execution in seconds',
      labelNames: ['symbol', 'side', 'type', 'exchange'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    }));

    this.tradingPositionsActive = getOrCreateMetric('_trading_positions_active', () => new Gauge({
      name: '_trading_positions_active',
      help: 'Number of active trading positions',
      labelNames: ['symbol', 'side', 'strategy'],
    }));

    this.tradingPnlTotal = getOrCreateMetric('_trading_pnl_total', () => new Gauge({
      name: '_trading_pnl_total',
      help: 'Total profit and loss',
      labelNames: ['currency', 'strategy', 'symbol'],
    }));

    this.tradingVolumeTotal = getOrCreateMetric('_trading_volume_total', () => new Counter({
      name: '_trading_volume_total',
      help: 'Total trading volume',
      labelNames: ['symbol', 'side', 'currency'],
    }));

    // Initialize Database metrics
    this.dbQueryDuration = getOrCreateMetric('_db_query_duration_seconds', () => new Histogram({
      name: '_db_query_duration_seconds',
      help: 'Database query duration in seconds',
      labelNames: ['query_type', 'table', 'status'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    }));

    this.dbConnectionsActive = getOrCreateMetric('_db_connections_active', () => new Gauge({
      name: '_db_connections_active',
      help: 'Number of active database connections',
      labelNames: ['database', 'status'],
    }));

    this.dbTransactionsTotal = getOrCreateMetric('_db_transactions_total', () => new Counter({
      name: '_db_transactions_total',
      help: 'Total number of database transactions',
      labelNames: ['database', 'status'],
    }));

    // Initialize Business metrics
    this.revenueTotal = getOrCreateMetric('_revenue_total', () => new Gauge({
      name: '_revenue_total',
      help: 'Total revenue generated',
      labelNames: ['currency', 'source'],
    }));

    this.usersActive = getOrCreateMetric('_users_active', () => new Gauge({
      name: '_users_active',
      help: 'Number of active users',
      labelNames: ['time_window'],
    }));

    this.sessionsTotal = getOrCreateMetric('_sessions_total', () => new Counter({
      name: '_sessions_total',
      help: 'Total number of user sessions',
      labelNames: ['status'],
    }));

    this.featureUsage = getOrCreateMetric('_feature_usage_total', () => new Counter({
      name: '_feature_usage_total',
      help: 'Feature usage counter',
      labelNames: ['feature', 'user_type'],
    }));

    // Initialize System metrics
    this.memoryUsage = getOrCreateMetric('_memory_usage_bytes', () => new Gauge({
      name: '_memory_usage_bytes',
      help: 'Memory usage in bytes',
      labelNames: ['type'],
    }));

    this.cpuUsage = getOrCreateMetric('_cpu_usage_percent', () => new Gauge({
      name: '_cpu_usage_percent',
      help: 'CPU usage percentage',
    }));

    this.eventLoopLag = getOrCreateMetric('_event_loop_lag_seconds', () => new Histogram({
      name: '_event_loop_lag_seconds',
      help: 'Event loop lag in seconds',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    }));

    this.gcDuration = getOrCreateMetric('_gc_duration_seconds', () => new Histogram({
      name: '_gc_duration_seconds',
      help: 'Garbage collection duration in seconds',
      labelNames: ['kind'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
    }));

    // Initialize Circuit breaker metrics
    this.circuitBreakerState = getOrCreateMetric('_circuit_breaker_state', () => new Gauge({
      name: '_circuit_breaker_state',
      help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
      labelNames: ['service', 'circuit'],
    }));

    this.circuitBreakerFailures = getOrCreateMetric('_circuit_breaker_failures_total', () => new Counter({
      name: '_circuit_breaker_failures_total',
      help: 'Total circuit breaker failures',
      labelNames: ['service', 'circuit', 'reason'],
    }));

    // Initialize Error metrics
    this.errorsTotal = getOrCreateMetric('_errors_total', () => new Counter({
      name: '_errors_total',
      help: 'Total number of errors',
      labelNames: ['service', 'type', 'severity'],
    }));

    this.errorRate = getOrCreateMetric('_error_rate', () => new Gauge({
      name: '_error_rate',
      help: 'Error rate percentage',
      labelNames: ['service', 'time_window'],
    }));
  }

  /**
   * Check if service is enabled
   */
  public isEnabled(): boolean {
    return this._isEnabled;
  }

  /**
   * Initialize metrics collection
   */
  async initialize(config: IMetricsConfig): Promise<void> {
    this.config = config;

    if (!config.enabled) {
      this.logger.log('📊 Metrics collection is disabled');
      return;
    }

    try {
      this.logger.log('📊 Initializing Prometheus metrics collection...');

      // 2025: Metrics are already registered in constructor via getOrCreate pattern
      // No need to call register.clear() or registerMetrics()

      // Configure default metrics collection
      if (config.system.enabled) {
        collectDefaultMetrics({
          register,
          prefix: config.prometheus.prefix || '_',
          labels: {
            service: process.env['SERVICE_NAME'] || '-service',
            environment: process.env['NODE_ENV'] || 'development',
            version: process.env['SERVICE_VERSION'] || '1.0.0',
          },
        });
      }

      // Start system metrics collection
      this.startSystemMetricsCollection();

      this._isEnabled = true;

      this.logger.log('✅ Prometheus metrics collection initialized');
      this.logger.log(`📈 Metrics endpoint: http://localhost:${config.prometheus.port}${config.prometheus.path}`);

    } catch (error: unknown) {
      this.logger.error(`❌ Failed to initialize metrics: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    requestSize?: number,
    responseSize?: number,
  ): void {
    if (!this._isEnabled) {return;}

    const labels = {
      method: method.toUpperCase(),
      route,
      status_code: statusCode.toString(),
      service: process.env['SERVICE_NAME'] || '-service',
    };

    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, duration / 1000); // Convert to seconds

    if (requestSize !== undefined) {
      this.httpRequestSize.observe({ method, route, service: labels.service }, requestSize);
    }

    if (responseSize !== undefined) {
      this.httpResponseSize.observe(labels, responseSize);
    }
  }

  /**
   * Record trading order metrics
   */
  recordTradingOrder(
    symbol: string,
    side: 'buy' | 'sell',
    type: string,
    status: string,
    exchange: string,
    duration?: number,
    volume?: number,
  ): void {
    if (!this._isEnabled) {return;}

    const labels = { symbol, side, type, status, exchange };

    this.tradingOrdersTotal.inc(labels);

    if (duration !== undefined) {
      this.tradingOrderDuration.observe({ symbol, side, type, exchange }, duration / 1000);
    }

    if (volume !== undefined) {
      this.tradingVolumeTotal.inc({ symbol, side, currency: 'USD' }, volume);
    }
  }

  /**
   * Update trading position metrics
   */
  updateTradingPosition(symbol: string, side: 'long' | 'short', strategy: string, count: number): void {
    if (!this._isEnabled) {return;}

    this.tradingPositionsActive.set({ symbol, side, strategy }, count);
  }

  /**
   * Update P&L metrics
   */
  updatePnL(currency: string, strategy: string, symbol: string, pnl: number): void {
    if (!this._isEnabled) {return;}

    this.tradingPnlTotal.set({ currency, strategy, symbol }, pnl);
  }

  /**
   * Record database query metrics
   */
  recordDatabaseQuery(
    queryType: string,
    table: string,
    status: 'success' | 'error',
    duration: number,
  ): void {
    if (!this._isEnabled) {return;}

    this.dbQueryDuration.observe({ query_type: queryType, table, status }, duration / 1000);
    this.dbTransactionsTotal.inc({ database: 'postgresql', status });
  }

  /**
   * Update database connection metrics
   */
  updateDatabaseConnections(database: string, active: number, idle: number): void {
    if (!this._isEnabled) {return;}

    this.dbConnectionsActive.set({ database, status: 'active' }, active);
    this.dbConnectionsActive.set({ database, status: 'idle' }, idle);
  }

  /**
   * Record business metrics
   */
  recordRevenue(currency: string, source: string, amount: number): void {
    if (!this._isEnabled) {return;}

    this.revenueTotal.inc({ currency, source }, amount);
  }

  /**
   * Update user activity metrics
   */
  updateUserActivity(activeUsers: number, timeWindow: string = '5m'): void {
    if (!this._isEnabled) {return;}

    this.usersActive.set({ time_window: timeWindow }, activeUsers);
  }

  /**
   * Record feature usage
   */
  recordFeatureUsage(feature: string, userType: string = 'regular'): void {
    if (!this._isEnabled) {return;}

    this.featureUsage.inc({ feature, user_type: userType });
  }

  /**
   * Record session metrics
   */
  recordSession(status: 'started' | 'ended' | 'timeout'): void {
    if (!this._isEnabled) {return;}

    this.sessionsTotal.inc({ status });
  }

  /**
   * Update circuit breaker metrics
   */
  updateCircuitBreaker(
    service: string,
    circuit: string,
    state: 'closed' | 'open' | 'half-open',
    failures?: number,
    reason?: string,
  ): void {
    if (!this._isEnabled) {return;}

    const stateValue = state === 'closed' ? 0 : state === 'open' ? 1 : 2;
    this.circuitBreakerState.set({ service, circuit }, stateValue);

    if (failures !== undefined && reason) {
      this.circuitBreakerFailures.inc({ service, circuit, reason }, failures);
    }
  }

  /**
   * Record error metrics
   */
  recordError(service: string, type: string, severity: 'low' | 'medium' | 'high' | 'critical'): void {
    if (!this._isEnabled) {return;}

    this.errorsTotal.inc({ service, type, severity });
  }

  /**
   * Update error rate
   */
  updateErrorRate(service: string, rate: number, timeWindow: string = '5m'): void {
    if (!this._isEnabled) {return;}

    this.errorRate.set({ service, time_window: timeWindow }, rate);
  }

  /**
   * Record custom metric
   */
  async recordMetric(metric: IMetricValue): Promise<void> {
    if (!this._isEnabled) {return;}

    try {
      // Find existing metric or create new one
      const existingMetric = register.getSingleMetric(metric.metric);

      if (existingMetric) {
        if (existingMetric instanceof Counter) {
          existingMetric.inc(metric.labels || {}, metric.value);
        } else if (existingMetric instanceof Gauge) {
          existingMetric.set(metric.labels || {}, metric.value);
        } else if (existingMetric instanceof Histogram) {
          existingMetric.observe(metric.labels || {}, metric.value);
        }
      } else {
        this.logger.warn(`Metric ${metric.metric} not found in registry`);
      }
    } catch (error: unknown) {
      this.logger.error(`Failed to record metric ${metric.metric}: ${(error as Error).message}`);
    }
  }

  /**
   * Get current performance metrics
   */
  async getPerformanceMetrics(): Promise<IPerformanceMetrics> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      responseTime: {
        mean: 0, // Would need to calculate from histogram
        p50: 0,
        p95: 0,
        p99: 0,
        max: 0,
      },
      throughput: {
        requestsPerSecond: 0, // Would need to calculate from counter
        requestsPerMinute: 0,
      },
      errorRate: {
        percentage: 0, // Would need to calculate from counters
        count: 0,
        total: 0,
      },
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
        gc: {
          collections: 0, // Would need GC stats
          pauseTime: 0,
        },
      },
      cpu: {
        usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
        loadAverage: os.loadavg(),
      },
    };
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics(): Promise<void> {
    if (!this._isEnabled) {return;}

    try {
      // Memory metrics
      const memUsage = process.memoryUsage();
      this.memoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
      this.memoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
      this.memoryUsage.set({ type: 'external' }, memUsage.external);
      this.memoryUsage.set({ type: 'rss' }, memUsage.rss);

      // CPU metrics
      const cpuUsage = process.cpuUsage();
      this.cpuUsage.set((cpuUsage.user + cpuUsage.system) / 1000000);

      // Event loop lag (simplified)
      const start = process.hrtime.bigint();
      setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to ms
        this.eventLoopLag.observe(lag / 1000); // Convert to seconds
      });

    } catch (error: unknown) {
      this.logger.error(`Failed to collect system metrics: ${(error as Error).message}`);
    }
  }

  /**
   * Get metrics endpoint content
   */
  async getMetrics(): Promise<string> {
    if (!this._isEnabled) {
      return '# Metrics collection is disabled\n';
    }

    return await register.metrics();
  }

  /**
   * Check if metrics are enabled
   */
  getIsEnabled(): boolean {
    return this._isEnabled;
  }

  /**
   * Shutdown metrics service
   */
  async shutdown(): Promise<void> {
    if (this._isEnabled) {
      register.clear();
      this._isEnabled = false;
      this.logger.log('📊 Metrics service shutdown completed');
    }
  }

  /**
   * Start background system metrics collection
   */
  private startSystemMetricsCollection(): void {
    if (!this.config.system.enabled) {return;}

    // Collect system metrics every 15 seconds
    setInterval(() => {
      this.collectSystemMetrics();
    }, 15000);
  }
}
