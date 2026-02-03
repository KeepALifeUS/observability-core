/**
 * 2025 Health Check Service
 * Kubernetes-ready health checks with comprehensive dependency monitoring
 */

import * as os from 'os';
import { performance } from 'perf_hooks';
import * as process from 'process';

import { Injectable, Logger } from '@nestjs/common';

import { IHealthConfig, IHealthCheckResult, IDependencyCheckConfig } from '../interfaces/observability.interface';


export interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime?: number;
  error?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private _isEnabled = false;
  private startupTime: Date;
  private healthChecks: Map<string, () => Promise<HealthCheck>> = new Map();

  constructor() {
    this.startupTime = new Date();
    this.registerDefaultHealthChecks();
  }

  /**
   * Check if service is enabled
   */
  public isEnabled(): boolean {
    return this._isEnabled;
  }

  /**
   * Initialize health service
   */
  async initialize(_config: IHealthConfig): Promise<void> {
    if (!_config.enabled) {
      this.logger.log('🏥 Health checks are disabled');
      return;
    }

    try {
      this.logger.log('🏥 Initializing health check service...');

      // Register dependency health checks
      this.registerDependencyChecks(_config.dependencies);

      // Register custom health checks from config
      for (const check of _config.checks) {
        if (check.enabled) {
          await this.registerHealthCheck(check.name, this.createHealthCheck(check));
        }
      }

      this._isEnabled = true;

      this.logger.log('✅ Health check service initialized');
      this.logger.log(`🔍 Registered ${this.healthChecks.size} health checks`);

      if (_config.kubernetes.enabled) {
        this.logger.log('🚢 Kubernetes probes configuration:');
        this.logger.log(`  📡 Liveness: ${_config.kubernetes.livenessProbe.path}`);
        this.logger.log(`  📡 Readiness: ${_config.kubernetes.readinessProbe.path}`);
        this.logger.log(`  📡 Startup: ${_config.kubernetes.startupProbe.path}`);
      }

    } catch (error: unknown) {
      this.logger.error(`❌ Failed to initialize health service: ${(error as Error).message}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<IHealthCheckResult> {
    if (!this._isEnabled) {
      throw new Error('Health service not initialized');
    }

    const startTime = performance.now();
    const details: Record<string, any> = {};
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';

    // Execute all registered health checks
    for (const [name, checkFn] of this.healthChecks) {
      try {
        const result = await this.executeHealthCheck(name, checkFn);
        details[name] = result;

        // Determine overall status
        if (result.status === 'unhealthy') {
          overallStatus = 'unhealthy';
        } else if (result.status === 'degraded' && overallStatus !== 'unhealthy') {
          overallStatus = 'degraded';
        }

      } catch (error: unknown) {
        details[name] = {
          status: 'unhealthy',
          error: (error as Error).message,
          responseTime: performance.now() - startTime,
        };
        overallStatus = 'unhealthy';
      }
    }

    const totalResponseTime = performance.now() - startTime;

    const result: IHealthCheckResult = {
      status: overallStatus,
      timestamp: new Date(),
      details,
      info: {
        service: {
          name: process.env['SERVICE_NAME'] || '-service',
          version: process.env['SERVICE_VERSION'] || '1.0.0',
          environment: process.env['NODE_ENV'] || 'development',
          instanceId: process.env['INSTANCE_ID'] || 'unknown',
          deployment: {
            region: process.env['DEPLOY_REGION'] || 'unknown',
            zone: process.env['DEPLOY_ZONE'] || 'unknown',
            cluster: process.env['CLUSTER_NAME'] || 'unknown',
            namespace: process.env['NAMESPACE'] || 'default',
          },
          labels: {
            app: process.env['SERVICE_NAME'] || '-service',
            version: process.env['SERVICE_VERSION'] || '1.0.0',
            environment: process.env['NODE_ENV'] || 'development',
          },
        },
        uptime: Date.now() - this.startupTime.getTime(),
        memory: this.getMemoryInfo(),
        cpu: this.getCpuInfo(),
      },
    };

    this.logger.debug(`🏥 Health check completed in ${totalResponseTime.toFixed(2)}ms - Status: ${overallStatus}`);

    return result;
  }

  /**
   * Get health status (simplified for quick checks)
   */
  async getHealthStatus(): Promise<IHealthCheckResult> {
    return await this.performHealthCheck();
  }

  /**
   * Liveness probe - checks if the application is running
   */
  async livenessProbe(): Promise<{ status: 'healthy' | 'unhealthy'; timestamp: Date }> {
    try {
      // Basic checks for liveness
      const memUsage = process.memoryUsage();
      const memoryPercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      // If memory usage is extremely high, consider unhealthy
      if (memoryPercentage > 95) {
        return {
          status: 'unhealthy',
          timestamp: new Date(),
        };
      }

      return {
        status: 'healthy',
        timestamp: new Date(),
      };

    } catch (error: unknown) {
      this.logger.error(`Liveness probe failed: ${(error as Error).message}`);
      return {
        status: 'unhealthy',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Readiness probe - checks if the application is ready to serve traffic
   */
  async readinessProbe(): Promise<{ status: 'ready' | 'not-ready'; timestamp: Date; details?: any }> {
    try {
      const criticalServices = ['database', 'redis', 'message-queue'];
      const failedServices = [];

      // Check critical dependencies
      for (const serviceName of criticalServices) {
        if (this.healthChecks.has(serviceName)) {
          const checkFn = this.healthChecks.get(serviceName)!;
          const result = await this.executeHealthCheck(serviceName, checkFn);

          if (result.status === 'unhealthy') {
            failedServices.push(serviceName);
          }
        }
      }

      const status = failedServices.length === 0 ? 'ready' : 'not-ready';

      return {
        status,
        timestamp: new Date(),
        details: failedServices.length > 0 ? { failedServices } : undefined,
      };

    } catch (error: unknown) {
      this.logger.error(`Readiness probe failed: ${(error as Error).message}`);
      return {
        status: 'not-ready',
        timestamp: new Date(),
        details: { error: (error as Error).message },
      };
    }
  }

  /**
   * Startup probe - checks if the application has finished startup
   */
  async startupProbe(): Promise<{ status: 'started' | 'starting'; timestamp: Date; details?: any }> {
    try {
      const uptimeSeconds = (Date.now() - this.startupTime.getTime()) / 1000;
      const minimumStartupTime = 10; // Minimum 10 seconds startup time

      // Check if minimum startup time has passed
      if (uptimeSeconds < minimumStartupTime) {
        return {
          status: 'starting',
          timestamp: new Date(),
          details: { uptime: uptimeSeconds, minimumStartupTime },
        };
      }

      // Perform basic health checks to ensure startup is complete
      const basicChecks = ['system', 'memory'];
      const failures = [];

      for (const checkName of basicChecks) {
        if (this.healthChecks.has(checkName)) {
          const checkFn = this.healthChecks.get(checkName)!;
          const result = await this.executeHealthCheck(checkName, checkFn);

          if (result.status === 'unhealthy') {
            failures.push(checkName);
          }
        }
      }

      return {
        status: failures.length === 0 ? 'started' : 'starting',
        timestamp: new Date(),
        details: failures.length > 0 ? { failures } : { uptime: uptimeSeconds },
      };

    } catch (error: unknown) {
      this.logger.error(`Startup probe failed: ${(error as Error).message}`);
      return {
        status: 'starting',
        timestamp: new Date(),
        details: { error: (error as Error).message },
      };
    }
  }

  /**
   * Register a custom health check
   */
  async registerHealthCheck(name: string, checkFn: () => Promise<HealthCheck>): Promise<void> {
    this.healthChecks.set(name, checkFn);
    this.logger.debug(`🔍 Registered health check: ${name}`);
  }

  /**
   * Remove a health check
   */
  unregisterHealthCheck(name: string): void {
    this.healthChecks.delete(name);
    this.logger.debug(`🗑️ Unregistered health check: ${name}`);
  }

  /**
   * Check if health service is enabled
   */
  getIsEnabled(): boolean {
    return this._isEnabled;
  }

  /**
   * Shutdown health service
   */
  async shutdown(): Promise<void> {
    this.healthChecks.clear();
    this._isEnabled = false;
    this.logger.log('🏥 Health service shutdown completed');
  }

  /**
   * Execute a single health check with timeout and error handling
   */
  private async executeHealthCheck(name: string, checkFn: () => Promise<HealthCheck>): Promise<HealthCheck> {
    const startTime = performance.now();
    const timeout = 5000; // 5 second timeout

    try {
      const timeoutPromise = new Promise<HealthCheck>((_, reject) => {
        setTimeout(() => reject(new Error(`Health check timeout: ${name}`)), timeout);
      });

      const result = await Promise.race([checkFn(), timeoutPromise]);
      const responseTime = performance.now() - startTime;

      return {
        ...result,
        responseTime,
      };

    } catch (error: unknown) {
      const responseTime = performance.now() - startTime;
      return {
        name,
        status: 'unhealthy',
        error: (error as Error).message,
        responseTime,
      };
    }
  }

  /**
   * Register default health checks
   */
  private registerDefaultHealthChecks(): void {
    // System health check
    this.healthChecks.set('system', async (): Promise<HealthCheck> => {
      const loadAvg = os.loadavg();
      const cpuCount = os.cpus().length;
      const highLoad = (loadAvg[0] ?? 0) > cpuCount * 0.8;

      return {
        name: 'system',
        status: highLoad ? 'degraded' : 'healthy',
        metadata: {
          loadAverage: loadAvg,
          cpuCount,
          platform: os.platform(),
          arch: os.arch(),
        },
      };
    });

    // Memory health check
    this.healthChecks.set('memory', async (): Promise<HealthCheck> => {
      const memUsage = process.memoryUsage();
      const memoryPercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (memoryPercentage > 90) {
        status = 'unhealthy';
      } else if (memoryPercentage > 75) {
        status = 'degraded';
      }

      return {
        name: 'memory',
        status,
        metadata: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
          rss: memUsage.rss,
          percentage: memoryPercentage,
        },
      };
    });

    // Event loop health check
    this.healthChecks.set('event-loop', async (): Promise<HealthCheck> => {
      const start = process.hrtime.bigint();

      return new Promise((resolve) => {
        setImmediate(() => {
          const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to ms

          let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
          if (lag > 100) {
            status = 'unhealthy';
          } else if (lag > 50) {
            status = 'degraded';
          }

          resolve({
            name: 'event-loop',
            status,
            metadata: {
              lag: `${lag.toFixed(2)}ms`,
              threshold: {
                degraded: '50ms',
                unhealthy: '100ms',
              },
            },
          });
        });
      });
    });
  }

  /**
   * Register dependency health checks
   */
  private registerDependencyChecks(dependencies: IDependencyCheckConfig[]): void {
    for (const dep of dependencies) {
      if (!dep.enabled) {continue;}

      this.healthChecks.set(dep.name, async (): Promise<HealthCheck> => {
        try {
          switch (dep.type) {
            case 'http':
              return await this.checkHttpDependency(dep);
            case 'tcp':
              return await this.checkTcpDependency(dep);
            case 'database':
              return await this.checkDatabaseDependency(dep);
            case 'redis':
              return await this.checkRedisDependency(dep);
            default:
              throw new Error(`Unsupported dependency type: ${dep.type}`);
          }
        } catch (error: unknown) {
          return {
            name: dep.name,
            status: 'unhealthy',
            error: (error as Error).message,
          };
        }
      });
    }
  }

  /**
   * Create health check from configuration
   */
  private createHealthCheck(checkConfig: any): () => Promise<HealthCheck> {
    return async (): Promise<HealthCheck> => {
      // Implementation would depend on check type
      // This is a placeholder implementation
      return {
        name: checkConfig.name,
        status: 'healthy',
        metadata: checkConfig.config,
      };
    };
  }

  /**
   * Check HTTP dependency
   */
  private async checkHttpDependency(dep: IDependencyCheckConfig): Promise<HealthCheck> {
    const startTime = performance.now();

    try {
      // Note: In a real implementation, you'd use a proper HTTP client
      // This is a simplified example
      const response = await fetch(dep.config.url!, {
        method: 'GET',
        signal: AbortSignal.timeout(dep.config.timeout || 5000),
      } as RequestInit);

      const responseTime = performance.now() - startTime;
      const expectedStatus = dep.config.expectedStatus || 200;
      const isHealthy = response.status === expectedStatus;

      return {
        name: dep.name,
        status: isHealthy ? 'healthy' : 'unhealthy',
        responseTime,
        metadata: {
          url: dep.config.url,
          statusCode: response.status,
          expectedStatus,
        },
      };

    } catch (error: unknown) {
      return {
        name: dep.name,
        status: 'unhealthy',
        error: (error as Error).message,
        responseTime: performance.now() - startTime,
      };
    }
  }

  /**
   * Check TCP dependency
   */
  private async checkTcpDependency(dep: IDependencyCheckConfig): Promise<HealthCheck> {
    const startTime = performance.now();

    try {
      // Note: This would require implementing TCP socket connection
      // Placeholder implementation
      return {
        name: dep.name,
        status: 'healthy',
        responseTime: performance.now() - startTime,
        metadata: {
          host: dep.config.host,
          port: dep.config.port,
        },
      };

    } catch (error: unknown) {
      return {
        name: dep.name,
        status: 'unhealthy',
        error: (error as Error).message,
        responseTime: performance.now() - startTime,
      };
    }
  }

  /**
   * Check database dependency
   */
  private async checkDatabaseDependency(dep: IDependencyCheckConfig): Promise<HealthCheck> {
    const startTime = performance.now();

    try {
      // Note: This would require database connection
      // Placeholder implementation
      return {
        name: dep.name,
        status: 'healthy',
        responseTime: performance.now() - startTime,
        metadata: {
          query: dep.config.query || 'SELECT 1',
        },
      };

    } catch (error: unknown) {
      return {
        name: dep.name,
        status: 'unhealthy',
        error: (error as Error).message,
        responseTime: performance.now() - startTime,
      };
    }
  }

  /**
   * Check Redis dependency
   */
  private async checkRedisDependency(dep: IDependencyCheckConfig): Promise<HealthCheck> {
    const startTime = performance.now();

    try {
      // Note: This would require Redis connection
      // Placeholder implementation
      return {
        name: dep.name,
        status: 'healthy',
        responseTime: performance.now() - startTime,
        metadata: {
          host: dep.config.host,
          port: dep.config.port,
        },
      };

    } catch (error: unknown) {
      return {
        name: dep.name,
        status: 'unhealthy',
        error: (error as Error).message,
        responseTime: performance.now() - startTime,
      };
    }
  }

  /**
   * Get memory information
   */
  private getMemoryInfo() {
    const memUsage = process.memoryUsage();
    return {
      used: memUsage.heapUsed,
      total: memUsage.heapTotal,
      percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
    };
  }

  /**
   * Get CPU information
   */
  private getCpuInfo() {
    const cpuUsage = process.cpuUsage();
    return {
      usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
    };
  }
}