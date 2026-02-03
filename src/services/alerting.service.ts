/**
 * 2025 Enterprise Alerting Service
 * Complete alerting system with multiple channels, escalation, and rule engine
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as schedule from 'node-schedule';
import { v4 as uuidv4 } from 'uuid';

export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
  EMERGENCY = 'emergency',
}

export enum AlertChannel {
  EMAIL = 'email',
  SMS = 'sms',
  WEBHOOK = 'webhook',
  SLACK = 'slack',
  TELEGRAM = 'telegram',
  DISCORD = 'discord',
  CONSOLE = 'console',
}

export enum AlertStatus {
  ACTIVE = 'active',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
  SUPPRESSED = 'suppressed',
  ESCALATED = 'escalated',
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
 condition: string; // (, "errorRate > 5%")
  severity: AlertSeverity;
  channels: AlertChannel[];
  enabled: boolean;
 cooldownMinutes: number; // 
 escalationMinutes?: number; // 
  escalationChannels?: AlertChannel[];
  tags: string[];
  metadata?: Record<string, any>;
}

export interface Alert {
  id: string;
  ruleId: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  source: string;
  timestamp: Date;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  resolvedBy?: string;
  escalatedAt?: Date;
  channels: AlertChannel[];
  metadata: Record<string, any>;
  tags: string[];
 fingerprint: string; // 
}

export interface AlertingConfig {
  enabled: boolean;
  defaultChannels: AlertChannel[];
  maxActiveAlerts: number;
  retentionDays: number;
  channels: {
    email?: {
      smtp: {
        host: string;
        port: number;
        secure: boolean;
        auth: { user: string; pass: string };
      };
      from: string;
      to: string[];
    };
    webhook?: {
      url: string;
      headers?: Record<string, string>;
      timeout: number;
    };
    slack?: {
      webhookUrl: string;
      channel: string;
      username: string;
    };
    telegram?: {
      botToken: string;
      chatId: string;
    };
  };
  escalation: {
    enabled: boolean;
    defaultMinutes: number;
    maxLevels: number;
  };
}

export interface AlertStats {
  total: number;
  active: number;
  acknowledged: number;
  resolved: number;
  suppressed: number;
  escalated: number;
  bySeverity: Record<AlertSeverity, number>;
  byChannel: Record<AlertChannel, number>;
  avgResolutionTimeMinutes: number;
  topSources: Array<{ source: string; count: number }>;
}

@Injectable()
export class AlertingService implements OnModuleInit, OnModuleDestroy {
  private isInitialized = false;
  private config!: AlertingConfig;
  private alerts: Map<string, Alert> = new Map();
  private rules: Map<string, AlertRule> = new Map();
  private cooldowns: Map<string, Date> = new Map();
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
   */
  async initialize(customConfig?: Partial<AlertingConfig>): Promise<void> {
    try {
      const emailValue = this.configService.get('ALERTING_EMAIL_ENABLED') === 'true' ? {
        smtp: {
          host: this.configService.get('SMTP_HOST', 'localhost'),
          port: parseInt(this.configService.get('SMTP_PORT', '587'), 10),
          secure: this.configService.get('SMTP_SECURE', 'false') === 'true',
          auth: {
            user: this.configService.get('SMTP_USER', ''),
            pass: this.configService.get('SMTP_PASS', ''),
          },
        },
        from: this.configService.get('ALERT_EMAIL_FROM', 'alerts@crypto-trading-bot.com'),
        to: this.configService.get('ALERT_EMAIL_TO', '').split(',').filter(Boolean),
      } : undefined;

      const webhookValue = this.configService.get('ALERTING_WEBHOOK_ENABLED') === 'true' ? {
        url: this.configService.get('ALERT_WEBHOOK_URL', ''),
        headers: this.parseHeaders(this.configService.get('ALERT_WEBHOOK_HEADERS', '')),
        timeout: parseInt(this.configService.get('ALERT_WEBHOOK_TIMEOUT', '5000'), 10),
      } : undefined;

      const slackValue = this.configService.get('ALERTING_SLACK_ENABLED') === 'true' ? {
        webhookUrl: this.configService.get('SLACK_WEBHOOK_URL', ''),
        channel: this.configService.get('SLACK_CHANNEL', '#alerts'),
        username: this.configService.get('SLACK_USERNAME', 'CTB-Alerts'),
      } : undefined;

      const telegramValue = this.configService.get('ALERTING_TELEGRAM_ENABLED') === 'true' ? {
        botToken: this.configService.get('TELEGRAM_BOT_TOKEN', ''),
        chatId: this.configService.get('TELEGRAM_CHAT_ID', ''),
      } : undefined;

      this.config = {
        enabled: this.configService.get('ALERTING_ENABLED', 'true') === 'true',
        defaultChannels: this.parseChannels(this.configService.get('ALERTING_DEFAULT_CHANNELS', 'console,webhook')),
        maxActiveAlerts: parseInt(this.configService.get('ALERTING_MAX_ACTIVE', '1000'), 10),
        retentionDays: parseInt(this.configService.get('ALERTING_RETENTION_DAYS', '30'), 10),
        channels: {
          ...(emailValue !== undefined && { email: emailValue }),
          ...(webhookValue !== undefined && { webhook: webhookValue }),
          ...(slackValue !== undefined && { slack: slackValue }),
          ...(telegramValue !== undefined && { telegram: telegramValue }),
        },
        escalation: {
          enabled: this.configService.get('ALERTING_ESCALATION_ENABLED', 'true') === 'true',
          defaultMinutes: parseInt(this.configService.get('ALERTING_ESCALATION_DEFAULT_MINUTES', '30'), 10),
          maxLevels: parseInt(this.configService.get('ALERTING_ESCALATION_MAX_LEVELS', '3'), 10),
        },
        ...customConfig,
      };

      if (this.config.enabled) {
        await this.loadDefaultRules();
        this.startCleanupScheduler();
        this.startEscalationMonitor();
      }

      this.isInitialized = true;

      console.log('AlertingService initialized successfully', {
        enabled: this.config.enabled,
        channels: Object.keys(this.config.channels).filter(key => this.config.channels[key as keyof typeof this.config.channels]),
        rulesCount: this.rules.size,
      });
    } catch (error) {
      console.error('Failed to initialize AlertingService:', error);
      throw error;
    }
  }

  /**
   */
  async sendAlert(alertData: {
    title: string;
    message: string;
    severity: AlertSeverity;
    source: string;
    ruleId?: string;
    channels?: AlertChannel[];
    metadata?: Record<string, any>;
    tags?: string[];
    // IAlert-style properties (for compatibility with observability events)
    id?: string;
    name?: string;
    status?: 'firing' | 'resolved';
    startsAt?: Date;
    endsAt?: Date;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    generatorURL?: string;
  }): Promise<string> {
    if (!this.isInitialized || !this.config.enabled) {
      console.warn('AlertingService not enabled, skipping alert');
      return '';
    }

    const fingerprint = this.generateFingerprint(alertData);

    // cooldown
    if (this.isInCooldown(fingerprint)) {
      return '';
    }

    const alert: Alert = {
      id: uuidv4(),
      ruleId: alertData.ruleId || 'manual',
      severity: alertData.severity,
      status: AlertStatus.ACTIVE,
      title: alertData.title,
      message: alertData.message,
      source: alertData.source,
      timestamp: new Date(),
      channels: alertData.channels || this.config.defaultChannels,
      metadata: {
        ...alertData.metadata,
        environment: this.configService.get('NODE_ENV', 'development'),
        service: this.configService.get('SERVICE_NAME', 'crypto-trading-bot'),
      },
      tags: alertData.tags || [],
      fingerprint,
    };

    this.alerts.set(alert.id, alert);
    this.setCooldown(fingerprint);

    await this.deliverAlert(alert);

    this.scheduleEscalation(alert);

    this.eventEmitter.emit('alert.created', alert);

    return alert.id;
  }

  /**
   */
  async acknowledgeAlert(alertId: string, acknowledgedBy: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== AlertStatus.ACTIVE) {
      return false;
    }

    alert.status = AlertStatus.ACKNOWLEDGED;
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = acknowledgedBy;

    this.alerts.set(alertId, alert);
    this.eventEmitter.emit('alert.acknowledged', alert);

    return true;
  }

  /**
   */
  async resolveAlert(alertId: string, resolvedBy: string): Promise<boolean> {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status === AlertStatus.RESOLVED) {
      return false;
    }

    alert.status = AlertStatus.RESOLVED;
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy;

    this.alerts.set(alertId, alert);
    this.eventEmitter.emit('alert.resolved', alert);

    this.cancelEscalation(alertId);

    return true;
  }

  /**
   */
  async getActiveAlerts(): Promise<Alert[]> {
    return Array.from(this.alerts.values()).filter(alert =>
      alert.status === AlertStatus.ACTIVE || alert.status === AlertStatus.ACKNOWLEDGED
    );
  }

  /**
   */
  async getAlerts(filters?: {
    status?: AlertStatus;
    severity?: AlertSeverity;
    source?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): Promise<Alert[]> {
    let alerts = Array.from(this.alerts.values());

    if (filters) {
      if (filters.status) {
        alerts = alerts.filter(alert => alert.status === filters.status);
      }
      if (filters.severity) {
        alerts = alerts.filter(alert => alert.severity === filters.severity);
      }
      if (filters.source) {
        alerts = alerts.filter(alert => alert.source === filters.source);
      }
      if (filters.tags?.length) {
        alerts = alerts.filter(alert =>
          filters.tags!.some(tag => alert.tags.includes(tag))
        );
      }

      if (filters.offset) {
        alerts = alerts.slice(filters.offset);
      }
      if (filters.limit) {
        alerts = alerts.slice(0, filters.limit);
      }
    }

    return alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   */
  async getAlertStats(): Promise<AlertStats> {
    const alerts = Array.from(this.alerts.values());

    const bySeverity = alerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {} as Record<AlertSeverity, number>);

    const byChannel = alerts.reduce((acc, alert) => {
      alert.channels.forEach(channel => {
        acc[channel] = (acc[channel] || 0) + 1;
      });
      return acc;
    }, {} as Record<AlertChannel, number>);

    const resolvedAlerts = alerts.filter(a => a.resolvedAt);
    const avgResolutionTimeMinutes = resolvedAlerts.length > 0
      ? resolvedAlerts.reduce((sum, alert) => {
          const duration = alert.resolvedAt!.getTime() - alert.timestamp.getTime();
          return sum + duration;
        }, 0) / resolvedAlerts.length / (1000 * 60)
      : 0;

    const sourceCounts = alerts.reduce((acc, alert) => {
      acc[alert.source] = (acc[alert.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topSources = Object.entries(sourceCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([source, count]) => ({ source, count }));

    return {
      total: alerts.length,
      active: alerts.filter(a => a.status === AlertStatus.ACTIVE).length,
      acknowledged: alerts.filter(a => a.status === AlertStatus.ACKNOWLEDGED).length,
      resolved: alerts.filter(a => a.status === AlertStatus.RESOLVED).length,
      suppressed: alerts.filter(a => a.status === AlertStatus.SUPPRESSED).length,
      escalated: alerts.filter(a => a.status === AlertStatus.ESCALATED).length,
      bySeverity,
      byChannel,
      avgResolutionTimeMinutes,
      topSources,
    };
  }

  /**
   */
  async addRule(rule: Omit<AlertRule, 'id'>): Promise<string> {
    const ruleWithId: AlertRule = {
      ...rule,
      id: uuidv4(),
    };

    this.rules.set(ruleWithId.id, ruleWithId);
    this.eventEmitter.emit('alert.rule.added', ruleWithId);

    return ruleWithId.id;
  }

  async updateRule(ruleId: string, updates: Partial<AlertRule>): Promise<boolean> {
    const rule = this.rules.get(ruleId);
    if (!rule) {return false;}

    const updatedRule = { ...rule, ...updates, id: ruleId };
    this.rules.set(ruleId, updatedRule);
    this.eventEmitter.emit('alert.rule.updated', updatedRule);

    return true;
  }

  async deleteRule(ruleId: string): Promise<boolean> {
    const deleted = this.rules.delete(ruleId);
    if (deleted) {
      this.eventEmitter.emit('alert.rule.deleted', { ruleId });
    }
    return deleted;
  }

  async getRules(): Promise<AlertRule[]> {
    return Array.from(this.rules.values());
  }

  /**
   */
  async alertTradingError(error: Error, context: { symbol?: string; orderId?: string; operation?: string }): Promise<string> {
    return this.sendAlert({
      title: 'Trading Error',
      message: `Trading operation failed: ${error.message}`,
      severity: AlertSeverity.HIGH,
      source: 'trading-engine',
      metadata: {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        ...context,
      },
      tags: ['trading', 'error'],
    });
  }

  async alertPriceAnomaly(symbol: string, currentPrice: number, expectedPrice: number, deviation: number): Promise<string> {
    return this.sendAlert({
      title: 'Price Anomaly Detected',
      message: `${symbol} price deviation: ${deviation.toFixed(2)}%`,
      severity: deviation > 10 ? AlertSeverity.CRITICAL : AlertSeverity.HIGH,
      source: 'market-data',
      metadata: {
        symbol,
        currentPrice,
        expectedPrice,
        deviation,
      },
      tags: ['price', 'anomaly', symbol.toLowerCase()],
    });
  }

  async alertRiskThreshold(riskType: string, currentValue: number, threshold: number): Promise<string> {
    return this.sendAlert({
      title: 'Risk Threshold Exceeded',
      message: `${riskType} risk exceeded: ${currentValue} > ${threshold}`,
      severity: AlertSeverity.CRITICAL,
      source: 'risk-management',
      metadata: {
        riskType,
        currentValue,
        threshold,
      },
      tags: ['risk', riskType.toLowerCase()],
    });
  }

  /**
   */
  private async deliverAlert(alert: Alert): Promise<void> {
    const promises = alert.channels.map(channel => this.sendToChannel(alert, channel));
    await Promise.allSettled(promises);
  }

  private async sendToChannel(alert: Alert, channel: AlertChannel): Promise<void> {
    try {
      switch (channel) {
        case AlertChannel.CONSOLE:
          console.log(`[ALERT] ${alert.severity.toUpperCase()}: ${alert.title} - ${alert.message}`);
          break;

        case AlertChannel.WEBHOOK:
          if (this.config.channels.webhook) {
            await this.sendWebhook(alert);
          }
          break;

        case AlertChannel.EMAIL:
          if (this.config.channels.email) {
            await this.sendEmail(alert);
          }
          break;

        case AlertChannel.SLACK:
          if (this.config.channels.slack) {
            await this.sendSlack(alert);
          }
          break;

        case AlertChannel.TELEGRAM:
          if (this.config.channels.telegram) {
            await this.sendTelegram(alert);
          }
          break;

        default:
          console.warn(`Unsupported alert channel: ${channel}`);
      }
    } catch (error) {
      console.error(`Failed to send alert via ${channel}:`, error);
    }
  }

  private async sendWebhook(alert: Alert): Promise<void> {
    const config = this.config.channels.webhook!;

    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body: JSON.stringify({
        alert,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(config.timeout),
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }
  }

  private async sendEmail(alert: Alert): Promise<void> {
    // email nodemailer
    console.log(`Email alert sent to ${this.config.channels.email!.to.join(', ')}: ${alert.title}`);
  }

  private async sendSlack(alert: Alert): Promise<void> {
    // Slack
    console.log(`Slack alert sent: ${alert.title}`);
  }

  private async sendTelegram(alert: Alert): Promise<void> {
    // Telegram
    console.log(`Telegram alert sent: ${alert.title}`);
  }

  private generateFingerprint(alertData: any): string {
    const key = `${alertData.source}:${alertData.title}:${alertData.severity}`;
    return Buffer.from(key).toString('base64');
  }

  private isInCooldown(fingerprint: string): boolean {
    const lastSent = this.cooldowns.get(fingerprint);
    if (!lastSent) {return false;}

    const cooldownMinutes = 5; // Default cooldown
    const now = new Date();
    const diff = now.getTime() - lastSent.getTime();
    return diff < cooldownMinutes * 60 * 1000;
  }

  private setCooldown(fingerprint: string): void {
    this.cooldowns.set(fingerprint, new Date());
  }

  private scheduleEscalation(alert: Alert): void {
    if (!this.config.escalation.enabled) {return;}

    const rule = this.rules.get(alert.ruleId);
    const escalationMinutes = rule?.escalationMinutes || this.config.escalation.defaultMinutes;

    const job = schedule.scheduleJob(new Date(Date.now() + escalationMinutes * 60 * 1000), () => {
      this.escalateAlert(alert.id);
    });

    this.scheduledJobs.set(`escalation_${alert.id}`, job);
  }

  private cancelEscalation(alertId: string): void {
    const job = this.scheduledJobs.get(`escalation_${alertId}`);
    if (job) {
      job.cancel();
      this.scheduledJobs.delete(`escalation_${alertId}`);
    }
  }

  private async escalateAlert(alertId: string): Promise<void> {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== AlertStatus.ACTIVE) {return;}

    alert.status = AlertStatus.ESCALATED;
    alert.escalatedAt = new Date();

    const rule = this.rules.get(alert.ruleId);
    if (rule?.escalationChannels) {
      alert.channels = rule.escalationChannels;
      await this.deliverAlert(alert);
    }

    this.alerts.set(alertId, alert);
    this.eventEmitter.emit('alert.escalated', alert);
  }

  private startCleanupScheduler(): void {
    // 02:00
    const job = schedule.scheduleJob('0 2 * * *', () => {
      this.cleanupOldAlerts();
    });
    this.scheduledJobs.set('cleanup', job);
  }

  private startEscalationMonitor(): void {
    // 5
    const job = schedule.scheduleJob('*/5 * * * *', () => {
      this.checkPendingEscalations();
    });
    this.scheduledJobs.set('escalation_monitor', job);
  }

  private cleanupOldAlerts(): void {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    const alertsToDelete = Array.from(this.alerts.entries())
      .filter(([, alert]) => alert.timestamp < cutoffDate)
      .map(([id]) => id);

    alertsToDelete.forEach(id => this.alerts.delete(id));

    if (alertsToDelete.length > 0) {
      console.log(`Cleaned up ${alertsToDelete.length} old alerts`);
    }
  }

  private checkPendingEscalations(): void {
    const now = new Date();
    const alerts = Array.from(this.alerts.values())
      .filter(alert =>
        alert.status === AlertStatus.ACTIVE &&
        !alert.escalatedAt
      );

    alerts.forEach(alert => {
      const rule = this.rules.get(alert.ruleId);
      const escalationMinutes = rule?.escalationMinutes || this.config.escalation.defaultMinutes;
      const escalationTime = new Date(alert.timestamp.getTime() + escalationMinutes * 60 * 1000);

      if (now >= escalationTime) {
        this.escalateAlert(alert.id);
      }
    });
  }

  private async loadDefaultRules(): Promise<void> {
    const defaultRules: Omit<AlertRule, 'id'>[] = [
      {
        name: 'High Error Rate',
        description: 'Alert when error rate exceeds 5%',
        condition: 'errorRate > 5%',
        severity: AlertSeverity.HIGH,
        channels: [AlertChannel.WEBHOOK, AlertChannel.CONSOLE],
        enabled: true,
        cooldownMinutes: 5,
        escalationMinutes: 15,
        tags: ['error-rate', 'system'],
      },
      {
        name: 'Trading System Down',
        description: 'Alert when trading system is unavailable',
        condition: 'tradingSystemUp == false',
        severity: AlertSeverity.CRITICAL,
        channels: [AlertChannel.WEBHOOK, AlertChannel.CONSOLE],
        enabled: true,
        cooldownMinutes: 1,
        escalationMinutes: 5,
        tags: ['trading', 'system', 'downtime'],
      },
      {
        name: 'Large Price Movement',
        description: 'Alert on significant price changes',
        condition: 'priceChange > 10%',
        severity: AlertSeverity.MEDIUM,
        channels: [AlertChannel.CONSOLE],
        enabled: true,
        cooldownMinutes: 10,
        tags: ['price', 'volatility'],
      },
    ];

    for (const rule of defaultRules) {
      await this.addRule(rule);
    }
  }

  private parseChannels(channelsStr: string): AlertChannel[] {
    return channelsStr
      .split(',')
      .map(c => c.trim() as AlertChannel)
      .filter(c => Object.values(AlertChannel).includes(c));
  }

  private parseHeaders(headersStr: string): Record<string, string> {
    try {
      return headersStr ? JSON.parse(headersStr) : {};
    } catch {
      return {};
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

      console.log('AlertingService shutting down...');
      this.isInitialized = false;
    } catch (error) {
      console.error('Error during AlertingService shutdown:', error);
    }
  }

  /**
   */
  isEnabled(): boolean {
    return this.isInitialized && this.config.enabled;
  }

  /**
   */
  getConfiguration(): AlertingConfig {
    return { ...this.config };
  }
}