/**
 * Buttons Adapter Types
 *
 * Type definitions and contracts for Bitfocus Buttons integration.
 *
 * NOTE: This is a PLACEHOLDER implementation. The full Buttons protocol
 * is not yet implemented. These types define the expected contract that
 * any future implementation must satisfy.
 */

// -----------------------------------------------------------------------------
// Device Types
// -----------------------------------------------------------------------------

/**
 * A Buttons device (physical or virtual control surface).
 */
export interface ButtonsDevice {
  /** Unique device identifier */
  id: string;
  /** Device name/label */
  name: string;
  /** Device type identifier */
  type: ButtonsDeviceType;
  /** Number of columns */
  columns: number;
  /** Number of rows */
  rows: number;
  /** Whether device supports images */
  supportsImages: boolean;
  /** Whether device supports text labels */
  supportsText: boolean;
  /** Whether device supports RGB lighting */
  supportsRgb: boolean;
  /** Whether device supports encoders */
  supportsEncoders: boolean;
  /** Firmware version if available */
  firmwareVersion?: string;
  /** Connection timestamp */
  connectedAt: number;
}

export const ButtonsDeviceType = {
  STREAM_DECK: 'stream_deck',
  STREAM_DECK_MINI: 'stream_deck_mini',
  STREAM_DECK_XL: 'stream_deck_xl',
  STREAM_DECK_MK2: 'stream_deck_mk2',
  STREAM_DECK_PEDAL: 'stream_deck_pedal',
  STREAM_DECK_PLUS: 'stream_deck_plus',
  LOUPEDECK: 'loupedeck',
  LOUPEDECK_LIVE: 'loupedeck_live',
  X_KEYS: 'x_keys',
  VIRTUAL: 'virtual',
  UNKNOWN: 'unknown',
} as const;

export type ButtonsDeviceType = (typeof ButtonsDeviceType)[keyof typeof ButtonsDeviceType];

// -----------------------------------------------------------------------------
// Key/Button Types
// -----------------------------------------------------------------------------

/**
 * State of a single key/button.
 */
export interface ButtonsKeyState {
  /** Device ID */
  deviceId: string;
  /** Key index (0-based) */
  keyIndex: number;
  /** Column position */
  column: number;
  /** Row position */
  row: number;
  /** Whether key is pressed */
  pressed: boolean;
  /** Image data (base64 PNG) */
  image?: string;
  /** Text label */
  text?: string;
  /** Background colour (hex) */
  colour?: string;
  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Key event (press/release).
 */
export interface ButtonsKeyEvent {
  /** Event type */
  type: 'press' | 'release' | 'hold';
  /** Device ID */
  deviceId: string;
  /** Key index */
  keyIndex: number;
  /** Column position */
  column: number;
  /** Row position */
  row: number;
  /** Event timestamp */
  timestamp: number;
  /** Hold duration (ms) for hold events */
  duration?: number;
}

// -----------------------------------------------------------------------------
// Encoder Types
// -----------------------------------------------------------------------------

/**
 * Encoder event (rotation or push).
 */
export interface ButtonsEncoderEvent {
  /** Event type */
  type: 'rotate' | 'press' | 'release';
  /** Device ID */
  deviceId: string;
  /** Encoder index */
  encoderIndex: number;
  /** Direction for rotate (-1 or 1) */
  direction?: number;
  /** Rotation amount (number of clicks) */
  amount?: number;
  /** Event timestamp */
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Transport Abstraction
// -----------------------------------------------------------------------------

/**
 * Transport layer abstraction.
 * Implementations can be WebSocket, OSC, MQTT, HTTP, etc.
 */
export interface ButtonsTransport {
  /** Transport identifier */
  readonly id: string;
  /** Transport type */
  readonly type: string;

  /** Connect to the transport */
  connect(): Promise<void>;

  /** Disconnect from the transport */
  disconnect(): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  /** Send raw message */
  send(message: ButtonsWireMessage): Promise<void>;

  /** Set message handler */
  onMessage(handler: (message: ButtonsWireMessage) => void): void;

  /** Set connection state handler */
  onConnectionChange(handler: (connected: boolean) => void): void;
}

/**
 * Wire message format (transport-agnostic).
 */
export interface ButtonsWireMessage {
  /** Message type */
  type: string;
  /** Payload */
  payload: unknown;
  /** Timestamp */
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Protocol Codec Abstraction
// -----------------------------------------------------------------------------

/**
 * Codec for encoding/decoding Buttons protocol messages.
 */
export interface ButtonsCodec {
  /** Codec identifier */
  readonly id: string;

  /** Encode a message for transport */
  encode(message: ButtonsMessage): ButtonsWireMessage;

  /** Decode a wire message */
  decode(wire: ButtonsWireMessage): ButtonsMessage;

