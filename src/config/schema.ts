/**
 * Configuration Schema
 *
 * Zod schema definitions for configuration validation.
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// Companion Adapter Config Schema
// -----------------------------------------------------------------------------

export const CompanionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  host: z.string().min(1).default('localhost'),
  port: z.number().int().min(1).max(65535).default(16622),
  device: z.object({
    deviceId: z.string().min(1).default('telemetry-bridge-001'),
    productName: z.string().min(1).default('Telemetry Bridge'),
    keysPerRow: z.number().int().min(1).max(32).default(8),
    keysTotal: z.number().int().min(1).max(256).default(32),
  }).default({}),
  autoReconnect: z.boolean().default(true),
  reconnectDelay: z.number().int().min(1000).max(60000).default(5000),
  maxReconnectAttempts: z.number().int().min(0).default(0),
  heartbeatInterval: z.number().int().min(5000).max(120000).default(30000),
  connectionTimeout: z.number().int().min(1000).max(60000).default(10000),
});

// -----------------------------------------------------------------------------
// Buttons Adapter Config Schema
// -----------------------------------------------------------------------------

export const ButtonsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  // Placeholder - transport config would go here
  autoReconnect: z.boolean().default(true),
  reconnectDelay: z.number().int().min(1000).max(60000).default(5000),
  maxReconnectAttempts: z.number().int().min(0).default(0),
});

// -----------------------------------------------------------------------------
// Client Transport Config Schema
// -----------------------------------------------------------------------------

export const ClientTransportConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).default(9000),
  host: z.string().default('0.0.0.0'),
  maxClients: z.number().int().min(1).max(1000).default(100),
  rateLimit: z.number().int().min(1).max(10000).default(100),
  rateLimitWindow: z.number().int().min(100).max(60000).default(1000),
  idleTimeout: z.number().int().min(0).max(3600000).default(300000),
  requireAuth: z.boolean().default(false),
  authTokens: z.array(z.string()).default([]),
  enableCompression: z.boolean().default(true),
  maxMessageSize: z.number().int().min(1024).max(10485760).default(1048576),
  heartbeatInterval: z.number().int().min(5000).max(120000).default(30000),
});

// -----------------------------------------------------------------------------
// Logging Config Schema
// -----------------------------------------------------------------------------

export const LoggingConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  pretty: z.boolean().default(false),
  file: z.object({
    enabled: z.boolean().default(false),
    path: z.string().default('logs/telemetry-bridge.log'),
    maxSize: z.string().default('10m'),
    maxFiles: z.number().int().min(1).max(100).default(5),
  }).default({}),
});

// -----------------------------------------------------------------------------
// Metrics Config Schema
// -----------------------------------------------------------------------------

export const MetricsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).default(9090),
  path: z.string().default('/metrics'),
});

// -----------------------------------------------------------------------------
// Health Config Schema
// -----------------------------------------------------------------------------

export const HealthConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).default(9091),
  checkInterval: z.number().int().min(5000).max(300000).default(30000),
});

// -----------------------------------------------------------------------------
// Event Log Config Schema
// -----------------------------------------------------------------------------

export const EventLogConfigSchema = z.object({
  enabled: z.boolean().default(true),
  path: z.string().default('data/events'),
  maxFileSize: z.string().default('100m'),
  maxFiles: z.number().int().min(1).max(365).default(7),
  compress: z.boolean().default(true),
});

// -----------------------------------------------------------------------------
// State Snapshot Config Schema
// -----------------------------------------------------------------------------

export const StateSnapshotConfigSchema = z.object({
  enabled: z.boolean().default(true),
  path: z.string().default('data/snapshots'),
  interval: z.number().int().min(10000).max(3600000).default(60000),
  maxSnapshots: z.number().int().min(1).max(100).default(10),
});

// -----------------------------------------------------------------------------
// GUI Config Schema
// -----------------------------------------------------------------------------

export const GuiConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).default(9092),
  host: z.string().default('0.0.0.0'),
});

// -----------------------------------------------------------------------------
// Full Configuration Schema
// -----------------------------------------------------------------------------

export const BridgeConfigSchema = z.object({
  // General
  name: z.string().min(1).default('telemetry-bridge'),
  environment: z.enum(['development', 'production', 'test']).default('development'),

  // Adapters
  companion: CompanionConfigSchema.default({}),
  buttons: ButtonsConfigSchema.default({}),

  // Transport
  clientTransport: ClientTransportConfigSchema.default({}),

  // Observability
  logging: LoggingConfigSchema.default({}),
  metrics: MetricsConfigSchema.default({}),
  health: HealthConfigSchema.default({}),

  // Persistence
  eventLog: EventLogConfigSchema.default({}),
  stateSnapshot: StateSnapshotConfigSchema.default({}),

  // GUI
  gui: GuiConfigSchema.default({}),
});

// -----------------------------------------------------------------------------
// Type Exports
// -----------------------------------------------------------------------------

export type CompanionConfig = z.infer<typeof CompanionConfigSchema>;
export type ButtonsConfig = z.infer<typeof ButtonsConfigSchema>;
export type ClientTransportConfig = z.infer<typeof ClientTransportConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type MetricsConfig = z.infer<typeof MetricsConfigSchema>;
export type HealthConfig = z.infer<typeof HealthConfigSchema>;
export type EventLogConfig = z.infer<typeof EventLogConfigSchema>;
export type StateSnapshotConfig = z.infer<typeof StateSnapshotConfigSchema>;
export type GuiConfig = z.infer<typeof GuiConfigSchema>;
export type BridgeConfig = z.infer<typeof BridgeConfigSchema>;
