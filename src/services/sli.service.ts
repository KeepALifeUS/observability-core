/**
 * 2025 Enterprise SLI (Service Level Indicator) Service
 * Complete SLI/SLO monitoring with advanced metrics collection and analysis
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as schedule from 'node-schedule';
import { v4 as uuidv4 } from 'uuid';

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram',
  SUMMARY = 'summary',
  RATIO = 'ratio',
}

export enum SLIType {
  AVAILABILITY = 'availability',
  LATENCY = 'latency',
  ERROR_RATE = 'error_rate',
  THROUGHPUT = 'throughput',
  GAUGE = 'gauge',
  CUSTOM = 'custom',
}

export interface SLI {
  id: string;
  name: string;
  description: string;
  type: SLIType;
  metricQuery: string;
  targetValue: number;
  unit: string;
  labels: Record<string, string>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SLO {
  id: string;
  name: string;
  description: string;
  sliId: string;
 targetPercentage: number; // , 99.9%
 timeWindow: string; // , '30d', '7d', '1h'
 alertThreshold: number; // target 
  enabled: boolean;
  labels: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MetricPoint {
  timestamp: Date;
  value: number;
  labels: Record<string, string>;
}

export interface SLIMetrics {
  sliId: string;
  currentValue: number;
  targetValue: number;
 compliance: number; // SLO
  trend: 'up' | 'down' | 'stable';
  dataPoints: MetricPoint[];
  lastUpdated: Date;
}

export interface SLOStatus {
  sloId: string;
  sliId: string;
  currentCompliance: number;
  targetCompliance: number;
  isViolated: boolean;
 violationDuration: number; // 
 errorBudgetRemaining: number; // error budget
 errorBudgetBurnRate: number; // error budget
  lastViolation?: Date;
  status: 'healthy' | 'warning' | 'critical';
}

export interface ErrorBudget {
  sloId: string;
  timeWindow: string;
  totalBudget: number;
  usedBudget: number;
  remainingBudget: number;
 burnRate: number; // 
 estimatedTimeToExhaustion?: number; // 
}

export interface SLIConfig {
  enabled: boolean;
 collectionInterval: number; // 
  retentionDays: number;
  aggregationWindows: string[]; // ['1m', '5m', '1h', '1d']
  alerting: {
    enabled: boolean;
 sloViolationThreshold: number; // 
    burnRateThreshold: number;
  };
  storage: {
    type: 'memory' | 'redis' | 'influxdb';
    connectionString?: string;
    database?: string;
  };
}

@Injectable()
export class SLIService implements OnModuleInit, OnModuleDestroy {
  private isInitialized = false;
  private config!: SLIConfig;
  private slis: Map<string, SLI> = new Map();
  private slos: Map<string, SLO> = new Map();
  private metrics: Map<string, SLIMetrics> = new Map();
  private metricPoints: Map<string, MetricPoint[]> = new Map();
  private scheduledJobs: Map<string, schedule.Job> = new Map();

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
   * SLI
   */
  async initialize(customConfig?: Partial<SLIConfig>): Promise<void> {
    try {
      this.config = {
        enabled: this.configService.get('SLI_ENABLED', 'true') === 'true',
        collectionInterval: parseInt(this.configService.get('SLI_COLLECTION_INTERVAL', '60'), 10),
        retentionDays: parseInt(this.configService.get('SLI_RETENTION_DAYS', '90'), 10),
        aggregationWindows: this.configService.get('SLI_AGGREGATION_WINDOWS', '1m,5m,1h,1d').split(','),
        alerting: {
          enabled: this.configService.get('SLI_ALERTING_ENABLED', 'true') === 'true',
          sloViolationThreshold: parseFloat(this.configService.get('SLI_SLO_VIOLATION_THRESHOLD', '0.1')),
          burnRateThreshold: parseFloat(this.configService.get('SLI_BURN_RATE_THRESHOLD', '5.0')),
        },
        storage: (() => {
          const storageConfig: {
            type: 'memory' | 'redis' | 'influxdb';
            connectionString?: string;
            database?: string;
          } = {
            type: this.configService.get('SLI_STORAGE_TYPE', 'memory') as 'memory' | 'redis' | 'influxdb',
          };

          const connectionString = this.configService.get('SLI_STORAGE_CONNECTION');
          if (connectionString) {
            storageConfig.connectionString = connectionString;
          }

          const database = this.configService.get('SLI_STORAGE_DATABASE', 'sli_metrics');
          if (database) {
            storageConfig.database = database;
          }

          return storageConfig;
        })(),
        ...customConfig,
      };

      if (this.config.enabled) {
        await this.loadDefaultSLIs();
        await this.loadDefaultSLOs();
        this.startMetricCollection();
        this.startSLOMonitoring();
        this.startCleanupScheduler();
      }

      this.isInitialized = true;

      console.log('SLIService initialized successfully', {
        enabled: this.config.enabled,
        sliCount: this.slis.size,
        sloCount: this.slos.size,
        collectionInterval: this.config.collectionInterval,
      });
    } catch (error) {
      console.error('Failed to initialize SLIService:', error);
      throw error;
    }
  }

  /**
   * SLI
   */
  async createSLI(sliData: Omit<SLI, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const sli: SLI = {
      ...sliData,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.slis.set(sli.id, sli);
    this.eventEmitter.emit('sli.created', sli);

    // SLI
    this.metrics.set(sli.id, {
      sliId: sli.id,
      currentValue: 0,
      targetValue: sli.targetValue,
      compliance: 100,
      trend: 'stable',
      dataPoints: [],
      lastUpdated: new Date(),
    });

    return sli.id;
  }

  /**
   * SLO
   */
  async createSLO(sloData: Omit<SLO, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const sli = this.slis.get(sloData.sliId);
    if (!sli) {
      throw new Error(`SLI with ID ${sloData.sliId} not found`);
    }

    const slo: SLO = {
      ...sloData,
      id: uuidv4(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.slos.set(slo.id, slo);
    this.eventEmitter.emit('slo.created', slo);

    return slo.id;
  }

  /**
   */
  async recordMetric(sliId: string, value: number, labels: Record<string, string> = {}): Promise<void> {
    const sli = this.slis.get(sliId);
    if (!sli || !sli.enabled) {
      return;
    }

    const point: MetricPoint = {
      timestamp: new Date(),
      value,
      labels: { ...sli.labels, ...labels },
    };

    const points = this.metricPoints.get(sliId) || [];
    points.push(point);

    const maxPoints = this.calculateMaxPoints();
    if (points.length > maxPoints) {
      points.splice(0, points.length - maxPoints);
    }

    this.metricPoints.set(sliId, points);

    // SLI
    await this.updateSLIMetrics(sliId);

    this.eventEmitter.emit('sli.metric.recorded', { sliId, point });
  }

  /**
   * SLI
   */
  async getSLIMetrics(sliId: string, timeRange?: { start: Date; end: Date }): Promise<SLIMetrics | null> {
    const metrics = this.metrics.get(sliId);
    if (!metrics) {return null;}

    if (timeRange) {
      const filteredPoints = metrics.dataPoints.filter(
        point => point.timestamp >= timeRange.start && point.timestamp <= timeRange.end
      );

      return {
        ...metrics,
        dataPoints: filteredPoints,
      };
    }

    return metrics;
  }

  /**
   * SLO
   */
  async getSLOStatus(sloId: string): Promise<SLOStatus | null> {
    const slo = this.slos.get(sloId);
    if (!slo) {return null;}

    const sliMetrics = this.metrics.get(slo.sliId);
    if (!sliMetrics) {return null;}

    const compliance = this.calculateCompliance(slo, sliMetrics);
    const isViolated = compliance < slo.targetPercentage;
    const errorBudget = this.calculateErrorBudget(slo);

    return {
      sloId: slo.id,
      sliId: slo.sliId,
      currentCompliance: compliance,
      targetCompliance: slo.targetPercentage,
      isViolated,
      violationDuration: isViolated ? this.calculateViolationDuration(slo) : 0,
      errorBudgetRemaining: errorBudget.remainingBudget,
      errorBudgetBurnRate: errorBudget.burnRate,
      status: this.determineSLOStatus(compliance, slo.targetPercentage, slo.alertThreshold),
    };
  }

  /**
   * SLI
   */
  async getSLIs(): Promise<SLI[]> {
    return Array.from(this.slis.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * SLO
   */
  async getSLOs(): Promise<SLO[]> {
    return Array.from(this.slos.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * error budget
   */
  async getErrorBudget(sloId: string): Promise<ErrorBudget | null> {
    const slo = this.slos.get(sloId);
    if (!slo) {return null;}

    return this.calculateErrorBudget(slo);
  }

  /**
   */
  async recordTradeLatency(latencyMs: number, symbol: string, orderType: string): Promise<void> {
    const sliId = 'trade-latency';
    await this.recordMetric(sliId, latencyMs, { symbol, orderType, component: 'trading-engine' });
  }

  async recordOrderSuccess(symbol: string, orderType: string): Promise<void> {
    const sliId = 'order-success-rate';
    await this.recordMetric(sliId, 1, { symbol, orderType, component: 'order-management' });
  }

  async recordOrderFailure(symbol: string, orderType: string, errorCode: string): Promise<void> {
    const sliId = 'order-success-rate';
    await this.recordMetric(sliId, 0, { symbol, orderType, errorCode, component: 'order-management' });
  }

  async recordMarketDataDelay(delayMs: number, source: string, symbol: string): Promise<void> {
    const sliId = 'market-data-freshness';
    await this.recordMetric(sliId, delayMs, { source, symbol, component: 'market-data' });
  }

  async recordSystemAvailability(isAvailable: boolean, component: string): Promise<void> {
    const sliId = 'system-availability';
    await this.recordMetric(sliId, isAvailable ? 1 : 0, { component });
  }

  /**
   */
  async getAggregatedMetrics(sliId: string, window: string, aggregationType: 'avg' | 'sum' | 'min' | 'max' | 'count' = 'avg'): Promise<MetricPoint[]> {
    const points = this.metricPoints.get(sliId) || [];
    if (points.length === 0) {return [];}

    const windowMs = this.parseTimeWindow(window);
    const groups = new Map<number, MetricPoint[]>();

    points.forEach(point => {
      const timeKey = Math.floor(point.timestamp.getTime() / windowMs) * windowMs;
      const group = groups.get(timeKey) || [];
      group.push(point);
      groups.set(timeKey, group);
    });

    const aggregated: MetricPoint[] = [];
    groups.forEach((groupPoints, timeKey) => {
      let value: number;

      switch (aggregationType) {
        case 'avg':
          value = groupPoints.reduce((sum, p) => sum + p.value, 0) / groupPoints.length;
          break;
        case 'sum':
          value = groupPoints.reduce((sum, p) => sum + p.value, 0);
          break;
        case 'min':
          value = Math.min(...groupPoints.map(p => p.value));
          break;
        case 'max':
          value = Math.max(...groupPoints.map(p => p.value));
          break;
        case 'count':
          value = groupPoints.length;
          break;
        default:
          value = 0;
          break;
      }

      aggregated.push({
        timestamp: new Date(timeKey),
        value,
        labels: { aggregation: aggregationType, window },
      });
    });

    return aggregated.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /**
   */
  private async updateSLIMetrics(sliId: string): Promise<void> {
    const sli = this.slis.get(sliId);
    const points = this.metricPoints.get(sliId) || [];

    if (!sli || points.length === 0) {return;}

 const recentPoints = points.slice(-100); // 100 
    const lastPoint = recentPoints[recentPoints.length - 1];
    if (!lastPoint) {return;}

    const currentValue = lastPoint.value;

    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (recentPoints.length >= 2) {
      const previousPoint = recentPoints[recentPoints.length - 2];
      if (!previousPoint) {return;}

      const previous = previousPoint.value;
      const change = ((currentValue - previous) / previous) * 100;

      if (change > 5) {trend = 'up';}
      else if (change < -5) {trend = 'down';}
    }

    const compliance = this.calculateSLICompliance(sli, recentPoints);

    const metrics: SLIMetrics = {
      sliId,
      currentValue,
      targetValue: sli.targetValue,
      compliance,
      trend,
      dataPoints: recentPoints,
      lastUpdated: new Date(),
    };

    this.metrics.set(sliId, metrics);
  }

  private calculateSLICompliance(sli: SLI, points: MetricPoint[]): number {
    if (points.length === 0) {return 100;}

    switch (sli.type) {
      case SLIType.AVAILABILITY:
      case SLIType.ERROR_RATE: {
        const successfulPoints = points.filter(p => p.value >= sli.targetValue);
        return (successfulPoints.length / points.length) * 100;
      }

      case SLIType.LATENCY: {
        const withinLatencyTarget = points.filter(p => p.value <= sli.targetValue);
        return (withinLatencyTarget.length / points.length) * 100;
      }

      case SLIType.THROUGHPUT: {
        const avgThroughput = points.reduce((sum, p) => sum + p.value, 0) / points.length;
        return Math.min((avgThroughput / sli.targetValue) * 100, 100);
      }

      default:
        return 100;
    }
  }

  private calculateCompliance(slo: SLO, sliMetrics: SLIMetrics): number {
    const windowMs = this.parseTimeWindow(slo.timeWindow);
    const cutoff = new Date(Date.now() - windowMs);

    const relevantPoints = sliMetrics.dataPoints.filter(p => p.timestamp >= cutoff);

    if (relevantPoints.length === 0) {return 100;}

    const sli = this.slis.get(slo.sliId);
    if (!sli) {return 100;}

    return this.calculateSLICompliance(sli, relevantPoints);
  }

  private calculateErrorBudget(slo: SLO): ErrorBudget {
    const totalBudget = (100 - slo.targetPercentage);
    const sliMetrics = this.metrics.get(slo.sliId);

    if (!sliMetrics) {
      return {
        sloId: slo.id,
        timeWindow: slo.timeWindow,
        totalBudget,
        usedBudget: 0,
        remainingBudget: totalBudget,
        burnRate: 0,
      };
    }

    const currentCompliance = this.calculateCompliance(slo, sliMetrics);
    const usedBudget = Math.max(0, 100 - currentCompliance);
    const remainingBudget = Math.max(0, totalBudget - usedBudget);

    // burn rate
 const recentPoints = sliMetrics.dataPoints.slice(-60); // 
    const burnRate = this.calculateBurnRate(recentPoints, slo);

    const result: ErrorBudget = {
      sloId: slo.id,
      timeWindow: slo.timeWindow,
      totalBudget,
      usedBudget,
      remainingBudget,
      burnRate,
    };

    if (burnRate > 0 && remainingBudget > 0) {
      result.estimatedTimeToExhaustion = remainingBudget / burnRate;
    }

    return result;
  }

  private calculateBurnRate(points: MetricPoint[], slo: SLO): number {
    if (points.length < 2) {return 0;}

    const sli = this.slis.get(slo.sliId);
    if (!sli) {return 0;}

    const failurePoints = points.filter(p => {
      switch (sli.type) {
        case SLIType.AVAILABILITY:
        case SLIType.ERROR_RATE:
          return p.value < sli.targetValue;
        case SLIType.LATENCY:
          return p.value > sli.targetValue;
        default:
          return false;
      }
    });

    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    if (!firstPoint || !lastPoint) {return 0;}

    const timeSpanHours = (lastPoint.timestamp.getTime() - firstPoint.timestamp.getTime()) / (1000 * 60 * 60);

    if (timeSpanHours === 0) {return 0;}

    const failureRate = failurePoints.length / points.length;
 return (failureRate * 100) / timeSpanHours; // 
  }

  private calculateViolationDuration(slo: SLO): number {
    const sliMetrics = this.metrics.get(slo.sliId);
    if (!sliMetrics) {return 0;}

    const currentCompliance = this.calculateCompliance(slo, sliMetrics);
    if (currentCompliance >= slo.targetPercentage) {return 0;}

    // ( - 24 )
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentPoints = sliMetrics.dataPoints.filter(p => p.timestamp >= dayAgo);

    for (let i = 0; i < recentPoints.length; i++) {
      const point = recentPoints[i];
      if (!point) {continue;}

      const sli = this.slis.get(slo.sliId);
      if (!sli) {continue;}

      const pointCompliance = this.calculateSLICompliance(sli, [point]);

      if (pointCompliance < slo.targetPercentage) {
 return (Date.now() - point.timestamp.getTime()) / (1000 * 60); // 
      }
    }

    return 0;
  }

  private determineSLOStatus(compliance: number, target: number, alertThreshold: number): 'healthy' | 'warning' | 'critical' {
    if (compliance >= target) {return 'healthy';}
    if (compliance >= target - alertThreshold) {return 'warning';}
    return 'critical';
  }

  private parseTimeWindow(window: string): number {
    const match = window.match(/^(\d+)([smhd])$/);
    if (!match || !match[1] || !match[2]) {return 60 * 60 * 1000;} // Default 1 hour

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's': return value * 1000;
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60 * 60 * 1000;
    }
  }

  private calculateMaxPoints(): number {
    const pointsPerHour = 3600 / this.config.collectionInterval;
 return pointsPerHour * 24; // 24 
  }

  private startMetricCollection(): void {
    const job = schedule.scheduleJob(`*/${this.config.collectionInterval} * * * * *`, () => {
      this.collectSystemMetrics();
    });
    this.scheduledJobs.set('metric_collection', job);
  }

  private startSLOMonitoring(): void {
    // SLO 5
    const job = schedule.scheduleJob('*/5 * * * *', () => {
      this.monitorSLOs();
    });
    this.scheduledJobs.set('slo_monitoring', job);
  }

  private startCleanupScheduler(): void {
    // 03:00
    const job = schedule.scheduleJob('0 3 * * *', () => {
      this.cleanupOldMetrics();
    });
    this.scheduledJobs.set('cleanup', job);
  }

  private async collectSystemMetrics(): Promise<void> {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      await this.recordSystemAvailability(true, 'sli-service');

      const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      await this.recordMetric('memory-usage', memoryUsagePercent, { component: 'system' });

      void cpuUsage;

    } catch (error) {
      console.error('Failed to collect system metrics:', error);
    }
  }

  private async monitorSLOs(): Promise<void> {
    for (const slo of this.slos.values()) {
      if (!slo.enabled) {continue;}

      try {
        const status = await this.getSLOStatus(slo.id);
        if (!status) {continue;}

        // SLO
        if (status.isViolated && this.config.alerting.enabled) {
          this.eventEmitter.emit('slo.violation', {
            slo,
            status,
            timestamp: new Date(),
          });
        }

        // error budget
        if (status.errorBudgetBurnRate > this.config.alerting.burnRateThreshold) {
          this.eventEmitter.emit('slo.high_burn_rate', {
            slo,
            status,
            burnRate: status.errorBudgetBurnRate,
            timestamp: new Date(),
          });
        }
      } catch (error) {
        console.error(`Failed to monitor SLO ${slo.id}:`, error);
      }
    }
  }

  private cleanupOldMetrics(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    let totalCleaned = 0;

    this.metricPoints.forEach((points, sliId) => {
      const filtered = points.filter(point => point.timestamp >= cutoffDate);
      const cleaned = points.length - filtered.length;

      if (cleaned > 0) {
        this.metricPoints.set(sliId, filtered);
        totalCleaned += cleaned;
      }
    });

    if (totalCleaned > 0) {
      console.log(`Cleaned up ${totalCleaned} old metric points`);
    }
  }

  private async loadDefaultSLIs(): Promise<void> {
    const defaultSLIs: Omit<SLI, 'id' | 'createdAt' | 'updatedAt'>[] = [
      {
        name: 'Trade Execution Latency',
        description: 'Time to execute a trade order',
        type: SLIType.LATENCY,
        metricQuery: 'avg(trade_execution_duration_ms)',
        targetValue: 100, // 100ms
        unit: 'milliseconds',
        labels: { component: 'trading-engine' },
        enabled: true,
      },
      {
        name: 'Order Success Rate',
        description: 'Percentage of successful orders',
        type: SLIType.ERROR_RATE,
        metricQuery: 'sum(rate(orders_total{status="success"})) / sum(rate(orders_total))',
        targetValue: 99.9, // 99.9%
        unit: 'percentage',
        labels: { component: 'order-management' },
        enabled: true,
      },
      {
        name: 'System Availability',
        description: 'Service uptime percentage',
        type: SLIType.AVAILABILITY,
        metricQuery: 'up',
        targetValue: 1, // 100%
        unit: 'percentage',
        labels: { component: 'system' },
        enabled: true,
      },
      {
        name: 'Market Data Freshness',
        description: 'Age of latest market data',
        type: SLIType.LATENCY,
        metricQuery: 'time() - market_data_timestamp',
        targetValue: 1000, // 1 second
        unit: 'milliseconds',
        labels: { component: 'market-data' },
        enabled: true,
      },
      {
        name: 'Memory Usage',
        description: 'System memory utilization',
        type: SLIType.GAUGE,
        metricQuery: 'memory_usage_percent',
        targetValue: 80, // 80%
        unit: 'percentage',
        labels: { component: 'system' },
        enabled: true,
      },
    ];

    for (const sliData of defaultSLIs) {
      await this.createSLI(sliData);
    }
  }

  private async loadDefaultSLOs(): Promise<void> {
    const slis = await this.getSLIs();

    const defaultSLOs: Array<Omit<SLO, 'id' | 'createdAt' | 'updatedAt'>> = [
      {
        name: 'Trade Latency SLO',
        description: '95% of trades executed within 100ms',
        sliId: slis.find(s => s.name === 'Trade Execution Latency')?.id || '',
        targetPercentage: 95,
        timeWindow: '1h',
        alertThreshold: 2, // Alert if below 93%
        enabled: true,
        labels: { service: 'trading' },
      },
      {
        name: 'Order Success SLO',
        description: '99.9% order success rate',
        sliId: slis.find(s => s.name === 'Order Success Rate')?.id || '',
        targetPercentage: 99.9,
        timeWindow: '24h',
        alertThreshold: 0.1, // Alert if below 99.8%
        enabled: true,
        labels: { service: 'orders' },
      },
      {
        name: 'System Uptime SLO',
        description: '99.95% system availability',
        sliId: slis.find(s => s.name === 'System Availability')?.id || '',
        targetPercentage: 99.95,
        timeWindow: '30d',
        alertThreshold: 0.05, // Alert if below 99.9%
        enabled: true,
        labels: { service: 'system' },
      },
    ];

    for (const sloData of defaultSLOs) {
      if (sloData.sliId) {
        await this.createSLO(sloData);
      }
    }
  }

  /**
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {return;}

    try {
      // scheduled jobs
      this.scheduledJobs.forEach(job => job.cancel());
      this.scheduledJobs.clear();

      console.log('SLIService shutting down...');
      this.isInitialized = false;
    } catch (error) {
      console.error('Error during SLIService shutdown:', error);
    }
  }

  /**
   */
  isEnabled(): boolean {
    return this.isInitialized && this.config.enabled;
  }

  /**
   */
  getConfiguration(): SLIConfig {
    return { ...this.config };
  }
}