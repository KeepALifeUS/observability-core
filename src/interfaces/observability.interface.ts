/**
 * 2025 Observability Interfaces
 * Enterprise-grade observability contract definitions
 */

// Core Observability Configuration
export interface IObservabilityConfig {
  service: IServiceInfo;
  telemetry: ITelemetryConfig;
  metrics: IMetricsConfig;
  logging: ILoggingConfig;
  tracing: ITracingConfig;
  health: IHealthConfig;
  alerting: IAlertingConfig;
  sli: ISLIConfig;
  apm: IAPMConfig;
  circuitBreaker: ICircuitBreakerConfig;
}

// Service Information
export interface IServiceInfo {
  name: string;
  version: string;
  environment: string;
  instanceId: string;
  deployment: {
    region: string;
    zone: string;
    cluster: string;
    namespace: string;
  };
  labels: Record<string, string>;
}

// Telemetry Configuration
export interface ITelemetryConfig {
  enabled: boolean;
  endpoints: {
    metrics: string;
    traces: string;
    logs: string;
  };
  sampling: {
    traceRatio: number;
    errorSampling: boolean;
    slowRequestSampling: boolean;
  };
  export: {
    batchTimeout: number;
    maxBatchSize: number;
    maxQueueSize: number;
  };
}

// Metrics Configuration
export interface IMetricsConfig {
  enabled: boolean;
  prometheus: IPrometheusConfig;
  custom: ICustomMetricsConfig;
  business: IBusinessMetricsConfig;
  system: ISystemMetricsConfig;
}

export interface IPrometheusConfig {
  enabled: boolean;
  port: number;
  path: string;
  prefix: string;
  pushGateway?: {
    enabled: boolean;
    url: string;
    jobName: string;
    pushInterval: number;
  };
}

export interface ICustomMetricsConfig {
  enabled: boolean;
  trading: {
    orders: boolean;
    executions: boolean;
    positions: boolean;
    pnl: boolean;
  };
  api: {
    requestDuration: boolean;
    requestSize: boolean;
    responseSize: boolean;
    requestRate: boolean;
  };
  database: {
    queryDuration: boolean;
    connectionPool: boolean;
    transactionRate: boolean;
  };
}

export interface IBusinessMetricsConfig {
  enabled: boolean;
  revenue: {
    enabled: boolean;
    currency: string;
    updateInterval: number;
  };
  userActivity: {
    enabled: boolean;
    sessionTracking: boolean;
    featureUsage: boolean;
  };
  tradingVolume: {
    enabled: boolean;
    bySymbol: boolean;
    byUser: boolean;
  };
}

export interface ISystemMetricsConfig {
  enabled: boolean;
  process: {
    memory: boolean;
    cpu: boolean;
    eventLoop: boolean;
    gc: boolean;
  };
  nodejs: {
    version: boolean;
    uptime: boolean;
    activeHandles: boolean;
    activeRequests: boolean;
  };
}

// Logging Configuration
export interface ILoggingConfig {
  enabled: boolean;
  level: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';
  format: 'json' | 'pretty' | 'combined';
  structured: {
    enabled: boolean;
    correlationId: boolean;
    requestId: boolean;
    userId: boolean;
    sessionId: boolean;
  };
  outputs: {
    console: IConsoleOutput;
    file: IFileOutput;
    elasticsearch: IElasticsearchOutput;
    loki: ILokiOutput;
  };
  enrichment: ILogEnrichmentConfig;
}

export interface IConsoleOutput {
  enabled: boolean;
  colorize: boolean;
  timestamp: boolean;
}

export interface IFileOutput {
  enabled: boolean;
  path: string;
  filename: string;
  maxSize: string;
  maxFiles: number;
  rotation: boolean;
}

export interface IElasticsearchOutput {
  enabled: boolean;
  node: string;
  index: string;
  auth?: {
    username: string;
    password: string;
  };
  ssl?: {
    rejectUnauthorized: boolean;
    cert?: string;
    key?: string;
    ca?: string;
  };
}

