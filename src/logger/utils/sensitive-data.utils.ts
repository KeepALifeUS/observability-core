/**
 * Sensitive Data Masking Utilities - 2025 Security Edition
 *
 * @description
 * @author  Trading Team
 * @version 3.0.0 - 2025
 * @compliance GDPR, PCI DSS, SOX, OWASP
 * @patterns Strategy, Chain of Responsibility, Decorator
 */

import { createHash } from 'crypto';

/**
 */
export enum MaskingLevel {
  NONE = 'none',           // No masking
  PARTIAL = 'partial',     // Show first/last few characters
  FULL = 'full',          // Complete replacement with mask
  HASH = 'hash',          // Replace with hash
  ENCRYPT = 'encrypt',     // Encrypt the value
  REMOVE = 'remove',      // Remove field completely
}

/**
 */
export enum SensitiveDataType {
  // Authentication & Authorization
  PASSWORD = 'password',
  TOKEN = 'token',
  API_KEY = 'api_key',
  SECRET = 'secret',
  PRIVATE_KEY = 'private_key',
  SESSION_ID = 'session_id',
  COOKIE = 'cookie',

  // Personal Information (GDPR)
  EMAIL = 'email',
  PHONE = 'phone',
  SSN = 'ssn',
  PASSPORT = 'passport',
  DRIVER_LICENSE = 'driver_license',
  CREDIT_CARD = 'credit_card',
  BANK_ACCOUNT = 'bank_account',

  // Financial (PCI DSS)
  CARD_NUMBER = 'card_number',
  CVV = 'cvv',
  ACCOUNT_NUMBER = 'account_number',
  ROUTING_NUMBER = 'routing_number',
  WALLET_ADDRESS = 'wallet_address',
  PRIVATE_SEED = 'private_seed',

  // Trading Specific
  TRADING_KEY = 'trading_key',
  EXCHANGE_SECRET = 'exchange_secret',
  WEBHOOK_SECRET = 'webhook_secret',

  // Network & Security
  IP_ADDRESS = 'ip_address',
  USER_AGENT = 'user_agent',
  AUTHORIZATION = 'authorization',
  SIGNATURE = 'signature',

  // Custom
  CUSTOM = 'custom',
}

/**
 */
export interface MaskingRule {
  name: string;
  dataType: SensitiveDataType;
  level: MaskingLevel;
  matcher: string | RegExp | ((key: string, value: any) => boolean);
  replacement?: string | ((value: any) => string);
  preserveLength?: boolean;
  preserveFormat?: boolean;
  customMask?: string;

  // Conditional masking
  condition?: (context: any) => boolean;
  environments?: string[]; // Only apply in these environments
}

/**
 */
export interface MaskingConfig {
  enabled: boolean;
  defaultLevel: MaskingLevel;
  rules: MaskingRule[];

  // Performance options
  maxDepth: number;
  maxArraySize: number;

  // Security options
  hashAlgorithm: 'md5' | 'sha1' | 'sha256' | 'sha512';
  encryptionKey?: string;

  // Logging options
  logMaskingEvents: boolean;
  trackMaskedFields: boolean;
}

/**
 */
export interface MaskingResult {
  original: any;
  masked: any;
  fieldsProcessed: number;
  fieldsMasked: number;
  maskedFields: string[];
  errors: Array<{
    field: string;
    error: string;
  }>;
  processingTimeMs: number;
}

/**
 */
export interface MaskingContext {
  environment: string;
  userId?: string;
  requestId?: string;
  path: string;
  depth: number;
  parentType?: string;
}

/**
 * - 2025
 */
export class SensitiveDataMasker {
  private readonly config: MaskingConfig;
  private readonly compiledRules: CompiledMaskingRule[];

  constructor(config: MaskingConfig) {
    this.config = {
      ...config,
      maxDepth: config.maxDepth ?? 10,
      maxArraySize: config.maxArraySize ?? 100,
      hashAlgorithm: config.hashAlgorithm ?? 'sha256',
      logMaskingEvents: config.logMaskingEvents ?? false,
      trackMaskedFields: config.trackMaskedFields ?? true,
    };

    this.compiledRules = this.compileRules(this.config.rules);
  }

  /**
   */
  mask(data: any, context?: Partial<MaskingContext>): MaskingResult {
    const startTime = Date.now();
    const ctx: MaskingContext = {
      environment: 'production',
      path: '',
      depth: 0,
      ...context,
    };

    const result: MaskingResult = {
      original: data,
      masked: null,
      fieldsProcessed: 0,
      fieldsMasked: 0,
      maskedFields: [],
      errors: [],
      processingTimeMs: 0,
    };

    try {
      if (!this.config.enabled) {
        result.masked = data;
        return result;
      }

      result.masked = this.maskRecursive(data, ctx, result);
    } catch (error: unknown) {
      result.errors.push({
        field: ctx.path,
        error: (error as Error).message,
      });
      result.masked = '[MASKING_ERROR]';
    }

    result.processingTimeMs = Date.now() - startTime;
    return result;
  }

