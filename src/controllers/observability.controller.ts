/**
 * 2025 Observability Controller
 * Central REST API for observability management
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';

import { AlertingService } from '../services/alerting.service';
import { CircuitBreakerService } from '../services/circuit-breaker.service';
import { HealthService } from '../services/health.service';
import { MetricsService } from '../services/metrics.service';
import { ObservabilityService } from '../services/observability.service';
import { SLIService } from '../services/sli.service';
import { TracingService } from '../services/tracing.service';

@ApiTags('Observability')
@Controller('observability')
export class ObservabilityController {
  constructor(
    private readonly observabilityService: ObservabilityService,
    private readonly metricsService: MetricsService,
    private readonly tracingService: TracingService,
    private readonly healthService: HealthService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly alertingService: AlertingService,
    private readonly sliService: SLIService,
  ) {}

  /**
   * Get comprehensive observability status
   */
  @Get('status')
  @ApiOperation({ summary: 'Get comprehensive observability system status' })
  @ApiResponse({ status: 200, description: 'Observability status retrieved successfully' })
  async getObservabilityStatus() {
    const [healthStatus, componentStatus, performanceMetrics] = await Promise.all([
      this.observabilityService.getHealthStatus(),
      this.observabilityService.getComponentStatus(),
      this.observabilityService.getPerformanceMetrics(),
    ]);

    return {
      timestamp: new Date(),
      status: healthStatus.status,
      components: componentStatus,
      health: healthStatus,
      performance: performanceMetrics,
      version: process.env['SERVICE_VERSION'] || '1.0.0',
      uptime: process.uptime(),
    };
  }

  /**
   * Get detailed service information
   */
  @Get('info')
  @ApiOperation({ summary: 'Get detailed service information' })
  @ApiResponse({ status: 200, description: 'Service information retrieved successfully' })
  async getServiceInfo() {
    return {
      service: {
        name: process.env['SERVICE_NAME'] || '-service',
        version: process.env['SERVICE_VERSION'] || '1.0.0',
        environment: process.env['NODE_ENV'] || 'development',
        instanceId: process.env['INSTANCE_ID'] || 'unknown',
      },
      deployment: {
        region: process.env['DEPLOY_REGION'] || 'unknown',
        zone: process.env['DEPLOY_ZONE'] || 'unknown',
        cluster: process.env['CLUSTER_NAME'] || 'unknown',
        namespace: process.env['NAMESPACE'] || 'default',
      },
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        pid: process.pid,
      },
      observability: {
        components: this.observabilityService.getComponentStatus(),
        features: {
          metrics: this.metricsService.getIsEnabled(),
          tracing: this.tracingService.getIsEnabled(),
          health: this.healthService.getIsEnabled(),
          circuitBreaker: this.circuitBreakerService.getIsEnabled(),
          alerting: this.alertingService.isEnabled(),
          sli: this.sliService.isEnabled(),
        },
      },
    };
  }

  /**
   * Trigger manual health check
   */
  @Post('health/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger manual health check' })
  @ApiResponse({ status: 200, description: 'Health check completed successfully' })
  async triggerHealthCheck() {
    const result = await this.observabilityService.triggerHealthCheck();
    return {
      timestamp: new Date(),
      triggered: true,
      result,
    };
  }

  /**
   * Get active alerts
   */
  @Get('alerts')
  @ApiOperation({ summary: 'Get active alerts' })
  @ApiResponse({ status: 200, description: 'Active alerts retrieved successfully' })
  @ApiQuery({ name: 'severity', required: false, description: 'Filter by severity' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  async getActiveAlerts(
    @Query('severity') severity?: string,
    @Query('status') status?: string,
  ) {
    const alerts = await this.observabilityService.getActiveAlerts();

    let filteredAlerts = alerts;

    if (severity) {
      filteredAlerts = filteredAlerts.filter(alert => alert.severity === severity);
    }

    if (status) {
      filteredAlerts = filteredAlerts.filter(alert => alert.status === status);
    }

    return {
      timestamp: new Date(),
      total: alerts.length,
      filtered: filteredAlerts.length,
      alerts: filteredAlerts,
    };
  }

  /**
   * Record custom metric
   */
  @Post('metrics/record')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record custom metric' })
  @ApiResponse({ status: 201, description: 'Metric recorded successfully' })
  @ApiBody({
    description: 'Metric data',
    schema: {
      type: 'object',
      required: ['metric', 'value'],
      properties: {
        metric: { type: 'string', description: 'Metric name' },
        value: { type: 'number', description: 'Metric value' },
        labels: { type: 'object', description: 'Metric labels' },
        timestamp: { type: 'string', format: 'date-time', description: 'Timestamp' },
      },
    },
  })
  async recordMetric(@Body() metricData: any) {
    await this.observabilityService.recordMetric(metricData);
    return {
      timestamp: new Date(),
      recorded: true,
      metric: metricData.metric,
      value: metricData.value,
    };
  }

  /**
   * Get circuit breaker status
   */
  @Get('circuit-breakers')
  @ApiOperation({ summary: 'Get circuit breaker status' })
  @ApiResponse({ status: 200, description: 'Circuit breaker status retrieved successfully' })
  async getCircuitBreakers() {
    const stats = this.circuitBreakerService.getStats() as any[];
    const names = this.circuitBreakerService.getCircuitBreakerNames();

    return {
      timestamp: new Date(),
      enabled: this.circuitBreakerService.isEnabled(),
      total: names.length,
      circuitBreakers: stats,
    };
  }

  /**
   * Get specific circuit breaker status
   */
  @Get('circuit-breakers/:name')
  @ApiOperation({ summary: 'Get specific circuit breaker status' })
  @ApiResponse({ status: 200, description: 'Circuit breaker status retrieved successfully' })
  @ApiParam({ name: 'name', description: 'Circuit breaker name' })
  async getCircuitBreaker(@Param('name') name: string) {
    const stats = this.circuitBreakerService.getStats(name);
    return {
      timestamp: new Date(),
      circuitBreaker: stats,
    };
  }

  /**
   * Reset circuit breaker
   */
  @Put('circuit-breakers/:name/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset circuit breaker' })
  @ApiResponse({ status: 200, description: 'Circuit breaker reset successfully' })
  @ApiParam({ name: 'name', description: 'Circuit breaker name' })
  async resetCircuitBreaker(@Param('name') name: string) {
    this.circuitBreakerService.reset(name);
    return {
      timestamp: new Date(),
      reset: true,
      circuitBreaker: name,
    };
  }

  /**
   * Reset all circuit breakers
   */
  @Put('circuit-breakers/reset-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset all circuit breakers' })
  @ApiResponse({ status: 200, description: 'All circuit breakers reset successfully' })
  async resetAllCircuitBreakers() {
    this.circuitBreakerService.resetAll();
    return {
      timestamp: new Date(),
      resetAll: true,
    };
  }

  /**
   * Get current trace context
   */
  @Get('tracing/context')
  @ApiOperation({ summary: 'Get current trace context' })
  @ApiResponse({ status: 200, description: 'Trace context retrieved successfully' })
  async getTraceContext() {
    const context = this.tracingService.getCurrentTraceContext();
    return {
      timestamp: new Date(),
      enabled: this.tracingService.isEnabled(),
      context,
    };
  }

  /**
   * Add span attributes
   */
  @Post('tracing/attributes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add attributes to current span' })
  @ApiResponse({ status: 200, description: 'Attributes added successfully' })
  @ApiBody({
    description: 'Span attributes',
    schema: {
      type: 'object',
      description: 'Key-value pairs of attributes to add to current span',
    },
  })
  async addSpanAttributes(@Body() attributes: Record<string, any>) {
    this.tracingService.addAttributes(attributes);
    return {
      timestamp: new Date(),
      added: true,
      attributes,
    };
  }

  /**
   * Add span event
   */
  @Post('tracing/events')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add event to current span' })
  @ApiResponse({ status: 200, description: 'Event added successfully' })
  @ApiBody({
    description: 'Span event',
    schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Event name' },
        attributes: { type: 'object', description: 'Event attributes' },
      },
    },
  })
  async addSpanEvent(@Body() eventData: { name: string; attributes?: Record<string, any> }) {
    this.tracingService.addEvent(eventData.name, eventData.attributes);
    return {
      timestamp: new Date(),
      added: true,
      event: eventData.name,
    };
  }

  /**
   * Get configuration
   */
  @Get('config')
  @ApiOperation({ summary: 'Get observability configuration' })
  @ApiResponse({ status: 200, description: 'Configuration retrieved successfully' })
  async getConfiguration() {
    // Note: In production, you might want to sanitize sensitive configuration
    return {
      timestamp: new Date(),
      components: this.observabilityService.getComponentStatus(),
      features: {
        metrics: {
          enabled: this.metricsService.isEnabled(),
          endpoint: '/metrics',
        },
        tracing: {
          enabled: this.tracingService.isEnabled(),
          serviceName: process.env['SERVICE_NAME'] || '-service',
        },
        health: {
          enabled: this.healthService.isEnabled(),
          endpoints: {
            health: '/health',
            liveness: '/health/live',
            readiness: '/health/ready',
            startup: '/health/startup',
          },
        },
        circuitBreaker: {
          enabled: this.circuitBreakerService.isEnabled(),
          circuitBreakers: this.circuitBreakerService.getCircuitBreakerNames(),
        },
        alerting: {
          enabled: this.alertingService.isEnabled(),
        },
        sli: {
          enabled: this.sliService.isEnabled(),
        },
      },
    };
  }

  /**
   * Export configuration for external tools
   */
  @Get('config/export')
  @ApiOperation({ summary: 'Export observability configuration for external tools' })
  @ApiResponse({ status: 200, description: 'Configuration exported successfully' })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'yaml'], description: 'Export format' })
  async exportConfiguration(@Query('format') format: string = 'json') {
    const config = {
      service: {
        name: process.env['SERVICE_NAME'] || '-service',
        version: process.env['SERVICE_VERSION'] || '1.0.0',
        environment: process.env['NODE_ENV'] || 'development',
      },
      observability: {
        metrics: {
          enabled: this.metricsService.isEnabled(),
          prometheus: {
            port: 9464,
            path: '/metrics',
          },
        },
        tracing: {
          enabled: this.tracingService.isEnabled(),
          jaeger: {
            endpoint: process.env['JAEGER_ENDPOINT'] || 'http://localhost:14268/api/traces',
          },
        },
        health: {
          enabled: this.healthService.isEnabled(),
          kubernetes: {
            livenessProbe: '/health/live',
            readinessProbe: '/health/ready',
            startupProbe: '/health/startup',
          },
        },
      },
      timestamp: new Date(),
      exportFormat: format,
    };

    if (format === 'yaml') {
      // In a real implementation, you'd convert to YAML
      // For now, return JSON with a note
      return {
        ...config,
        note: 'YAML export not implemented in this example',
      };
    }

    return config;
  }
}