/**
 * Buttons Adapter (Placeholder)
 *
 * Placeholder implementation of the Buttons adapter interface.
 * This demonstrates the expected contract and provides a reference
 * for future full implementations.
 *
 * NOTE: This is NOT a production implementation. It serves as:
 * 1. A reference for the expected interface
 * 2. A test double for contract testing
 * 3. A foundation for future real implementations
 */

import type {
  ButtonsAdapter,
  ButtonsDevice,
  ButtonsKeyState,
  ButtonsAdapterState,
  ButtonsAdapterMetrics,
  ButtonsAdapterEvent,
  ButtonsAdapterEventHandler,
  ButtonsAdapterConfig,
  ButtonsTransport,
  ButtonsCodec,
  ButtonsWireMessage,
  ButtonsMessage,
} from './types.js';
import {
  ButtonsConnectionState,
  DEFAULT_BUTTONS_CONFIG,
  INITIAL_BUTTONS_METRICS,
} from './types.js';
import type { MessageRouter } from '../../core/router/router.js';
import type { BridgeMessage, CommandMessage } from '../../core/protocol/types.js';
import { isCommandMessage, AckStatus, ErrorCode } from '../../core/protocol/types.js';
import { createAck, SequenceCounter } from '../../core/protocol/factory.js';

// -----------------------------------------------------------------------------
// Placeholder Adapter Implementation
// -----------------------------------------------------------------------------

export class ButtonsPlaceholderAdapter implements ButtonsAdapter {
  readonly namespace = 'buttons.device';

  private readonly config: ButtonsAdapterConfig;
  private readonly sequenceCounter: SequenceCounter;

  private router: MessageRouter | null = null;
  private state: ButtonsAdapterState;
  private metrics: ButtonsAdapterMetrics;
  private eventHandlers: Set<ButtonsAdapterEventHandler> = new Set();

  /** Connected devices */
  private devices: Map<string, ButtonsDevice> = new Map();

  /** Key states */
  private keyStates: Map<string, ButtonsKeyState> = new Map();

  constructor(transport: ButtonsTransport, codec: ButtonsCodec, config: Partial<Omit<ButtonsAdapterConfig, 'transport' | 'codec'>> = {}) {
    this.config = {
      transport,
      codec,
      ...DEFAULT_BUTTONS_CONFIG,
      ...config,
    };

    this.sequenceCounter = new SequenceCounter();
    this.state = this.createInitialState();
    this.metrics = { ...INITIAL_BUTTONS_METRICS };

    // Set up transport message handler
    this.config.transport.onMessage((message) => this.handleTransportMessage(message));
    this.config.transport.onConnectionChange((connected) => this.handleConnectionChange(connected));
  }

  private createInitialState(): ButtonsAdapterState {
    return {
      connectionState: ButtonsConnectionState.DISCONNECTED,
      lastConnected: null,
      lastDisconnected: null,
      lastError: null,
      deviceCount: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async connect(router: MessageRouter): Promise<void> {
    this.router = router;

    // Register as a route target
    router.registerTarget({
      id: `buttons-adapter-placeholder`,
      namespace: this.namespace,
      handler: this.handleBridgeMessage.bind(this),
    });

    // Also register for buttons.* commands
    router.registerTarget({
      id: `buttons-adapter-placeholder-commands`,
      namespace: 'buttons',
      handler: this.handleBridgeMessage.bind(this),
    });

    // Connect transport
    this.state.connectionState = ButtonsConnectionState.CONNECTING;
    await this.config.transport.connect();
  }

  async disconnect(): Promise<void> {
    await this.config.transport.disconnect();

    if (this.router) {
      this.router.unregisterTarget(this.namespace);
      this.router.unregisterTarget('buttons');
      this.router = null;
    }

    this.state.connectionState = ButtonsConnectionState.DISCONNECTED;
    this.state.lastDisconnected = Date.now();
  }

  isConnected(): boolean {
    return this.state.connectionState === ButtonsConnectionState.CONNECTED;
  }

  // ---------------------------------------------------------------------------
  // Device Management
  // ---------------------------------------------------------------------------

  getDevices(): ButtonsDevice[] {
    return Array.from(this.devices.values());
  }

  getDevice(deviceId: string): ButtonsDevice | undefined {
    return this.devices.get(deviceId);
  }

  // ---------------------------------------------------------------------------
  // Key State
  // ---------------------------------------------------------------------------

  getKeyState(deviceId: string, keyIndex: number): ButtonsKeyState | undefined {
    return this.keyStates.get(`${deviceId}:${keyIndex}`);
  }

  // ---------------------------------------------------------------------------
  // Key Commands
  // ---------------------------------------------------------------------------

  async setKeyImage(deviceId: string, keyIndex: number, image: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected');
    }

    const message: ButtonsMessage = {
      type: 'set_key_image',
      deviceId,
      keyIndex,
      image,
    };

    await this.sendMessage(message);
    this.metrics.commandsSent++;
  }

  async setKeyText(deviceId: string, keyIndex: number, text: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected');
    }

    const message: ButtonsMessage = {
      type: 'set_key_text',
      deviceId,
      keyIndex,
      text,
    };

    await this.sendMessage(message);
    this.metrics.commandsSent++;
  }

