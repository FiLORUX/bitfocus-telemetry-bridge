/**
 * Buttons Simulator
 *
 * Mock implementation for testing Buttons adapter contracts.
 * Simulates device connections, key events, and encoder events.
 */

import type {
  ButtonsDevice,
  ButtonsKeyState,
  ButtonsKeyEvent,
  ButtonsEncoderEvent,
  ButtonsTransport,
  ButtonsWireMessage,
  ButtonsMessage,
  ButtonsDeviceType,
} from './types.js';

// -----------------------------------------------------------------------------
// Simulator Configuration
// -----------------------------------------------------------------------------

export interface ButtonsSimulatorConfig {
  /** Initial devices to simulate */
  initialDevices?: SimulatedDeviceConfig[];
  /** Response delay (ms) for simulating latency */
  responseDelay: number;
}

export interface SimulatedDeviceConfig {
  id: string;
  name: string;
  type: ButtonsDeviceType;
  columns: number;
  rows: number;
  supportsEncoders?: boolean;
  encoderCount?: number;
}

export const DEFAULT_SIMULATOR_CONFIG: ButtonsSimulatorConfig = {
  responseDelay: 0,
};

// -----------------------------------------------------------------------------
// Simulated Transport
// -----------------------------------------------------------------------------

/**
 * In-memory transport for testing.
 */
export class SimulatedButtonsTransport implements ButtonsTransport {
  readonly id = 'simulated-transport';
  readonly type = 'memory';

  private connected = false;
  private messageHandler: ((message: ButtonsWireMessage) => void) | null = null;
  private connectionHandlers: Set<(connected: boolean) => void> = new Set();
  private outboundQueue: ButtonsWireMessage[] = [];

