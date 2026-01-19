/**
 * Adapters Module
 *
 * Re-exports all adapter components.
 * Uses namespaced exports to avoid name collisions.
 */

// Companion adapter exports
export {
  CompanionAdapter,
  CompanionSimulator,
  DEFAULT_COMPANION_CONFIG,
  DEFAULT_SIMULATOR_CONFIG as DEFAULT_COMPANION_SIMULATOR_CONFIG,
  DEFAULT_CAPABILITIES,
  INITIAL_METRICS as INITIAL_COMPANION_METRICS,
  ConnectionState as CompanionConnectionState,
  SatelliteCommand,
} from './companion/index.js';

export type {
  CompanionAdapterConfig,
  CompanionAdapterState,
  CompanionCapabilities,
  CompanionMetrics,
  CompanionAdapterEvent,
  CompanionAdapterEventHandler,
  SatelliteDeviceInfo,
  SatelliteKeyState,
  SatelliteVariable,
  SimulatorConfig as CompanionSimulatorConfig,
  SimulatorClient as CompanionSimulatorClient,
  SimulatorEvent as CompanionSimulatorEvent,
  SimulatorEventHandler as CompanionSimulatorEventHandler,
} from './companion/index.js';

// Buttons adapter exports
export {
  ButtonsPlaceholderAdapter,
  SimpleButtonsCodec,
  ButtonsSimulator,
  SimulatedButtonsTransport,
  STREAM_DECK_CONFIGS,
  DEFAULT_BUTTONS_CONFIG,
  DEFAULT_SIMULATOR_CONFIG as DEFAULT_BUTTONS_SIMULATOR_CONFIG,
  ButtonsConnectionState,
  ButtonsDeviceType,
  INITIAL_BUTTONS_METRICS,
} from './buttons/index.js';

export type {
  ButtonsAdapter,
  ButtonsAdapterConfig,
  ButtonsAdapterState,
  ButtonsAdapterMetrics,
  ButtonsAdapterEvent,
  ButtonsAdapterEventHandler,
  ButtonsDevice,
  ButtonsKeyState,
  ButtonsKeyEvent,
  ButtonsEncoderEvent,
  ButtonsTransport,
  ButtonsCodec,
  ButtonsWireMessage,
  ButtonsMessage,
  ButtonsSimulatorConfig,
  SimulatedDeviceConfig,
  SimulatorScript,
  SimulatorAction,
} from './buttons/index.js';