  async setKeyColour(deviceId: string, keyIndex: number, colour: string): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected');
    }

    const message: ButtonsMessage = {
      type: 'set_key_colour',
      deviceId,
      keyIndex,
      colour,
    };

    await this.sendMessage(message);
    this.metrics.commandsSent++;
  }

  async clearKey(deviceId: string, keyIndex: number): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected');
    }

    const message: ButtonsMessage = {
      type: 'clear_key',
      deviceId,
      keyIndex,
    };

    await this.sendMessage(message);
    this.metrics.commandsSent++;
  }

  async setBrightness(deviceId: string, level: number): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('Adapter not connected');
    }

    const message: ButtonsMessage = {
      type: 'set_brightness',
      deviceId,
      level,
    };

    await this.sendMessage(message);
    this.metrics.commandsSent++;
  }

  // ---------------------------------------------------------------------------
  // State & Metrics
  // ---------------------------------------------------------------------------

  getState(): ButtonsAdapterState {
    return { ...this.state };
  }

  getMetrics(): ButtonsAdapterMetrics {
    return { ...this.metrics };
  }

  // ---------------------------------------------------------------------------
  // Event Handling
  // ---------------------------------------------------------------------------

  onEvent(handler: ButtonsAdapterEventHandler): void {
    this.eventHandlers.add(handler);
  }

  offEvent(handler: ButtonsAdapterEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emitEvent(event: ButtonsAdapterEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Buttons event handler error:', error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Transport Message Handling
  // ---------------------------------------------------------------------------

  private handleTransportMessage(wireMessage: ButtonsWireMessage): void {
    try {
      const message = this.config.codec.decode(wireMessage);
      this.processButtonsMessage(message);
    } catch (error) {
      console.error('Failed to decode Buttons message:', error);
    }
  }

  private processButtonsMessage(message: ButtonsMessage): void {
    switch (message.type) {
      case 'device_connected':
        this.handleDeviceConnected(message.device);
        break;

      case 'device_disconnected':
        this.handleDeviceDisconnected(message.deviceId);
        break;

      case 'key_event':
        this.handleKeyEvent(message.event);
        break;

      case 'encoder_event':
        this.handleEncoderEvent(message.event);
        break;

      case 'key_state':
        this.handleKeyStateUpdate(message.state);
        break;

      case 'error':
        this.state.lastError = message.message;
        this.emitEvent({ type: 'error', error: message.message });
        break;
    }
  }

  private handleDeviceConnected(device: ButtonsDevice): void {
    this.devices.set(device.id, device);
    this.metrics.deviceCount = this.devices.size;
    this.state.deviceCount = this.devices.size;

    // Publish to bridge
    this.publishDeviceState(device);

    this.emitEvent({ type: 'device_added', device });
  }

  private handleDeviceDisconnected(deviceId: string): void {
    this.devices.delete(deviceId);

    // Remove key states
    for (const key of this.keyStates.keys()) {
      if (key.startsWith(`${deviceId}:`)) {
        this.keyStates.delete(key);
      }
    }

    this.metrics.deviceCount = this.devices.size;
    this.state.deviceCount = this.devices.size;

    // Mark state as stale
    if (this.router) {
      const stateStore = this.router.getStateStore();
      stateStore.markOwnerStale(`${this.namespace}.${deviceId}`);
    }

    this.emitEvent({ type: 'device_removed', deviceId });
  }

  private handleKeyEvent(event: import('./types.js').ButtonsKeyEvent): void {
    this.metrics.keyEvents++;

    // Update local state
    const stateKey = `${event.deviceId}:${event.keyIndex}`;
    let state = this.keyStates.get(stateKey);

    if (!state) {
      const device = this.devices.get(event.deviceId);
      state = {
        deviceId: event.deviceId,
        keyIndex: event.keyIndex,
        column: event.column,
        row: event.row,
        pressed: false,
        updatedAt: Date.now(),
      };
      this.keyStates.set(stateKey, state);
    }

    state.pressed = event.type === 'press';
    state.updatedAt = event.timestamp;

    // Publish to bridge
    this.publishKeyState(event.deviceId, event.keyIndex, state);

    // Emit event
    if (event.type === 'press') {
      this.emitEvent({ type: 'key_pressed', deviceId: event.deviceId, keyIndex: event.keyIndex });
    } else if (event.type === 'release') {
      this.emitEvent({ type: 'key_released', deviceId: event.deviceId, keyIndex: event.keyIndex });
    }
  }

  private handleEncoderEvent(event: import('./types.js').ButtonsEncoderEvent): void {
    this.metrics.encoderEvents++;

    if (event.type === 'rotate' && event.direction !== undefined) {
      this.emitEvent({
        type: 'encoder_rotated',
        deviceId: event.deviceId,
        encoderIndex: event.encoderIndex,
        direction: event.direction,
      });
    }
  }

  private handleKeyStateUpdate(state: ButtonsKeyState): void {
    const stateKey = `${state.deviceId}:${state.keyIndex}`;
    this.keyStates.set(stateKey, state);

    // Publish to bridge
    this.publishKeyState(state.deviceId, state.keyIndex, state);
  }

  private handleConnectionChange(connected: boolean): void {
    if (connected) {
      this.state.connectionState = ButtonsConnectionState.CONNECTED;
      this.state.lastConnected = Date.now();
      this.emitEvent({ type: 'connected' });
    } else {
      this.state.connectionState = ButtonsConnectionState.DISCONNECTED;
      this.state.lastDisconnected = Date.now();
      this.emitEvent({ type: 'disconnected', reason: 'Transport disconnected' });
    }
  }

  // ---------------------------------------------------------------------------
  // Bridge Message Handling
  // ---------------------------------------------------------------------------

  private async handleBridgeMessage(message: BridgeMessage): Promise<void> {
    if (!isCommandMessage(message)) {
      return;
    }

    const command = message as CommandMessage;

    switch (command.payload.action) {
      case 'setImage':
        await this.handleSetImageCommand(command);
        break;

      case 'setText':
        await this.handleSetTextCommand(command);
        break;

      case 'setColour':
        await this.handleSetColourCommand(command);
        break;

      case 'clear':
        await this.handleClearCommand(command);
        break;

      case 'setBrightness':
        await this.handleSetBrightnessCommand(command);
        break;

      default:
        this.sendErrorResponse(command, ErrorCode.ADAPTER_ERROR, `Unknown action: ${command.payload.action}`);
    }
  }

  private async handleSetImageCommand(command: CommandMessage): Promise<void> {
    const params = command.payload.params as { deviceId: string; keyIndex: number; image: string } | undefined;

    if (!params?.deviceId || params.keyIndex === undefined || !params.image) {
      this.sendErrorResponse(command, ErrorCode.INVALID_MESSAGE, 'Missing required parameters');
      return;
    }

    try {
      await this.setKeyImage(params.deviceId, params.keyIndex, params.image);
      this.sendCompletedAck(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.sendErrorResponse(command, ErrorCode.ADAPTER_ERROR, message);
    }
  }

  private async handleSetTextCommand(command: CommandMessage): Promise<void> {
    const params = command.payload.params as { deviceId: string; keyIndex: number; text: string } | undefined;

    if (!params?.deviceId || params.keyIndex === undefined || params.text === undefined) {
      this.sendErrorResponse(command, ErrorCode.INVALID_MESSAGE, 'Missing required parameters');
      return;
    }

    try {
      await this.setKeyText(params.deviceId, params.keyIndex, params.text);
      this.sendCompletedAck(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.sendErrorResponse(command, ErrorCode.ADAPTER_ERROR, message);
    }
  }

  private async handleSetColourCommand(command: CommandMessage): Promise<void> {
    const params = command.payload.params as { deviceId: string; keyIndex: number; colour: string } | undefined;

    if (!params?.deviceId || params.keyIndex === undefined || !params.colour) {
      this.sendErrorResponse(command, ErrorCode.INVALID_MESSAGE, 'Missing required parameters');
      return;
    }

    try {
      await this.setKeyColour(params.deviceId, params.keyIndex, params.colour);
      this.sendCompletedAck(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.sendErrorResponse(command, ErrorCode.ADAPTER_ERROR, message);
    }
  }

  private async handleClearCommand(command: CommandMessage): Promise<void> {
    const params = command.payload.params as { deviceId: string; keyIndex: number } | undefined;

    if (!params?.deviceId || params.keyIndex === undefined) {
      this.sendErrorResponse(command, ErrorCode.INVALID_MESSAGE, 'Missing required parameters');
      return;
    }

    try {
      await this.clearKey(params.deviceId, params.keyIndex);
      this.sendCompletedAck(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.sendErrorResponse(command, ErrorCode.ADAPTER_ERROR, message);
    }
  }

  private async handleSetBrightnessCommand(command: CommandMessage): Promise<void> {
    const params = command.payload.params as { deviceId: string; level: number } | undefined;

    if (!params?.deviceId || params.level === undefined) {
      this.sendErrorResponse(command, ErrorCode.INVALID_MESSAGE, 'Missing required parameters');
      return;
    }

    try {
      await this.setBrightness(params.deviceId, params.level);
      this.sendCompletedAck(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.sendErrorResponse(command, ErrorCode.ADAPTER_ERROR, message);
    }
  }

  // ---------------------------------------------------------------------------
  // State Publishing
  // ---------------------------------------------------------------------------

  private publishDeviceState(device: ButtonsDevice): void {
    if (!this.router) return;

    const stateStore = this.router.getStateStore();
    const path = `buttons.device.${device.id}`;

    stateStore.set(path, device, this.namespace);
  }

  private publishKeyState(deviceId: string, keyIndex: number, state: ButtonsKeyState): void {
    if (!this.router) return;

    const stateStore = this.router.getStateStore();
    const path = `buttons.device.${deviceId}.key.${keyIndex}`;

    stateStore.set(path, state, this.namespace);
  }

  // ---------------------------------------------------------------------------
  // Response Helpers
  // ---------------------------------------------------------------------------

  private sendCompletedAck(command: CommandMessage, result?: unknown): void {
    if (!this.router) return;

    const ack = createAck(
      {
        source: this.namespace,
        target: command.source,
        path: command.path,
        commandId: command.id,
        status: AckStatus.COMPLETED,
        result,
        correlationId: command.correlationId,
      },
      this.sequenceCounter.next()
    );

    this.router.route(ack);
  }

  private sendErrorResponse(command: CommandMessage, code: string, message: string): void {
    if (!this.router) return;

    this.metrics.commandsFailed++;

    const ack = createAck(
      {
        source: this.namespace,
        target: command.source,
        path: command.path,
        commandId: command.id,
        status: AckStatus.FAILED,
        error: { code, message },
        correlationId: command.correlationId,
      },
      this.sequenceCounter.next()
    );

    this.router.route(ack);
  }

  // ---------------------------------------------------------------------------
  // Message Sending
  // ---------------------------------------------------------------------------

  private async sendMessage(message: ButtonsMessage): Promise<void> {
    const wireMessage = this.config.codec.encode(message);
    await this.config.transport.send(wireMessage);
  }
}

// -----------------------------------------------------------------------------
// Simple Codec Implementation (for testing)
// -----------------------------------------------------------------------------

export class SimpleButtonsCodec implements ButtonsCodec {
  readonly id = 'simple-codec';

  encode(message: ButtonsMessage): ButtonsWireMessage {
    return {
      type: message.type,
      payload: message,
      timestamp: Date.now(),
    };
  }

  decode(wire: ButtonsWireMessage): ButtonsMessage {
    return wire.payload as ButtonsMessage;
  }

  supports(type: string): boolean {
    return true;
  }
}