export interface ILokiOutput {
  enabled: boolean;
  host: string;
  labels: Record<string, string>;
  auth?: {
    username: string;
    password: string;
  };
}

export interface ILogEnrichmentConfig {
  timestamp: boolean;
  hostname: boolean;
  processId: boolean;
  memoryUsage: boolean;
  requestInfo: boolean;
  userContext: boolean;
  errorStack: boolean;
}

// Tracing Configuration
export interface ITracingConfig {
  enabled: boolean;
  serviceName: string;
  sampling: {
    probability: number;
    errorSampling: boolean;
    slowRequestSampling: boolean;
    rules: ISamplingRule[];
  };
  exporters: {
    jaeger: IJaegerExporter;
    zipkin: IZipkinExporter;
    otlp: IOTLPExporter;
  };
  instrumentation: IInstrumentationConfig;
}

export interface ISamplingRule {
  service?: string;
  operation?: string;
  probability: number;
  condition?: string;
}

export interface IJaegerExporter {
  enabled: boolean;
  endpoint: string;
  headers?: Record<string, string>;
}

export interface IZipkinExporter {
  enabled: boolean;
  endpoint: string;
  serviceName: string;
}

export interface IOTLPExporter {
  enabled: boolean;
  endpoint: string;
  headers?: Record<string, string>;
  compression?: 'gzip' | 'none';
}

export interface IInstrumentationConfig {
  http: boolean;
  express: boolean;
  nestjs: boolean;
  pg: boolean;
  redis: boolean;
  mongodb: boolean;
  custom: string[];
}

// Health Check Configuration
export interface IHealthConfig {
  enabled: boolean;
  endpoint: string;
  checks: IHealthCheckConfig[];
  kubernetes: IKubernetesHealthConfig;
  dependencies: IDependencyCheckConfig[];
}

export interface IHealthCheckConfig {
  name: string;
  type: 'database' | 'redis' | 'api' | 'custom';
  enabled: boolean;
  timeout: number;
  interval: number;
  retries: number;
  config: Record<string, any>;
}

export interface IKubernetesHealthConfig {
  enabled: boolean;
  livenessProbe: {
    enabled: boolean;
    path: string;
    initialDelaySeconds: number;
    periodSeconds: number;
    timeoutSeconds: number;
    failureThreshold: number;
  };
  readinessProbe: {
    enabled: boolean;
    path: string;
    initialDelaySeconds: number;
    periodSeconds: number;
    timeoutSeconds: number;
    failureThreshold: number;
  };
  startupProbe: {
    enabled: boolean;
    path: string;
    initialDelaySeconds: number;
    periodSeconds: number;
    timeoutSeconds: number;
    failureThreshold: number;
  };
}

export interface IDependencyCheckConfig {
  name: string;
  type: 'http' | 'tcp' | 'database' | 'redis';
  enabled: boolean;
  config: {
    url?: string;
    host?: string;
    port?: number;
    timeout?: number;
    expectedStatus?: number;
    query?: string;
  };
}

// Alerting Configuration
export interface IAlertingConfig {
  enabled: boolean;
  channels: IAlertChannel[];
  rules: IAlertRule[];
  escalation: IEscalationConfig;
}

export interface IAlertChannel {
  name: string;
  type: 'slack' | 'email' | 'pagerduty' | 'webhook' | 'teams';
  enabled: boolean;
  config: Record<string, any>;
}