  /**
   */
  maskShallow(data: any, context?: Partial<MaskingContext>): any {
    if (!this.config.enabled || !data || typeof data !== 'object') {
      return data;
    }

    const ctx: MaskingContext = {
      environment: 'production',
      path: '',
      depth: 0,
      ...context,
    };

    const masked = Array.isArray(data) ? [...data] : { ...data };

    for (const [key, value] of Object.entries(masked)) {
      const rule = this.findMatchingRule(key, value, ctx);
      if (rule) {
        masked[key] = this.applyMasking(value, rule, `${ctx.path}.${key}`);
      }
    }

    return masked;
  }

  /**
   */
  containsSensitiveData(data: any, context?: Partial<MaskingContext>): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const ctx: MaskingContext = {
      environment: 'production',
      path: '',
      depth: 0,
      ...context,
    };

    return this.detectSensitiveDataRecursive(data, ctx);
  }

  /**
   */
  getSensitiveFields(data: any, context?: Partial<MaskingContext>): string[] {
    const sensitiveFields: string[] = [];

    if (!data || typeof data !== 'object') {
      return sensitiveFields;
    }

    const ctx: MaskingContext = {
      environment: 'production',
      path: '',
      depth: 0,
      ...context,
    };

    this.collectSensitiveFields(data, ctx, sensitiveFields);
    return sensitiveFields;
  }

  // ==================== PRIVATE METHODS ====================

  private compileRules(rules: MaskingRule[]): CompiledMaskingRule[] {
    return rules.map(rule => ({
      ...rule,
      compiledMatcher: this.compileMatcher(rule.matcher),
    }));
  }

  private compileMatcher(matcher: string | RegExp | ((key: string, value: any) => boolean)): (key: string, value: any) => boolean {
    if (typeof matcher === 'function') {
      return matcher;
    }

    if (matcher instanceof RegExp) {
      return (key: string) => matcher.test(key);
    }

    if (typeof matcher === 'string') {
      const regex = new RegExp(matcher, 'i');
      return (key: string) => regex.test(key);
    }

    return () => false;
  }

  private maskRecursive(
    data: any,
    context: MaskingContext,
    result: MaskingResult
  ): any {
    result.fieldsProcessed++;

    // Depth limit
    if (context.depth > this.config.maxDepth) {
      return '[MAX_DEPTH_EXCEEDED]';
    }

    // Null/undefined
    if (data === null || data === undefined) {
      return data;
    }

    // Primitive types
    if (typeof data !== 'object') {
      return data;
    }

    // Arrays
    if (Array.isArray(data)) {
      return this.maskArray(data, context, result);
    }

    // Objects
    return this.maskObject(data, context, result);
  }

  private maskArray(
    array: any[],
    context: MaskingContext,
    result: MaskingResult
  ): any[] {
    // Limit array size for performance
    const maxSize = Math.min(array.length, this.config.maxArraySize);
    const maskedArray = [];

    for (let i = 0; i < maxSize; i++) {
      const itemContext = {
        ...context,
        path: `${context.path}[${i}]`,
        depth: context.depth + 1,
      };

      maskedArray.push(this.maskRecursive(array[i], itemContext, result));
    }

    if (array.length > maxSize) {
      maskedArray.push('[ARRAY_TRUNCATED]');
    }

    return maskedArray;
  }

  private maskObject(
    obj: any,
    context: MaskingContext,
    result: MaskingResult
  ): any {
    const masked: Record<string, any> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fieldPath = context.path ? `${context.path}.${key}` : key;
      const fieldContext = {
        ...context,
        path: fieldPath,
        depth: context.depth + 1,
      };

      // Check for masking rule
      const rule = this.findMatchingRule(key, value, context);

      if (rule) {
        // Apply masking rule
        if (rule.level === MaskingLevel.REMOVE) {
          continue; // Skip this field entirely
        }

        masked[key] = this.applyMasking(value, rule, fieldPath);
        result.fieldsMasked++;
        result.maskedFields.push(fieldPath);
      } else if (typeof value === 'object' && value !== null) {
        // Recursively process nested objects
        masked[key] = this.maskRecursive(value, fieldContext, result);
      } else {
        // Keep as-is
        masked[key] = value;
      }
    }

    return masked;
  }

  private findMatchingRule(
    key: string,
    value: any,
    context: MaskingContext
  ): CompiledMaskingRule | null {
    for (const rule of this.compiledRules) {
      // Check environment filter
      if (rule.environments && !rule.environments.includes(context.environment)) {
        continue;
      }

      // Check condition
      if (rule.condition && !rule.condition(context)) {
        continue;
      }

      // Check matcher
      if (rule.compiledMatcher(key, value)) {
        return rule;
      }
    }

    return null;
  }

  private applyMasking(value: any, rule: CompiledMaskingRule, _fieldPath: string): any {
    try {
      switch (rule.level) {
        case MaskingLevel.NONE:
          return value;

        case MaskingLevel.PARTIAL:
          return this.applyPartialMasking(value, rule);

        case MaskingLevel.FULL:
          return this.applyFullMasking(value, rule);

        case MaskingLevel.HASH:
          return this.applyHashMasking(value);

        case MaskingLevel.ENCRYPT:
          return this.applyEncryptionMasking(value);

        case MaskingLevel.REMOVE:
          return undefined; // Field will be removed

        default:
          return '[MASKED]';
      }
    } catch (error) {
      return '[MASKING_ERROR]';
    }
  }

  private applyPartialMasking(value: any, rule: CompiledMaskingRule): any {
    if (typeof value !== 'string') {
      return '[MASKED]';
    }

    if (value.length <= 6) {
      return '*'.repeat(value.length);
    }

    const showChars = Math.min(2, Math.floor(value.length / 4));
    const prefix = value.substring(0, showChars);
    const suffix = value.substring(value.length - showChars);
    const maskLength = rule.preserveLength ?
      value.length - (showChars * 2) :
      3;

    return `${prefix}${'*'.repeat(maskLength)}${suffix}`;
  }

  private applyFullMasking(value: any, rule: CompiledMaskingRule): any {
    if (rule.replacement) {
      if (typeof rule.replacement === 'function') {
        return rule.replacement(value);
      }
      return rule.replacement;
    }

    if (rule.customMask) {
      return rule.customMask;
    }

    if (rule.preserveLength && typeof value === 'string') {
      return '*'.repeat(value.length);
    }

    return '[MASKED]';
  }

  private applyHashMasking(value: any): string {
    const stringValue = String(value);
    const hash = createHash(this.config.hashAlgorithm)
      .update(stringValue)
      .digest('hex');

    return `[HASH:${hash.substring(0, 8)}]`;
  }

  private applyEncryptionMasking(_value: any): string {
    // Simple encryption placeholder - in real implementation,
    // use proper encryption with the configured key
    if (!this.config.encryptionKey) {
      return '[ENCRYPTION_KEY_MISSING]';
    }

    return '[ENCRYPTED]';
  }

  private detectSensitiveDataRecursive(
    data: any,
    context: MaskingContext
  ): boolean {
    if (context.depth > this.config.maxDepth) {
      return false;
    }

    if (!data || typeof data !== 'object') {
      return false;
    }

    if (Array.isArray(data)) {
      return data.some((item, index) => {
        const itemContext = {
          ...context,
          path: `${context.path}[${index}]`,
          depth: context.depth + 1,
        };
        return this.detectSensitiveDataRecursive(item, itemContext);
      });
    }

    for (const [key, value] of Object.entries(data)) {
      const rule = this.findMatchingRule(key, value, context);
      if (rule) {
        return true;
      }

      if (typeof value === 'object' && value !== null) {
        const fieldContext = {
          ...context,
          path: context.path ? `${context.path}.${key}` : key,
          depth: context.depth + 1,
        };

        if (this.detectSensitiveDataRecursive(value, fieldContext)) {
          return true;
        }
      }
    }

    return false;
  }

  private collectSensitiveFields(
    data: any,
    context: MaskingContext,
    fields: string[]
  ): void {
    if (context.depth > this.config.maxDepth) {
      return;
    }

    if (!data || typeof data !== 'object') {
      return;
    }

    if (Array.isArray(data)) {
      data.forEach((item, index) => {
        const itemContext = {
          ...context,
          path: `${context.path}[${index}]`,
          depth: context.depth + 1,
        };
        this.collectSensitiveFields(item, itemContext, fields);
      });
      return;
    }

    for (const [key, value] of Object.entries(data)) {
      const fieldPath = context.path ? `${context.path}.${key}` : key;
      const rule = this.findMatchingRule(key, value, context);

      if (rule) {
        fields.push(fieldPath);
      }

      if (typeof value === 'object' && value !== null) {
        const fieldContext = {
          ...context,
          path: fieldPath,
          depth: context.depth + 1,
        };
        this.collectSensitiveFields(value, fieldContext, fields);
      }
    }
  }
}

