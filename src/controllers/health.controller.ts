/**
 * 2025 Health Controller
 * Kubernetes-ready health check endpoints
 */

import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { HealthService } from '../services/health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Comprehensive health check
   */
  @Get()
  @ApiOperation({ summary: 'Comprehensive health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  async health() {
    const result = await this.healthService.getHealthStatus();

    // Return appropriate HTTP status based on health
    if (result.status === 'unhealthy') {
      throw new Error('Service is unhealthy');
    }

    return result;
  }

  /**
   * Kubernetes liveness probe
   * Indicates whether the application is running
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe for Kubernetes' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  @ApiResponse({ status: 503, description: 'Service is not alive' })
  async liveness() {
    const result = await this.healthService.livenessProbe();

    if (result.status === 'unhealthy') {
      throw new Error('Service is not alive');
    }

    return {
      status: 'alive',
      timestamp: result.timestamp,
      uptime: process.uptime(),
    };
  }

  /**
   * Kubernetes readiness probe
   * Indicates whether the application is ready to serve traffic
   */
  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Readiness probe for Kubernetes' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service is not ready' })
  async readiness() {
    const result = await this.healthService.readinessProbe();

    if (result.status === 'not-ready') {
      throw new Error('Service is not ready');
    }

    return {
      status: 'ready',
      timestamp: result.timestamp,
      details: result.details,
    };
  }

  /**
   * Kubernetes startup probe
   * Indicates whether the application has finished startup
   */
  @Get('startup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Startup probe for Kubernetes' })
  @ApiResponse({ status: 200, description: 'Service has started' })
  @ApiResponse({ status: 503, description: 'Service is still starting' })
  async startup() {
    const result = await this.healthService.startupProbe();

    if (result.status === 'starting') {
      throw new Error('Service is still starting');
    }

    return {
      status: 'started',
      timestamp: result.timestamp,
      details: result.details,
    };
  }

  /**
   * Quick health check (minimal overhead)
   */
  @Get('ping')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quick ping health check' })
  @ApiResponse({ status: 200, description: 'Service is responding' })
  async ping() {
    return {
      status: 'pong',
      timestamp: new Date(),
      service: process.env['SERVICE_NAME'] || '-service',
      version: process.env['SERVICE_VERSION'] || '1.0.0',
    };
  }

  /**
   * Detailed status for monitoring systems
   */
  @Get('status')
  @ApiOperation({ summary: 'Detailed health status for monitoring' })
  @ApiResponse({ status: 200, description: 'Detailed status retrieved' })
  async status() {
    const healthResult = await this.healthService.getHealthStatus();

    return {
      timestamp: new Date(),
      status: healthResult.status,
      service: healthResult.info.service,
      system: {
        uptime: healthResult.info.uptime,
        memory: healthResult.info.memory,
        cpu: healthResult.info.cpu,
      },
      dependencies: healthResult.details,
      summary: {
        total: Object.keys(healthResult.details).length,
        healthy: Object.values(healthResult.details).filter(
          (detail: any) => detail.status === 'healthy'
        ).length,
        degraded: Object.values(healthResult.details).filter(
          (detail: any) => detail.status === 'degraded'
        ).length,
        unhealthy: Object.values(healthResult.details).filter(
          (detail: any) => detail.status === 'unhealthy'
        ).length,
      },
    };
  }
}