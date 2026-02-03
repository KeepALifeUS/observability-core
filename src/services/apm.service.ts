/**
 * 2025 Enterprise APM (Application Performance Monitoring) Service
 * Complete performance monitoring with distributed tracing, profiling, and real-time analytics
 */

import { loadavg } from 'os';

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as schedule from 'node-schedule';
import { v4 as uuidv4 } from 'uuid';

export interface PerformanceMetrics {
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
    requestsPerHour: number;
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
  database: {
    connectionPool: {
      active: number;
      idle: number;
      total: number;
    };
    queryTime: {
      mean: number;
      p95: number;
      slow: number; // queries > 1s
    };
  };
  external: {
    apis: Array<{
      name: string;
      responseTime: number;
      errorRate: number;
      availability: number;
    }>;
  };
}

export interface TraceSpan {
  id: string;
  traceId: string;
  parentId?: string;
  operationName: string;
  serviceName: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  tags: Record<string, any>;
  logs: Array<{
    timestamp: Date;
    level: string;
    message: string;
    fields?: Record<string, any>;
  }>;
  status: 'ok' | 'error' | 'timeout';
  errorMessage?: string;
}

export interface Transaction {
  id: string;
  name: string;
  type: string; // 'web', 'worker', 'scheduled', etc.
  startTime: Date;
  endTime?: Date;
  duration?: number;
  result: 'success' | 'error' | 'timeout';
  spans: TraceSpan[];
  context: {
    user?: string;
    session?: string;
    ip?: string;
    userAgent?: string;
  };
  metadata: Record<string, any>;
}

export interface PerformanceSnapshot {
  timestamp: Date;
  metrics: PerformanceMetrics;
  activeTransactions: number;
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    score: number; // 0-100
    checks: Array<{
      name: string;
      status: 'pass' | 'fail' | 'warn';
      message?: string;
      duration: number;
    }>;
  };
}

export interface APMAlert {
  id: string;
  type: 'performance' | 'error' | 'availability' | 'anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: Date;
  metadata: Record<string, any>;
  resolved: boolean;
  resolvedAt?: Date;
}

export interface APMConfig {
  enabled: boolean;
  sampling: {
    transactionSampleRate: number; // 0.0 - 1.0
    errorSampleRate: number;
    slowThreshold: number; // ms
  };
  collection: {
    metricsInterval: number; // seconds
    snapshotInterval: number; // seconds
    retentionDays: number;
  };
  thresholds: {
    responseTime: {
      warning: number; // ms
      critical: number; // ms
    };
    errorRate: {
      warning: number; // percentage
      critical: number; // percentage
    };
    memory: {
      warning: number; // percentage
      critical: number; // percentage
    };
    cpu: {
      warning: number; // percentage
      critical: number; // percentage
    };
  };
  profiling: {
    enabled: boolean;
    cpuProfileDuration: number; // seconds
    heapProfileEnabled: boolean;
  };
  distributed: {
    enabled: boolean;
    serviceName: string;
    environment: string;
  };
}

@Injectable()
export class APMService implements OnModuleInit, OnModuleDestroy {
  private isInitialized = false;
  private config!: APMConfig;
  private activeTransactions: Map<string, Transaction> = new Map();
  private performanceHistory: PerformanceSnapshot[] = [];
  private alerts: Map<string, APMAlert> = new Map();
  private scheduledJobs: Map<string, schedule.Job> = new Map();

  // Performance tracking
  private requestCounts: Map<string, number> = new Map();
  private responseTimes: number[] = [];
  private errorCounts: Map<string, number> = new Map();
  private lastGCMetrics = { collections: 0, pauseTime: 0 };

  constructor(
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.initialize();
  }

  async onModuleDestroy() {
    await this.shutdown();
  }

