/**
 * Bitfocus Telemetry Bridge
 *
 * State-first integration hub for Bitfocus Companion and custom applications.
 *
 * @packageDocumentation
 */

// Core components
export * from './core/index.js';

// Adapters (already handles internal collisions)
export * from './adapters/index.js';

// Transports - explicit exports to avoid collision with config
export {
  ClientTransportServer,
  DEFAULT_CLIENT_TRANSPORT_CONFIG,
  INITIAL_TRANSPORT_METRICS,
} from './transports/client/index.js';

export type {
  ClientSession,
  RateLimitState,
  ClientTransportConfig,
  ClientTransportEvent,
  ClientTransportEventHandler,
  ClientHandshake,
  ServerHandshake,
  HeartbeatMessage,
  ClientTransportMetrics,
} from './transports/client/index.js';

// Observability
export * from './observability/index.js';

// Configuration - schemas and loader (ClientTransportConfig from here is redundant, skipped)
export {
  CompanionConfigSchema,
  ButtonsConfigSchema,
  ClientTransportConfigSchema,
  LoggingConfigSchema,
  MetricsConfigSchema,
  HealthConfigSchema,
  EventLogConfigSchema,
  StateSnapshotConfigSchema,
  BridgeConfigSchema,
  loadConfig,
  validateConfig,
  ConfigValidationError,
  ConfigParseError,
} from './config/index.js';

export type {
  CompanionConfig,
  ButtonsConfig,
  // ClientTransportConfig - already exported from transports
  LoggingConfig,
  MetricsConfig,
  HealthConfig,
  EventLogConfig,
  StateSnapshotConfig,
  BridgeConfig,
  LoadConfigOptions,
  ConfigValidationResult,
} from './config/index.js';

// Version
export const VERSION = '0.1.0';