  /** Check if message type is supported */
  supports(type: string): boolean;
}

/**
 * High-level Buttons message (decoded).
 */
export type ButtonsMessage =
  | { type: 'device_connected'; device: ButtonsDevice }
  | { type: 'device_disconnected'; deviceId: string }
  | { type: 'key_event'; event: ButtonsKeyEvent }
  | { type: 'encoder_event'; event: ButtonsEncoderEvent }
  | { type: 'key_state'; state: ButtonsKeyState }
  | { type: 'set_key_image'; deviceId: string; keyIndex: number; image: string }
  | { type: 'set_key_text'; deviceId: string; keyIndex: number; text: string }
  | { type: 'set_key_colour'; deviceId: string; keyIndex: number; colour: string }
  | { type: 'clear_key'; deviceId: string; keyIndex: number }
  | { type: 'set_brightness'; deviceId: string; level: number }
  | { type: 'error'; code: string; message: string };

// -----------------------------------------------------------------------------
// Adapter Interface
// -----------------------------------------------------------------------------

/**
 * Buttons adapter interface.
 * Any implementation must satisfy this contract.
 */
export interface ButtonsAdapter {
  /** Adapter namespace */
  readonly namespace: string;

  /** Connect the adapter to the router */
  connect(router: unknown): Promise<void>;

  /** Disconnect the adapter */
  disconnect(): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  /** Get connected devices */
  getDevices(): ButtonsDevice[];

  /** Get device by ID */
  getDevice(deviceId: string): ButtonsDevice | undefined;

  /** Get key state */
  getKeyState(deviceId: string, keyIndex: number): ButtonsKeyState | undefined;

  /** Set key image */
  setKeyImage(deviceId: string, keyIndex: number, image: string): Promise<void>;

  /** Set key text */
  setKeyText(deviceId: string, keyIndex: number, text: string): Promise<void>;

  /** Set key colour */
  setKeyColour(deviceId: string, keyIndex: number, colour: string): Promise<void>;

  /** Clear key */
  clearKey(deviceId: string, keyIndex: number): Promise<void>;

  /** Set brightness */
  setBrightness(deviceId: string, level: number): Promise<void>;

  /** Get adapter state */
  getState(): ButtonsAdapterState;

  /** Get metrics */
  getMetrics(): ButtonsAdapterMetrics;

  /** Add event handler */
  onEvent(handler: ButtonsAdapterEventHandler): void;

  /** Remove event handler */
  offEvent(handler: ButtonsAdapterEventHandler): void;
}

// -----------------------------------------------------------------------------
// Adapter State & Events
// -----------------------------------------------------------------------------

export const ButtonsConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
} as const;

export type ButtonsConnectionState =
  (typeof ButtonsConnectionState)[keyof typeof ButtonsConnectionState];

export interface ButtonsAdapterState {
  connectionState: ButtonsConnectionState;
  lastConnected: number | null;
  lastDisconnected: number | null;
  lastError: string | null;
  deviceCount: number;
}

export type ButtonsAdapterEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'error'; error: string }
  | { type: 'device_added'; device: ButtonsDevice }
  | { type: 'device_removed'; deviceId: string }
  | { type: 'key_pressed'; deviceId: string; keyIndex: number }
  | { type: 'key_released'; deviceId: string; keyIndex: number }
  | { type: 'encoder_rotated'; deviceId: string; encoderIndex: number; direction: number };

export type ButtonsAdapterEventHandler = (event: ButtonsAdapterEvent) => void;

// -----------------------------------------------------------------------------
// Adapter Metrics
// -----------------------------------------------------------------------------

export interface ButtonsAdapterMetrics {
  /** Connected device count */
  deviceCount: number;
  /** Key events received */
  keyEvents: number;
  /** Encoder events received */
  encoderEvents: number;
  /** Commands sent */
  commandsSent: number;
  /** Commands failed */
  commandsFailed: number;
  /** Reconnect count */
  reconnects: number;
}

export const INITIAL_BUTTONS_METRICS: ButtonsAdapterMetrics = {
  deviceCount: 0,
  keyEvents: 0,
  encoderEvents: 0,
  commandsSent: 0,
  commandsFailed: 0,
  reconnects: 0,
};

// -----------------------------------------------------------------------------
// Adapter Configuration
// -----------------------------------------------------------------------------

export interface ButtonsAdapterConfig {
  /** Transport to use */
  transport: ButtonsTransport;
  /** Protocol codec */
  codec: ButtonsCodec;
  /** Auto-reconnect on disconnect */
  autoReconnect: boolean;
  /** Reconnect delay (ms) */
  reconnectDelay: number;
  /** Maximum reconnect attempts (0 = unlimited) */
  maxReconnectAttempts: number;
}

export const DEFAULT_BUTTONS_CONFIG: Omit<ButtonsAdapterConfig, 'transport' | 'codec'> = {
  autoReconnect: true,
  reconnectDelay: 5000,
  maxReconnectAttempts: 0,
};