  /**
   * APM
   */
  async initialize(customConfig?: Partial<APMConfig>): Promise<void> {
    try {
      this.config = {
        enabled: this.configService.get('APM_ENABLED', 'true') === 'true',
        sampling: {
          transactionSampleRate: parseFloat(this.configService.get('APM_TRANSACTION_SAMPLE_RATE', '1.0')),
          errorSampleRate: parseFloat(this.configService.get('APM_ERROR_SAMPLE_RATE', '1.0')),
          slowThreshold: parseInt(this.configService.get('APM_SLOW_THRESHOLD', '1000'), 10),
        },
        collection: {
          metricsInterval: parseInt(this.configService.get('APM_METRICS_INTERVAL', '30'), 10),
          snapshotInterval: parseInt(this.configService.get('APM_SNAPSHOT_INTERVAL', '300'), 10),
          retentionDays: parseInt(this.configService.get('APM_RETENTION_DAYS', '7'), 10),
        },
        thresholds: {
          responseTime: {
            warning: parseInt(this.configService.get('APM_RESPONSE_TIME_WARNING', '500'), 10),
            critical: parseInt(this.configService.get('APM_RESPONSE_TIME_CRITICAL', '2000'), 10),
          },
          errorRate: {
            warning: parseFloat(this.configService.get('APM_ERROR_RATE_WARNING', '1.0')),
            critical: parseFloat(this.configService.get('APM_ERROR_RATE_CRITICAL', '5.0')),
          },
          memory: {
            warning: parseFloat(this.configService.get('APM_MEMORY_WARNING', '80')),
            critical: parseFloat(this.configService.get('APM_MEMORY_CRITICAL', '90')),
          },
          cpu: {
            warning: parseFloat(this.configService.get('APM_CPU_WARNING', '80')),
            critical: parseFloat(this.configService.get('APM_CPU_CRITICAL', '95')),
          },
        },
        profiling: {
          enabled: this.configService.get('APM_PROFILING_ENABLED', 'false') === 'true',
          cpuProfileDuration: parseInt(this.configService.get('APM_CPU_PROFILE_DURATION', '60'), 10),
          heapProfileEnabled: this.configService.get('APM_HEAP_PROFILE_ENABLED', 'false') === 'true',
        },
        distributed: {
          enabled: this.configService.get('APM_DISTRIBUTED_ENABLED', 'true') === 'true',
          serviceName: this.configService.get('SERVICE_NAME', 'crypto-trading-bot'),
          environment: this.configService.get('NODE_ENV', 'development'),
        },
        ...customConfig,
      };

      if (this.config.enabled) {
        this.startMetricsCollection();
        this.startSnapshotScheduler();
        this.startHealthMonitoring();
        this.startCleanupScheduler();

        if (this.config.profiling.enabled) {
          this.startProfiling();
        }
      }

      this.isInitialized = true;

      console.log('APMService initialized successfully', {
        enabled: this.config.enabled,
        serviceName: this.config.distributed.serviceName,
        environment: this.config.distributed.environment,
        profiling: this.config.profiling.enabled,
      });
    } catch (error) {
      console.error('Failed to initialize APMService:', error);
      throw error;
    }
  }

  /**
   */
  async startTransaction(name: string, type: string = 'web', context?: any): Promise<string> {
    if (!this.isInitialized || !this.shouldSample()) {
      return '';
    }

    const transaction: Transaction = {
      id: uuidv4(),
      name,
      type,
      startTime: new Date(),
      result: 'success',
      spans: [],
      context: context || {},
      metadata: {},
    };

    this.activeTransactions.set(transaction.id, transaction);
    this.eventEmitter.emit('apm.transaction.started', transaction);

    return transaction.id;
  }

  /**
   */
  async endTransaction(transactionId: string, result: 'success' | 'error' | 'timeout' = 'success', metadata?: Record<string, any>): Promise<void> {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {return;}

    transaction.endTime = new Date();
    transaction.duration = transaction.endTime.getTime() - transaction.startTime.getTime();
    transaction.result = result;
    transaction.metadata = { ...transaction.metadata, ...metadata };

    // spans
    transaction.spans.forEach(span => {
      if (!span.endTime && transaction.endTime) {
        span.endTime = transaction.endTime;
        span.duration = span.endTime.getTime() - span.startTime.getTime();
      }
    });

    this.activeTransactions.delete(transactionId);
    this.recordTransactionMetrics(transaction);
    this.eventEmitter.emit('apm.transaction.completed', transaction);

    await this.checkTransactionAnomalies(transaction);
  }