/**
 */
interface CompiledMaskingRule extends MaskingRule {
  compiledMatcher: (key: string, value: any) => boolean;
}

/**
 */
export const MASKING_RULES = {
  // Basic security rules
  BASIC: [
    {
      name: 'passwords',
      dataType: SensitiveDataType.PASSWORD,
      level: MaskingLevel.FULL,
      matcher: /password|pwd|pass|secret/i,
    },
    {
      name: 'tokens',
      dataType: SensitiveDataType.TOKEN,
      level: MaskingLevel.FULL,
      matcher: /token|bearer|jwt|auth/i,
    },
    {
      name: 'api_keys',
      dataType: SensitiveDataType.API_KEY,
      level: MaskingLevel.FULL,
      matcher: /api[_-]?key|key|apikey/i,
    },
  ] as MaskingRule[],

  // GDPR compliance rules
  GDPR: [
    {
      name: 'email',
      dataType: SensitiveDataType.EMAIL,
      level: MaskingLevel.PARTIAL,
      matcher: /email|mail|e[_-]?mail/i,
    },
    {
      name: 'phone',
      dataType: SensitiveDataType.PHONE,
      level: MaskingLevel.PARTIAL,
      matcher: /phone|mobile|tel|number/i,
    },
    {
      name: 'personal_id',
      dataType: SensitiveDataType.SSN,
      level: MaskingLevel.HASH,
      matcher: /ssn|social|passport|id[_-]?number/i,
    },
  ] as MaskingRule[],

  // Financial data rules (PCI DSS)
  FINANCIAL: [
    {
      name: 'card_number',
      dataType: SensitiveDataType.CARD_NUMBER,
      level: MaskingLevel.PARTIAL,
      matcher: /card[_-]?number|cardnumber|pan|ccnum/i,
      preserveLength: true,
    },
    {
      name: 'cvv',
      dataType: SensitiveDataType.CVV,
      level: MaskingLevel.FULL,
      matcher: /cvv|cvc|security[_-]?code/i,
    },
    {
      name: 'account_number',
      dataType: SensitiveDataType.ACCOUNT_NUMBER,
      level: MaskingLevel.PARTIAL,
      matcher: /account[_-]?number|acct[_-]?num/i,
    },
  ] as MaskingRule[],

  // Crypto trading specific rules
  CRYPTO_TRADING: [
    {
      name: 'private_keys',
      dataType: SensitiveDataType.PRIVATE_KEY,
      level: MaskingLevel.FULL,
      matcher: /private[_-]?key|privkey|seed|mnemonic/i,
    },
    {
      name: 'exchange_secrets',
      dataType: SensitiveDataType.EXCHANGE_SECRET,
      level: MaskingLevel.FULL,
      matcher: /exchange[_-]?secret|trading[_-]?secret/i,
    },
    {
      name: 'wallet_address',
      dataType: SensitiveDataType.WALLET_ADDRESS,
      level: MaskingLevel.PARTIAL,
      matcher: /wallet[_-]?address|address|pubkey/i,
    },
  ] as MaskingRule[],

  // Development/production environment rules
  PRODUCTION: [
    {
      name: 'remove_debug',
      dataType: SensitiveDataType.CUSTOM,
      level: MaskingLevel.REMOVE,
      matcher: /debug|test|temp|tmp/i,
      environments: ['production'],
    },
  ] as MaskingRule[],
} as const;