export interface IAlertRule {
  name: string;
  enabled: boolean;
  condition: string;
  threshold: number;
  duration: number;
  severity: 'info' | 'warning' | 'error' | 'critical';
  channels: string[];
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export interface IEscalationConfig {
  enabled: boolean;
  rules: {
    severity: string;
    timeout: number;
    escalateTo: string[];
  }[];
}

// SLI/SLO Configuration
export interface ISLIConfig {
  enabled: boolean;
  indicators: ISLIIndicator[];
  objectives: ISLOObjective[];
  errorBudget: IErrorBudgetConfig;
}

export interface ISLIIndicator {
  name: string;
  type: 'availability' | 'latency' | 'throughput' | 'errorRate' | 'custom';
  enabled: boolean;
  query: string;
  labels: string[];
  window: string;
}

export interface ISLOObjective {
  name: string;
  sli: string;
  target: number;
  period: string;
  budgetAlertThreshold: number;
}

export interface IErrorBudgetConfig {
  enabled: boolean;
  calculation: 'time' | 'request';
  burnRateAlert: {
    enabled: boolean;
    shortWindow: string;
    longWindow: string;
    threshold: number;
  };
}

// APM Configuration
export interface IAPMConfig {
  enabled: boolean;
  sampling: {
    transactionSampleRate: number;
    errorSampleRate: number;
  };
  performance: {
    slowTransactionThreshold: number;
    enableRealUserMonitoring: boolean;
    enableResourceTiming: boolean;
  };
  profiling: {
    enabled: boolean;
    cpuProfiling: boolean;
    memoryProfiling: boolean;
    profilingInterval: number;
  };
}

// Circuit Breaker Configuration
export interface ICircuitBreakerConfig {
  enabled: boolean;
  default: {
    failureThreshold: number;
    successThreshold: number;
    timeout: number;
    errorThresholdPercentage: number;
    resetTimeout: number;
    monitoringPeriod: number;
  };
  services: Record<string, {
    failureThreshold?: number;
    successThreshold?: number;
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
    monitoringPeriod?: number;
  }>;
}

// Health Check Result
export interface IHealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: Date;
  details: {
    [key: string]: {
      status: 'healthy' | 'unhealthy' | 'degraded';
      responseTime?: number;
      error?: string;
      metadata?: Record<string, any>;
    };
  };
  info: {
    service: IServiceInfo;
    uptime: number;
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
    cpu: {
      usage: number;
    };
  };
}

// Metric Types
export interface IMetric {
  name: string;
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  help: string;
  labels?: string[];
  buckets?: number[];
  percentiles?: number[];
}

export interface IMetricValue {
  metric: string;
  value: number;
  labels?: Record<string, string>;
  timestamp?: Date;
}

// Tracing Types
export interface ITraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  flags: number;
  baggage?: Record<string, string>;
}

export interface ISpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  tags: Record<string, any>;
  logs: ILogEntry[];
  status: {
    code: number;
    message?: string;
  };

  // Methods for span manipulation
  setTag(key: string, value: any): void;
  setStatus(status: { code: number; message?: string }): void;
  addEvent(name: string, attributes?: Record<string, any>): void;
  recordException(error: Error): void;
  end(): void;
}

export interface ILogEntry {
  timestamp: Date;
  fields: Record<string, any>;
}

// Alert Types
export interface IAlert {
  id?: string; // Optional - can be auto-generated
  name: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  status: 'firing' | 'resolved';
  startsAt: Date;
  endsAt?: Date;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  generatorURL?: string; // Optional - can be auto-generated
}

// Error Budget Types
export interface IErrorBudget {
  slo: string;
  period: string;
  target: number;
  budget: number;
  consumed: number;
  remaining: number;
  burnRate: number;
  status: 'healthy' | 'warning' | 'critical';
  alertThreshold: number;
}

// Performance Metrics
export interface IPerformanceMetrics {
  responseTime: {
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  throughput: {
    requestsPerSecond: number;
    requestsPerMinute: number;
  };
  errorRate: {
    percentage: number;
    count: number;
    total: number;
  };
  memory: {
    used: number;
    total: number;
    percentage: number;
    gc: {
      collections: number;
      pauseTime: number;
    };
  };
  cpu: {
    usage: number;
    loadAverage: number[];
  };
}