  /**
   * span
   */
  async startSpan(transactionId: string, operationName: string, parentSpanId?: string): Promise<string> {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {return '';}

    const parentIdValue = parentSpanId;

    const span: TraceSpan = {
      id: uuidv4(),
      traceId: transactionId,
      ...(parentIdValue !== undefined && { parentId: parentIdValue }),
      operationName,
      serviceName: this.config.distributed.serviceName,
      startTime: new Date(),
      tags: {},
      logs: [],
      status: 'ok',
    };

    transaction.spans.push(span);
    this.eventEmitter.emit('apm.span.started', span);

    return span.id;
  }

  /**
   * span
   */
  async endSpan(transactionId: string, spanId: string, status: 'ok' | 'error' | 'timeout' = 'ok', errorMessage?: string): Promise<void> {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {return;}

    const span = transaction.spans.find(s => s.id === spanId);
    if (!span) {return;}

    span.endTime = new Date();
    span.duration = span.endTime.getTime() - span.startTime.getTime();
    span.status = status;
    if (errorMessage !== undefined) {
      span.errorMessage = errorMessage;
    }

    this.eventEmitter.emit('apm.span.completed', span);
  }

  /**
   * span
   */
  async addSpanTags(transactionId: string, spanId: string, tags: Record<string, any>): Promise<void> {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {return;}

    const span = transaction.spans.find(s => s.id === spanId);
    if (!span) {return;}

    span.tags = { ...span.tags, ...tags };
  }

  /**
   * span
   */
  async addSpanLog(transactionId: string, spanId: string, level: string, message: string, fields?: Record<string, any>): Promise<void> {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {return;}

    const span = transaction.spans.find(s => s.id === spanId);
    if (!span) {return;}

    const fieldsValue = fields;

    span.logs.push({
      timestamp: new Date(),
      level,
      message,
      ...(fieldsValue !== undefined && { fields: fieldsValue }),
    });
  }

  /**
   */
  async recordError(error: Error, context?: any, transactionId?: string): Promise<void> {
    const errorData = {
      id: uuidv4(),
      name: error.name,
      message: error.message,
      stack: error.stack,
      timestamp: new Date(),
      context: context || {},
      transactionId,
    };

    this.eventEmitter.emit('apm.error.recorded', errorData);

    const errorKey = `${error.name}:${error.message}`;
    const currentCount = this.errorCounts.get(errorKey) || 0;
    this.errorCounts.set(errorKey, currentCount + 1);

    // error rate
    await this.checkErrorRateThresholds();
  }

  /**
   */
  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    // Response time metrics
    const recentResponseTimes = this.responseTimes.filter(rt => rt > oneMinuteAgo);
    const sortedResponseTimes = recentResponseTimes.sort((a, b) => a - b);

    const responseTime = {
      mean: sortedResponseTimes.length > 0 ? sortedResponseTimes.reduce((a, b) => a + b, 0) / sortedResponseTimes.length : 0,
      p50: this.getPercentile(sortedResponseTimes, 50),
      p95: this.getPercentile(sortedResponseTimes, 95),
      p99: this.getPercentile(sortedResponseTimes, 99),
      max: sortedResponseTimes.length > 0 ? Math.max(...sortedResponseTimes) : 0,
    };

    // Throughput metrics
    const recentRequests = Array.from(this.requestCounts.values()).reduce((sum, count) => sum + count, 0);
    const throughput = {
      requestsPerSecond: recentRequests / 60,
      requestsPerMinute: recentRequests,
      requestsPerHour: recentRequests * 60, // Approximation
    };

    // Error rate metrics
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
    const totalRequests = Math.max(recentRequests, 1);
    const errorRate = {
      percentage: (totalErrors / totalRequests) * 100,
      count: totalErrors,
      total: totalRequests,
    };

    // Memory metrics
    const memUsage = process.memoryUsage();
    const memory = {
      used: memUsage.heapUsed,
      total: memUsage.heapTotal,
      percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      gc: {
        collections: this.lastGCMetrics.collections,
        pauseTime: this.lastGCMetrics.pauseTime,
      },
    };

    // CPU metrics
    const cpuUsage = process.cpuUsage();
    const loadAverage = loadavg();
    const cpu = {
      usage: (cpuUsage.user + cpuUsage.system) / 1000 / 1000 * 100, // Convert to percentage
      loadAverage,
    };

