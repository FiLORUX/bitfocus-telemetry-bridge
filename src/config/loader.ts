/**
 * Configuration Loader
 *
 * Loads and validates configuration from files and environment variables.
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { mkdirSync } from 'fs';
import type { BridgeConfig } from './schema.js';
import { BridgeConfigSchema } from './schema.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface LoadConfigOptions {
  /** Path to config file */
  configPath?: string;
  /** Override values (highest priority) */
  overrides?: Partial<BridgeConfig>;
  /** Whether to create default config if not found */
  createDefault?: boolean;
  /** Whether to apply environment variable overrides */
  applyEnv?: boolean;
}

export interface ConfigValidationResult {
  valid: boolean;
  config?: BridgeConfig;
  errors?: string[];
}

// -----------------------------------------------------------------------------
// Default Paths
// -----------------------------------------------------------------------------

const DEFAULT_CONFIG_PATHS = [
  'bridge.config.json',
  'config/bridge.json',
  'config.json',
];

const DEFAULT_CONFIG_ENV_VAR = 'BRIDGE_CONFIG_PATH';

// -----------------------------------------------------------------------------
// Loader
// -----------------------------------------------------------------------------

/**
 * Load configuration from file and/or environment.
 */
export function loadConfig(options: LoadConfigOptions = {}): BridgeConfig {
  const {
    configPath,
    overrides = {},
    createDefault = false,
    applyEnv = true,
  } = options;

  let fileConfig: Record<string, unknown> = {};

  // Find config file
  const resolvedPath = findConfigFile(configPath);

  if (resolvedPath) {
    fileConfig = loadConfigFile(resolvedPath);
  } else if (createDefault) {
    // Create default config
    const defaultPath = configPath ?? DEFAULT_CONFIG_PATHS[0]!;
    createDefaultConfig(defaultPath);
    fileConfig = {};
  }

  // Apply environment variables
  let envConfig: Record<string, unknown> = {};
  if (applyEnv) {
    envConfig = loadEnvConfig();
  }

  // Merge configs: defaults < file < env < overrides
  const merged = deepMerge(
    {},
    fileConfig,
    envConfig,
    overrides as Record<string, unknown>
  );

  // Validate and return
  const result = BridgeConfigSchema.safeParse(merged);

  if (!result.success) {
    const errors = result.error.errors.map(
      (e) => `${e.path.join('.')}: ${e.message}`
    );
    throw new ConfigValidationError(errors);
  }

  return result.data;
}

/**
 * Validate a configuration object.
 */
export function validateConfig(config: unknown): ConfigValidationResult {
  const result = BridgeConfigSchema.safeParse(config);

  if (result.success) {
    return { valid: true, config: result.data };
  }

  return {
    valid: false,
    errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
  };
}

// -----------------------------------------------------------------------------
// File Loading
// -----------------------------------------------------------------------------

/**
 * Find the configuration file.
 */
function findConfigFile(explicitPath?: string): string | null {
  // Check explicit path
  if (explicitPath) {
    const resolved = resolve(explicitPath);
    if (existsSync(resolved)) {
      return resolved;
    }
    return null;
  }

  // Check environment variable
  const envPath = process.env[DEFAULT_CONFIG_ENV_VAR];
  if (envPath) {
    const resolved = resolve(envPath);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  // Check default paths
  for (const defaultPath of DEFAULT_CONFIG_PATHS) {
    const resolved = resolve(defaultPath);
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

/**
 * Load configuration from a JSON file.
 */
function loadConfigFile(path: string): Record<string, unknown> {
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ConfigParseError(path, error.message);
    }
    throw error;
  }
}

/**
 * Create a default configuration file.
 */
function createDefaultConfig(path: string): void {
  const resolvedPath = resolve(path);
  const dir = dirname(resolvedPath);

  // Create directory if needed
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write default config
  const defaultConfig = BridgeConfigSchema.parse({});
  writeFileSync(resolvedPath, JSON.stringify(defaultConfig, null, 2));
}

// -----------------------------------------------------------------------------
// Environment Loading
// -----------------------------------------------------------------------------

/**
 * Load configuration from environment variables.
 *
 * Format: BRIDGE_<SECTION>_<KEY>=value
 * Examples:
 *   BRIDGE_COMPANION_HOST=192.168.1.100
 *   BRIDGE_LOGGING_LEVEL=debug
 *   BRIDGE_CLIENT_TRANSPORT_PORT=9001
 */
function loadEnvConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const prefix = 'BRIDGE_';

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(prefix) || !value) {
      continue;
    }

    // Parse the key
    const parts = key
      .substring(prefix.length)
      .toLowerCase()
      .split('_');

    // Build nested object
    setNestedValue(config, parts, parseEnvValue(value));
  }

  return config;
}

/**
 * Parse an environment variable value to the appropriate type.
 */
function parseEnvValue(value: string): unknown {
  // Boolean
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;

  // Array (comma-separated)
  if (value.includes(',')) {
    return value.split(',').map((v) => parseEnvValue(v.trim()));
  }

  // String
  return value;
}

/**
 * Set a nested value in an object using a path array.
 */
function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const key = convertToCamelCase(path[i]!);
    if (!(key in current)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const finalKey = convertToCamelCase(path[path.length - 1]!);
  current[finalKey] = value;
}

/**
 * Convert snake_case to camelCase.
 */
function convertToCamelCase(str: string): string {
  // Handle special cases for config keys
  const specialCases: Record<string, string> = {
    'clienttransport': 'clientTransport',
    'eventlog': 'eventLog',
    'statesnapshot': 'stateSnapshot',
    'ratelimit': 'rateLimit',
    'ratelimitwindow': 'rateLimitWindow',
    'idletimeout': 'idleTimeout',
    'requireauth': 'requireAuth',
    'authtokens': 'authTokens',
    'enablecompression': 'enableCompression',
    'maxmessagesize': 'maxMessageSize',
    'heartbeatinterval': 'heartbeatInterval',
    'autoreconnect': 'autoReconnect',
    'reconnectdelay': 'reconnectDelay',
    'maxreconnectattempts': 'maxReconnectAttempts',
    'connectiontimeout': 'connectionTimeout',
    'keysperrow': 'keysPerRow',
    'keystotal': 'keysTotal',
    'deviceid': 'deviceId',
    'productname': 'productName',
    'maxfilesize': 'maxFileSize',
    'maxfiles': 'maxFiles',
    'maxsnapshots': 'maxSnapshots',
    'checkinterval': 'checkInterval',
  };

  const lower = str.toLowerCase();
  return specialCases[lower] ?? lower;
}

// -----------------------------------------------------------------------------
// Deep Merge
// -----------------------------------------------------------------------------

/**
 * Deep merge objects (later objects override earlier).
 */
function deepMerge(...objects: Record<string, unknown>[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const existing = result[key];

      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        existing !== null &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        result[key] = deepMerge(
          existing as Record<string, unknown>,
          value as Record<string, unknown>
        );
      } else if (value !== undefined) {
        result[key] = value;
      }
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class ConfigValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Configuration validation failed:\n  ${errors.join('\n  ')}`);
    this.name = 'ConfigValidationError';
  }
}

export class ConfigParseError extends Error {
  constructor(
    public readonly path: string,
    public readonly parseError: string
  ) {
    super(`Failed to parse config file '${path}': ${parseError}`);
    this.name = 'ConfigParseError';
  }
}