  async connect(): Promise<void> {
    this.connected = true;
    for (const handler of this.connectionHandlers) {
      handler(true);
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    for (const handler of this.connectionHandlers) {
      handler(false);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async send(message: ButtonsWireMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('Transport not connected');
    }
    this.outboundQueue.push(message);
  }

  onMessage(handler: (message: ButtonsWireMessage) => void): void {
    this.messageHandler = handler;
  }

  onConnectionChange(handler: (connected: boolean) => void): void {
    this.connectionHandlers.add(handler);
  }

  /**
   * Inject a message as if received from the transport.
   */
  injectMessage(message: ButtonsWireMessage): void {
    this.messageHandler?.(message);
  }

  /**
   * Get messages sent via this transport.
   */
  getOutboundQueue(): ButtonsWireMessage[] {
    return [...this.outboundQueue];
  }

  /**
   * Clear the outbound queue.
   */
  clearOutboundQueue(): void {
    this.outboundQueue = [];
  }
}

// -----------------------------------------------------------------------------
// Buttons Simulator
// -----------------------------------------------------------------------------

export class ButtonsSimulator {
  private readonly config: ButtonsSimulatorConfig;
  private readonly transport: SimulatedButtonsTransport;

  /** Simulated devices */
  private devices: Map<string, ButtonsDevice> = new Map();

  /** Key states */
  private keyStates: Map<string, ButtonsKeyState> = new Map();

  /** Event log */
  private eventLog: Array<{ timestamp: number; event: ButtonsMessage }> = [];

  constructor(config: Partial<ButtonsSimulatorConfig> = {}) {
    this.config = { ...DEFAULT_SIMULATOR_CONFIG, ...config };
    this.transport = new SimulatedButtonsTransport();

    // Initialize devices (but don't emit yet - wait for connection)
    if (this.config.initialDevices) {
      for (const deviceConfig of this.config.initialDevices) {
        this.addDeviceInternal(deviceConfig);
      }
    }

    // Re-emit device_connected events when transport connects
    this.transport.onConnectionChange((connected) => {
      if (connected) {
        this.emitAllDevices();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Transport Access
  // ---------------------------------------------------------------------------

  /**
   * Get the simulated transport.
   */
  getTransport(): SimulatedButtonsTransport {
    return this.transport;
  }

  // ---------------------------------------------------------------------------
  // Device Simulation
  // ---------------------------------------------------------------------------

  /**
   * Add a simulated device (internal, without emitting).
   */
  private addDeviceInternal(config: SimulatedDeviceConfig): ButtonsDevice {
    const device: ButtonsDevice = {
      id: config.id,
      name: config.name,
      type: config.type,
      columns: config.columns,
      rows: config.rows,
      supportsImages: true,
      supportsText: true,
      supportsRgb: true,
      supportsEncoders: config.supportsEncoders ?? false,
      connectedAt: Date.now(),
    };

    this.devices.set(device.id, device);

    // Initialize key states
    const totalKeys = config.columns * config.rows;
    for (let i = 0; i < totalKeys; i++) {
      const row = Math.floor(i / config.columns);
      const column = i % config.columns;

      const keyState: ButtonsKeyState = {
        deviceId: device.id,
        keyIndex: i,
        column,
        row,
        pressed: false,
        updatedAt: Date.now(),
      };

      this.keyStates.set(`${device.id}:${i}`, keyState);
    }

    return device;
  }

  /**
   * Add a simulated device and emit device_connected event.
   */
  addDevice(config: SimulatedDeviceConfig): ButtonsDevice {
    const device = this.addDeviceInternal(config);

    // Emit device connected message
    this.emitMessage({
      type: 'device_connected',
      device,
    });

    return device;
  }

  /**
   * Emit device_connected events for all existing devices.
   */
  emitAllDevices(): void {
    for (const device of this.devices.values()) {
      this.emitMessage({
        type: 'device_connected',
        device,
      });
    }
  }

  /**
   * Remove a simulated device.
   */
  removeDevice(deviceId: string): boolean {
    const device = this.devices.get(deviceId);
    if (!device) {
      return false;
    }

    this.devices.delete(deviceId);

    // Remove key states
    for (const key of this.keyStates.keys()) {
      if (key.startsWith(`${deviceId}:`)) {
        this.keyStates.delete(key);
      }
    }

    // Emit device disconnected message
    this.emitMessage({
      type: 'device_disconnected',
      deviceId,
    });

    return true;
  }

  /**
   * Get all devices.
   */
  getDevices(): ButtonsDevice[] {
    return Array.from(this.devices.values());
  }

  /**
   * Get device by ID.
   */
  getDevice(deviceId: string): ButtonsDevice | undefined {
    return this.devices.get(deviceId);
  }

  // ---------------------------------------------------------------------------
  // Event Simulation
  // ---------------------------------------------------------------------------

  /**
   * Simulate a key press.
   */
  pressKey(deviceId: string, keyIndex: number): void {
    const stateKey = `${deviceId}:${keyIndex}`;
    const state = this.keyStates.get(stateKey);

    if (!state) {
      return;
    }

    state.pressed = true;
    state.updatedAt = Date.now();

    const event: ButtonsKeyEvent = {
      type: 'press',
      deviceId,
      keyIndex,
      column: state.column,
      row: state.row,
      timestamp: Date.now(),
    };

    this.emitMessage({ type: 'key_event', event });
  }

  /**
   * Simulate a key release.
   */
  releaseKey(deviceId: string, keyIndex: number): void {
    const stateKey = `${deviceId}:${keyIndex}`;
    const state = this.keyStates.get(stateKey);

    if (!state) {
      return;
    }

    state.pressed = false;
    state.updatedAt = Date.now();

    const event: ButtonsKeyEvent = {
      type: 'release',
      deviceId,
      keyIndex,
      column: state.column,
      row: state.row,
      timestamp: Date.now(),
    };

    this.emitMessage({ type: 'key_event', event });
  }

  /**
   * Simulate a key press and release.
   */
  tapKey(deviceId: string, keyIndex: number, holdDuration = 100): void {
    this.pressKey(deviceId, keyIndex);

    setTimeout(() => {
      this.releaseKey(deviceId, keyIndex);
    }, holdDuration);
  }

  /**
   * Simulate encoder rotation.
   */
  rotateEncoder(deviceId: string, encoderIndex: number, direction: 'left' | 'right', amount = 1): void {
    const device = this.devices.get(deviceId);

    if (!device?.supportsEncoders) {
      return;
    }

    const event: ButtonsEncoderEvent = {
      type: 'rotate',
      deviceId,
      encoderIndex,
      direction: direction === 'left' ? -1 : 1,
      amount,
      timestamp: Date.now(),
    };

    this.emitMessage({ type: 'encoder_event', event });
  }

  /**
   * Simulate encoder press.
   */
  pressEncoder(deviceId: string, encoderIndex: number): void {
    const device = this.devices.get(deviceId);

    if (!device?.supportsEncoders) {
      return;
    }

    const event: ButtonsEncoderEvent = {
      type: 'press',
      deviceId,
      encoderIndex,
      timestamp: Date.now(),
    };

    this.emitMessage({ type: 'encoder_event', event });
  }

  /**
   * Simulate encoder release.
   */
  releaseEncoder(deviceId: string, encoderIndex: number): void {
    const device = this.devices.get(deviceId);

    if (!device?.supportsEncoders) {
      return;
    }

    const event: ButtonsEncoderEvent = {
      type: 'release',
      deviceId,
      encoderIndex,
      timestamp: Date.now(),
    };

    this.emitMessage({ type: 'encoder_event', event });
  }

  // ---------------------------------------------------------------------------
  // State Updates
  // ---------------------------------------------------------------------------

  /**
   * Set key image.
   */
  setKeyImage(deviceId: string, keyIndex: number, image: string): void {
    const stateKey = `${deviceId}:${keyIndex}`;
    const state = this.keyStates.get(stateKey);

    if (state) {
      state.image = image;
      state.updatedAt = Date.now();
      this.emitMessage({ type: 'key_state', state: { ...state } });
    }
  }

  /**
   * Set key text.
   */
  setKeyText(deviceId: string, keyIndex: number, text: string): void {
    const stateKey = `${deviceId}:${keyIndex}`;
    const state = this.keyStates.get(stateKey);

    if (state) {
      state.text = text;
      state.updatedAt = Date.now();
      this.emitMessage({ type: 'key_state', state: { ...state } });
    }
  }

  /**
   * Set key colour.
   */
  setKeyColour(deviceId: string, keyIndex: number, colour: string): void {
    const stateKey = `${deviceId}:${keyIndex}`;
    const state = this.keyStates.get(stateKey);

    if (state) {
      state.colour = colour;
      state.updatedAt = Date.now();
      this.emitMessage({ type: 'key_state', state: { ...state } });
    }
  }

  /**
   * Get key state.
   */
  getKeyState(deviceId: string, keyIndex: number): ButtonsKeyState | undefined {
    return this.keyStates.get(`${deviceId}:${keyIndex}`);
  }

  // ---------------------------------------------------------------------------
  // Message Emission
  // ---------------------------------------------------------------------------

  private emitMessage(message: ButtonsMessage): void {
    const wireMessage: ButtonsWireMessage = {
      type: message.type,
      payload: message,
      timestamp: Date.now(),
    };

    // Log event
    this.eventLog.push({ timestamp: Date.now(), event: message });

    // Apply delay if configured
    if (this.config.responseDelay > 0) {
      setTimeout(() => {
        this.transport.injectMessage(wireMessage);
      }, this.config.responseDelay);
    } else {
      this.transport.injectMessage(wireMessage);
    }
  }

  // ---------------------------------------------------------------------------
  // Event Log
  // ---------------------------------------------------------------------------

  /**
   * Get the event log.
   */
  getEventLog(): Array<{ timestamp: number; event: ButtonsMessage }> {
    return [...this.eventLog];
  }

  /**
   * Clear the event log.
   */
  clearEventLog(): void {
    this.eventLog = [];
  }

  // ---------------------------------------------------------------------------
  // Scripting API
  // ---------------------------------------------------------------------------

  /**
   * Run a scripted sequence of actions.
   */
  async runScript(script: SimulatorScript): Promise<void> {
    for (const action of script.actions) {
      switch (action.type) {
        case 'delay':
          await new Promise((resolve) => setTimeout(resolve, action.ms));
          break;

        case 'press':
          this.pressKey(action.deviceId, action.keyIndex);
          break;

        case 'release':
          this.releaseKey(action.deviceId, action.keyIndex);
          break;

        case 'tap':
          this.tapKey(action.deviceId, action.keyIndex, action.holdDuration);
          break;

        case 'rotate':
          this.rotateEncoder(action.deviceId, action.encoderIndex, action.direction, action.amount);
          break;

        case 'addDevice':
          this.addDevice(action.config);
          break;

        case 'removeDevice':
          this.removeDevice(action.deviceId);
          break;
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Script Types
// -----------------------------------------------------------------------------

export interface SimulatorScript {
  name: string;
  actions: SimulatorAction[];
}

export type SimulatorAction =
  | { type: 'delay'; ms: number }
  | { type: 'press'; deviceId: string; keyIndex: number }
  | { type: 'release'; deviceId: string; keyIndex: number }
  | { type: 'tap'; deviceId: string; keyIndex: number; holdDuration?: number }
  | { type: 'rotate'; deviceId: string; encoderIndex: number; direction: 'left' | 'right'; amount?: number }
  | { type: 'addDevice'; config: SimulatedDeviceConfig }
  | { type: 'removeDevice'; deviceId: string };

// -----------------------------------------------------------------------------
// Pre-built Device Configurations
// -----------------------------------------------------------------------------

export const STREAM_DECK_CONFIGS: Record<string, SimulatedDeviceConfig> = {
  MINI: {
    id: 'stream-deck-mini-001',
    name: 'Stream Deck Mini',
    type: 'stream_deck_mini',
    columns: 3,
    rows: 2,
  },
  STANDARD: {
    id: 'stream-deck-001',
    name: 'Stream Deck',
    type: 'stream_deck',
    columns: 5,
    rows: 3,
  },
  XL: {
    id: 'stream-deck-xl-001',
    name: 'Stream Deck XL',
    type: 'stream_deck_xl',
    columns: 8,
    rows: 4,
  },
  PLUS: {
    id: 'stream-deck-plus-001',
    name: 'Stream Deck +',
    type: 'stream_deck_plus',
    columns: 4,
    rows: 2,
    supportsEncoders: true,
    encoderCount: 4,
  },
  PEDAL: {
    id: 'stream-deck-pedal-001',
    name: 'Stream Deck Pedal',
    type: 'stream_deck_pedal',
    columns: 3,
    rows: 1,
  },
};
