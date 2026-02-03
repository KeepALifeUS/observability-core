/**
 * 2025 Metrics Controller
 * Prometheus metrics exposition endpoint
 */

import { Controller, Get, Header, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { MetricsService } from '../services/metrics.service';

@ApiTags('Metrics')
@Controller('metrics')
export class MetricsController {
  private readonly logger = new Logger(MetricsController.name);

  constructor(private readonly metricsService: MetricsService) {}

  /**
   * Prometheus metrics endpoint
   */
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics exposition endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Metrics in Prometheus format',
    content: {
      'text/plain': {
        schema: {
          type: 'string',
          example: '# HELP _http_requests_total Total number of HTTP requests\n# TYPE _http_requests_total counter\n_http_requests_total{method="GET",route="/health",status_code="200",service="-api-gateway"} 42'
        }
      }
    }
  })
  async metrics() {
    if (!this.metricsService.getIsEnabled()) {
      return '# Metrics collection is disabled\n';
    }

    try {
      return await this.metricsService.getMetrics();
    } catch (error: unknown) {
      this.logger.error(`Failed to get metrics: ${(error as Error).message}`);
      return `# Error getting metrics: ${(error as Error).message}\n`;
    }
  }

  /**
   * Get metrics status
   */
  @Get('status')
  @ApiOperation({ summary: 'Get metrics collection status' })
  @ApiResponse({ status: 200, description: 'Metrics status retrieved successfully' })
  async getStatus() {
    return {
      timestamp: new Date(),
      enabled: this.metricsService.getIsEnabled(),
      endpoint: '/metrics',
      format: 'prometheus',
      service: {
        name: process.env['SERVICE_NAME'] || '-service',
        version: process.env['SERVICE_VERSION'] || '1.0.0',
        environment: process.env['NODE_ENV'] || 'development',
      },
    };
  }
}