/**
 */
export const MASKING_CONFIGS = {
  // Development - minimal masking
  DEVELOPMENT: {
    enabled: true,
    defaultLevel: MaskingLevel.PARTIAL,
    maxDepth: 5,
    maxArraySize: 50,
    hashAlgorithm: 'md5' as const,
    logMaskingEvents: true,
    rules: [...MASKING_RULES.BASIC],
  } as MaskingConfig,

  // Production - comprehensive masking
  PRODUCTION: {
    enabled: true,
    defaultLevel: MaskingLevel.FULL,
    maxDepth: 10,
    maxArraySize: 100,
    hashAlgorithm: 'sha256' as const,
    logMaskingEvents: false,
    rules: [
      ...MASKING_RULES.BASIC,
      ...MASKING_RULES.GDPR,
      ...MASKING_RULES.FINANCIAL,
      ...MASKING_RULES.CRYPTO_TRADING,
      ...MASKING_RULES.PRODUCTION,
    ],
  } as MaskingConfig,

  // High security - maximum protection
  HIGH_SECURITY: {
    enabled: true,
    defaultLevel: MaskingLevel.HASH,
    maxDepth: 8,
    maxArraySize: 50,
    hashAlgorithm: 'sha512' as const,
    logMaskingEvents: false,
    rules: [
      ...MASKING_RULES.BASIC,
      ...MASKING_RULES.GDPR,
      ...MASKING_RULES.FINANCIAL,
      ...MASKING_RULES.CRYPTO_TRADING,
      {
        name: 'all_values',
        dataType: SensitiveDataType.CUSTOM,
        level: MaskingLevel.HASH,
        matcher: () => true, // Mask everything
      },
    ],
  } as MaskingConfig,
} as const;