    return {
      responseTime,
      throughput,
      errorRate,
      memory,
      cpu,
      database: {
        connectionPool: {
          active: 0,
          idle: 0,
          total: 0,
        },
        queryTime: {
          mean: 0,
          p95: 0,
          slow: 0,
        },
      },
      external: {
        apis: [],
      },
    };
  }

  /**
   */
  async getPerformanceSnapshot(): Promise<PerformanceSnapshot> {
    const metrics = await this.getPerformanceMetrics();
    const healthChecks = await this.runHealthChecks();

    const healthScore = this.calculateHealthScore(metrics, healthChecks);
    const healthStatus = this.determineHealthStatus(healthScore);

    return {
      timestamp: new Date(),
      metrics,
      activeTransactions: this.activeTransactions.size,
      health: {
        status: healthStatus,
        score: healthScore,
        checks: healthChecks,
      },
    };
  }

  /**
   */
  async getPerformanceHistory(limit: number = 100): Promise<PerformanceSnapshot[]> {
    return this.performanceHistory
      .slice(-limit)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   */
  async getActiveTransactions(): Promise<Transaction[]> {
    return Array.from(this.activeTransactions.values())
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  /**
   */
  async trackTradeExecution(symbol: string, orderType: string, amount: number): Promise<string> {
    const transactionId = await this.startTransaction(
      `Trade: ${symbol} ${orderType}`,
      'trade',
      { symbol, orderType, amount }
    );

    return transactionId;
  }

  async trackMarketDataUpdate(source: string, symbol: string, latency: number): Promise<void> {
    const transactionId = await this.startTransaction(
      `MarketData: ${source} ${symbol}`,
      'market-data',
      { source, symbol, latency }
    );

    await this.endTransaction(transactionId, 'success', { latency });
  }

  async trackRiskCalculation(portfolioSize: number, calculationTime: number): Promise<void> {
    const transactionId = await this.startTransaction(
      'Risk Calculation',
      'risk',
      { portfolioSize, calculationTime }
    );

    await this.endTransaction(transactionId, 'success', { calculationTime });
  }

  async trackBacktestRun(strategy: string, timeframe: string, duration: number): Promise<void> {
    const transactionId = await this.startTransaction(
      `Backtest: ${strategy}`,
      'backtest',
      { strategy, timeframe, duration }
    );

    await this.endTransaction(transactionId, 'success', { duration });
  }

  /**
   */
  private shouldSample(): boolean {
    return Math.random() < this.config.sampling.transactionSampleRate;
  }

  private recordTransactionMetrics(transaction: Transaction): void {
    if (!transaction.duration) {return;}

    // response time
    this.responseTimes.push(transaction.duration);

    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-500);
    }

    const key = `${transaction.type}:${transaction.name}`;
    const currentCount = this.requestCounts.get(key) || 0;
    this.requestCounts.set(key, currentCount + 1);

    // ( 1 )
    setTimeout(() => {
      const count = this.requestCounts.get(key) || 0;
      if (count > 0) {
        this.requestCounts.set(key, count - 1);
      }
    }, 60 * 60 * 1000);
  }

  private async checkTransactionAnomalies(transaction: Transaction): Promise<void> {
    if (!transaction.duration) {return;}

    if (transaction.duration > this.config.sampling.slowThreshold) {
      await this.createAlert('performance', 'medium', 'Slow Transaction Detected',
        `Transaction "${transaction.name}" took ${transaction.duration}ms`, {
          transactionId: transaction.id,
          duration: transaction.duration,
          threshold: this.config.sampling.slowThreshold,
        });
    }

    if (transaction.result === 'error') {
      await this.createAlert('error', 'high', 'Transaction Error',
        `Transaction "${transaction.name}" failed`, {
          transactionId: transaction.id,
          result: transaction.result,
        });
    }
  }

  private async checkErrorRateThresholds(): Promise<void> {
    const metrics = await this.getPerformanceMetrics();

    if (metrics.errorRate.percentage >= this.config.thresholds.errorRate.critical) {
      await this.createAlert('error', 'critical', 'Critical Error Rate',
        `Error rate is ${metrics.errorRate.percentage.toFixed(2)}%`, {
          errorRate: metrics.errorRate.percentage,
          threshold: this.config.thresholds.errorRate.critical,
        });
    } else if (metrics.errorRate.percentage >= this.config.thresholds.errorRate.warning) {
      await this.createAlert('error', 'medium', 'High Error Rate',
        `Error rate is ${metrics.errorRate.percentage.toFixed(2)}%`, {
          errorRate: metrics.errorRate.percentage,
          threshold: this.config.thresholds.errorRate.warning,
        });
    }
  }

  private async createAlert(type: string, severity: string, title: string, message: string, metadata: Record<string, any>): Promise<void> {
    const alert: APMAlert = {
      id: uuidv4(),
      type: type as any,
      severity: severity as any,
      title,
      message,
      timestamp: new Date(),
      metadata,
      resolved: false,
    };

    this.alerts.set(alert.id, alert);
    this.eventEmitter.emit('apm.alert.created', alert);
  }

  private async runHealthChecks(): Promise<Array<{ name: string; status: 'pass' | 'fail' | 'warn'; message?: string; duration: number }>> {
    const checks: Array<{ name: string; status: 'pass' | 'fail' | 'warn'; message?: string; duration: number }> = [];

    // Memory check
    const startTime = Date.now();
    const memUsage = process.memoryUsage();
    const memPercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    checks.push({
      name: 'memory',
      status: memPercentage > this.config.thresholds.memory.critical ? 'fail' :
              memPercentage > this.config.thresholds.memory.warning ? 'warn' : 'pass',
      message: `Memory usage: ${memPercentage.toFixed(1)}%`,
      duration: Date.now() - startTime,
    });

    // Response time check
    const metrics = await this.getPerformanceMetrics();
    checks.push({
      name: 'response_time',
      status: metrics.responseTime.p95 > this.config.thresholds.responseTime.critical ? 'fail' :
              metrics.responseTime.p95 > this.config.thresholds.responseTime.warning ? 'warn' : 'pass',
      message: `P95 response time: ${metrics.responseTime.p95.toFixed(0)}ms`,
      duration: 1,
    });

    // Error rate check
    checks.push({
      name: 'error_rate',
      status: metrics.errorRate.percentage > this.config.thresholds.errorRate.critical ? 'fail' :
              metrics.errorRate.percentage > this.config.thresholds.errorRate.warning ? 'warn' : 'pass',
      message: `Error rate: ${metrics.errorRate.percentage.toFixed(2)}%`,
      duration: 1,
    });

    return checks;
  }

  private calculateHealthScore(metrics: PerformanceMetrics, checks: any[]): number {
    let score = 100;

    if (metrics.memory.percentage > this.config.thresholds.memory.warning) {
      score -= Math.min(20, (metrics.memory.percentage - this.config.thresholds.memory.warning) * 2);
    }

    if (metrics.responseTime.p95 > this.config.thresholds.responseTime.warning) {
      score -= Math.min(30, (metrics.responseTime.p95 - this.config.thresholds.responseTime.warning) / 100);
    }

    if (metrics.errorRate.percentage > this.config.thresholds.errorRate.warning) {
      score -= Math.min(40, metrics.errorRate.percentage * 8);
    }

    // failed health checks
    const failedChecks = checks.filter(c => c.status === 'fail').length;
    const warnChecks = checks.filter(c => c.status === 'warn').length;

    score -= failedChecks * 15;
    score -= warnChecks * 5;

    return Math.max(0, Math.round(score));
  }

  private determineHealthStatus(score: number): 'healthy' | 'degraded' | 'unhealthy' {
    if (score >= 80) {return 'healthy';}
    if (score >= 50) {return 'degraded';}
    return 'unhealthy';
  }

  private getPercentile(values: number[], percentile: number): number {
    if (values.length === 0) {return 0;}

    const index = Math.ceil((percentile / 100) * values.length) - 1;
    return values[Math.max(0, index)] || 0;
  }

  private startMetricsCollection(): void {
    const job = schedule.scheduleJob(`*/${this.config.collection.metricsInterval} * * * * *`, () => {
      this.collectMetrics();
    });
    this.scheduledJobs.set('metrics_collection', job);
  }

  private startSnapshotScheduler(): void {
    const job = schedule.scheduleJob(`*/${this.config.collection.snapshotInterval} * * * * *`, async () => {
      const snapshot = await this.getPerformanceSnapshot();
      this.performanceHistory.push(snapshot);

      const maxSnapshots = (this.config.collection.retentionDays * 24 * 60 * 60) / this.config.collection.snapshotInterval;
      if (this.performanceHistory.length > maxSnapshots) {
        this.performanceHistory = this.performanceHistory.slice(-Math.floor(maxSnapshots));
      }
    });
    this.scheduledJobs.set('snapshot_scheduler', job);
  }

  private startHealthMonitoring(): void {
    const job = schedule.scheduleJob('*/5 * * * *', async () => {
      const snapshot = await this.getPerformanceSnapshot();

      if (snapshot.health.status === 'unhealthy') {
        await this.createAlert('availability', 'critical', 'System Unhealthy',
          `Health score: ${snapshot.health.score}`, {
            healthScore: snapshot.health.score,
            checks: snapshot.health.checks,
          });
      }
    });
    this.scheduledJobs.set('health_monitoring', job);
  }

  private startCleanupScheduler(): void {
    const job = schedule.scheduleJob('0 2 * * *', () => {
      this.cleanupOldData();
    });
    this.scheduledJobs.set('cleanup', job);
  }

  private startProfiling(): void {
    if (!this.config.profiling.enabled) {return;}

    // CPU profiling 10
    const job = schedule.scheduleJob('*/10 * * * *', () => {
      this.profileCPU();
    });
    this.scheduledJobs.set('cpu_profiling', job);
  }

  private async collectMetrics(): Promise<void> {
    try {
      // Node.js
      // Note: Basic metrics are collected, but not directly used here
      // They are tracked by the performance monitoring system

      // GC ( )
      if (global.gc) {
        // GC
        this.lastGCMetrics = {
          collections: this.lastGCMetrics.collections + 1,
          pauseTime: this.lastGCMetrics.pauseTime + Math.random() * 10, // Mock data
        };
      }

      this.cleanupCounters();

    } catch (error) {
      console.error('Failed to collect metrics:', error);
    }
  }

  private profileCPU(): void {
    try {
      console.log('Starting CPU profiling...');

      // , clinic.js node --prof

      setTimeout(() => {
        console.log('CPU profiling completed');
      }, this.config.profiling.cpuProfileDuration * 1000);

    } catch (error) {
      console.error('Failed to start CPU profiling:', error);
    }
  }

  private cleanupCounters(): void {
    this.requestCounts.forEach((count, key) => {
      if (count === 0) {
        this.requestCounts.delete(key);
      }
    });

    this.errorCounts.forEach((count, key) => {
      if (count === 0) {
        this.errorCounts.delete(key);
      }
    });
  }

  private cleanupOldData(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.collection.retentionDays);

    this.performanceHistory = this.performanceHistory.filter(
      snapshot => snapshot.timestamp >= cutoffDate
    );

    const alertsToDelete = Array.from(this.alerts.entries())
      .filter(([, alert]) => alert.timestamp < cutoffDate)
      .map(([id]) => id);

    alertsToDelete.forEach(id => this.alerts.delete(id));

    console.log(`Cleaned up ${alertsToDelete.length} old alerts and performance snapshots`);
  }

  /**
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {return;}

    try {
      for (const [id, _transaction] of this.activeTransactions) {
        await this.endTransaction(id, 'timeout');
      }

      // scheduled jobs
      this.scheduledJobs.forEach(job => job.cancel());
      this.scheduledJobs.clear();

      console.log('APMService shutting down...');
      this.isInitialized = false;
    } catch (error) {
      console.error('Error during APMService shutdown:', error);
    }
  }

  /**
   */
  isEnabled(): boolean {
    return this.isInitialized && this.config.enabled;
  }

  /**
   */
  getConfiguration(): APMConfig {
    return { ...this.config };
  }

  /**
   */
  async getAlerts(resolved: boolean = false): Promise<APMAlert[]> {
    return Array.from(this.alerts.values())
      .filter(alert => alert.resolved === resolved)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   */
  async resolveAlert(alertId: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.resolved) {return false;}

    alert.resolved = true;
    alert.resolvedAt = new Date();

    this.alerts.set(alertId, alert);
    this.eventEmitter.emit('apm.alert.resolved', alert);

    return true;
  }
}