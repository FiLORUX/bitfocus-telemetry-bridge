/**
 * Companion Adapter Types
 *
 * Type definitions for Companion Satellite API integration.
 * Based on the official Companion Satellite protocol.
 */

// -----------------------------------------------------------------------------
// Satellite Protocol Messages (Wire Format)
// -----------------------------------------------------------------------------

/**
 * Satellite API message types.
 * These are the raw protocol commands.
 */
export const SatelliteCommand = {
  // Client -> Companion
  BEGIN: 'BEGIN',
  KEY_PRESS: 'KEY-PRESS',
  KEY_ROTATE: 'KEY-ROTATE',
  KEYS_CLEAR: 'KEYS-CLEAR',
  VARIABLE_VALUE: 'VARIABLE-VALUE',
  PING: 'PING',

  // Companion -> Client
  KEY_STATE: 'KEY-STATE',
  KEYS_UPDATE: 'KEYS-UPDATE',
  VARIABLES_UPDATE: 'VARIABLES-UPDATE',
  BRIGHTNESS: 'BRIGHTNESS',
  PONG: 'PONG',
  ERROR: 'ERROR',
  ADD_DEVICE: 'ADD-DEVICE',
  REMOVE_DEVICE: 'REMOVE-DEVICE',
} as const;

export type SatelliteCommand = (typeof SatelliteCommand)[keyof typeof SatelliteCommand];

/**
 * Device type registration for Satellite API.
 */
export interface SatelliteDeviceInfo {
  /** Unique device serial/ID */
  deviceId: string;
  /** Product name */
  productName: string;
  /** Number of key columns */
  keysPerRow: number;
  /** Number of key rows */
  keysTotal: number;
  /** Key resolution (pixels) - optional */
  bitmapSize?: number;
  /** Whether device supports text labels */
  supportsText?: boolean;
  /** Whether device supports colours */
  supportsColour?: boolean;
  /** Whether device supports rotation */
  supportsRotation?: boolean;
}

/**
 * Key state update from Companion.
 */
export interface SatelliteKeyState {
  deviceId: string;
  keyIndex: number;
  /** Base64-encoded PNG image data */
  image?: string;
  /** Text to display (if device supports text) */
  text?: string;
  /** Background colour (hex) */
  colour?: string;
  /** Whether key is pressed/active */
  pressed?: boolean;
}

/**
 * Variable definition from Companion.
 */
export interface SatelliteVariable {
  name: string;
  value: string;
}

// -----------------------------------------------------------------------------
// Companion Adapter Configuration
// -----------------------------------------------------------------------------

export interface CompanionAdapterConfig {
  /** Companion host address */
  host: string;
  /** Companion Satellite API port (default: 16622) */
  port: number;
  /** Device registration info */
  device: SatelliteDeviceInfo;
  /** Auto-reconnect on disconnect */
  autoReconnect: boolean;
  /** Reconnect delay (ms) */
  reconnectDelay: number;
  /** Maximum reconnect attempts (0 = unlimited) */
  maxReconnectAttempts: number;
  /** Heartbeat interval (ms) */
  heartbeatInterval: number;
  /** Connection timeout (ms) */
  connectionTimeout: number;
  /** Variable patterns to subscribe to (default: all) */
  variablePatterns?: string[];
}

export const DEFAULT_COMPANION_CONFIG: CompanionAdapterConfig = {
  host: 'localhost',
  port: 16622,
  device: {
    deviceId: 'telemetry-bridge-001',
    productName: 'Telemetry Bridge',
    keysPerRow: 8,
    keysTotal: 32,
    supportsText: true,
    supportsColour: true,
  },
  autoReconnect: true,
  reconnectDelay: 5000,
  maxReconnectAttempts: 0, // Unlimited
  heartbeatInterval: 30000,
  connectionTimeout: 10000,
};

// -----------------------------------------------------------------------------
// Companion Adapter State
// -----------------------------------------------------------------------------

export const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
} as const;

export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState];

export interface CompanionAdapterState {
  connectionState: ConnectionState;
  lastConnected: number | null;
  lastDisconnected: number | null;
  reconnectAttempts: number;
  lastError: string | null;
  serverVersion: string | null;
  capabilities: CompanionCapabilities;
}

export interface CompanionCapabilities {
  /** Whether server supports variables */
  supportsVariables: boolean;
  /** Whether server supports key images */
  supportsKeyImages: boolean;
  /** Whether server supports rotation input */
  supportsRotation: boolean;
  /** Whether server supports custom variable writes */
  supportsVariableWrite: boolean;
  /** Satellite API version */
  apiVersion: string | null;
  /** Detected features */
  features: string[];
}

export const DEFAULT_CAPABILITIES: CompanionCapabilities = {
  supportsVariables: true,
  supportsKeyImages: true,
  supportsRotation: false,
  supportsVariableWrite: true,
  apiVersion: null,
  features: [],
};

// -----------------------------------------------------------------------------
// Adapter Events
// -----------------------------------------------------------------------------

export type CompanionAdapterEvent =
  | { type: 'connected'; serverVersion: string }
  | { type: 'disconnected'; reason: string }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'error'; error: string }
  | { type: 'key_state'; deviceId: string; keyIndex: number; state: SatelliteKeyState }
  | { type: 'variable_update'; variables: SatelliteVariable[] }
  | { type: 'brightness'; deviceId: string; level: number }
  | { type: 'capabilities_detected'; capabilities: CompanionCapabilities };

export type CompanionAdapterEventHandler = (event: CompanionAdapterEvent) => void;

// -----------------------------------------------------------------------------
// Command Mapping Types
// -----------------------------------------------------------------------------

/**
 * Mapping between Bridge Protocol commands and Companion actions.
 */
export interface CommandMapping {
  bridgeAction: string;
  companionCommand: SatelliteCommand;
  parameterTransform?: (params: Record<string, unknown>) => unknown[];
}

/**
 * Mapping between Companion state and Bridge Protocol state paths.
 */
export interface StateMapping {
  companionType: 'variable' | 'key_state' | 'brightness';
  bridgePathTemplate: string;
  valueTransform?: (raw: unknown) => unknown;
}

// -----------------------------------------------------------------------------
// Metrics
// -----------------------------------------------------------------------------

export interface CompanionMetrics {
  messagesReceived: number;
  messagesSent: number;
  keyStateUpdates: number;
  variableUpdates: number;
  commandsSent: number;
  commandsFailed: number;
  reconnects: number;
  lastLatencyMs: number | null;
}

export const INITIAL_METRICS: CompanionMetrics = {
  messagesReceived: 0,
  messagesSent: 0,
  keyStateUpdates: 0,
  variableUpdates: 0,
  commandsSent: 0,
  commandsFailed: 0,
  reconnects: 0,
  lastLatencyMs: null,
};
