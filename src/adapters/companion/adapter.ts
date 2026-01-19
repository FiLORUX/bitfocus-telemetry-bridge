/**
 * Companion Adapter
 *
 * Production-grade adapter for Bitfocus Companion using the Satellite API.
 * Provides bidirectional state synchronisation and command execution.
 */

import { WebSocket } from 'ws';
import type {
  BridgeMessage,
  CommandMessage,
  StateMessage,
} from '../../core/protocol/types.js';
import {
  MessageType,
  AckStatus,
  ErrorCode,
  isCommandMessage,
} from '../../core/protocol/types.js';
import { createAck, createState, createEvent, SequenceCounter } from '../../core/protocol/factory.js';
import type { MessageRouter } from '../../core/router/router.js';
import type {
  CompanionAdapterConfig,
  CompanionAdapterState,
  CompanionAdapterEvent,
  CompanionAdapterEventHandler,
  CompanionCapabilities,
  CompanionMetrics,
  SatelliteKeyState,
  SatelliteVariable,
} from './types.js';
import {
  ConnectionState,
  DEFAULT_COMPANION_CONFIG,
  DEFAULT_CAPABILITIES,
  INITIAL_METRICS,
  SatelliteCommand,
} from './types.js';

// -----------------------------------------------------------------------------
// Companion Adapter
// -----------------------------------------------------------------------------

export class CompanionAdapter {
  private readonly config: CompanionAdapterConfig;
  private readonly namespace = 'companion.satellite';
  private readonly sequenceCounter: SequenceCounter;

  private ws: WebSocket | null = null;
  private router: MessageRouter | null = null;
  private state: CompanionAdapterState;
  private metrics: CompanionMetrics;
  private eventHandlers: Set<CompanionAdapterEventHandler> = new Set();

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPong: number | null = null;

  /** Variables cache for efficient lookups */
  private variablesCache: Map<string, string> = new Map();

  /** Key states cache */
  private keyStatesCache: Map<string, SatelliteKeyState> = new Map();

  constructor(config: Partial<CompanionAdapterConfig> = {}) {
    this.config = { ...DEFAULT_COMPANION_CONFIG, ...config };
    this.sequenceCounter = new SequenceCounter();
    this.state = this.createInitialState();
    this.metrics = { ...INITIAL_METRICS };
  }

  private createInitialState(): CompanionAdapterState {
    return {
      connectionState: ConnectionState.DISCONNECTED,
      lastConnected: null,
      lastDisconnected: null,
      reconnectAttempts: 0,
      lastError: null,
      serverVersion: null,
      capabilities: { ...DEFAULT_CAPABILITIES },
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Connect the adapter to the router and establish connection to Companion.
   */
  async connect(router: MessageRouter): Promise<void> {
    this.router = router;

    // Register as a route target
    router.registerTarget({
      id: `companion-adapter-${this.config.device.deviceId}`,
      namespace: this.namespace,
      handler: this.handleBridgeMessage.bind(this),
    });

    // Also register for companion.* commands
    router.registerTarget({
      id: `companion-adapter-${this.config.device.deviceId}-commands`,
      namespace: 'companion',
      handler: this.handleBridgeMessage.bind(this),
    });

    await this.connectToCompanion();
  }

  /**
   * Disconnect from Companion and unregister from router.
   */
  async disconnect(): Promise<void> {
    this.clearTimers();

    if (this.ws) {
      this.ws.close(1000, 'Adapter shutdown');
      this.ws = null;
    }

    // Update state BEFORE nulling router so we can mark state as stale
    this.updateConnectionState(ConnectionState.DISCONNECTED, 'Manual disconnect');

    if (this.router) {
      this.router.unregisterTarget(this.namespace);
      this.router.unregisterTarget('companion');
      this.router = null;
    }
  }

  // ---------------------------------------------------------------------------
  // WebSocket Connection
  // ---------------------------------------------------------------------------

  private async connectToCompanion(): Promise<void> {
    if (this.state.connectionState === ConnectionState.CONNECTING) {
      return;
    }

    this.updateConnectionState(ConnectionState.CONNECTING);

    const url = `ws://${this.config.host}:${this.config.port}`;

    try {
      this.ws = new WebSocket(url);

      // Connection timeout
      this.connectionTimeoutTimer = setTimeout(() => {
        if (this.state.connectionState === ConnectionState.CONNECTING) {
          this.ws?.close();
          this.handleConnectionError('Connection timeout');
        }
      }, this.config.connectionTimeout);

      this.ws.on('open', () => this.handleWebSocketOpen());
      this.ws.on('message', (data) => this.handleWebSocketMessage(data));
      this.ws.on('close', (code, reason) => this.handleWebSocketClose(code, reason.toString()));
      this.ws.on('error', (error) => this.handleWebSocketError(error));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown connection error';
      this.handleConnectionError(message);
    }
  }

  private handleWebSocketOpen(): void {
    this.clearTimer('connectionTimeout');

    // Send BEGIN command to register device
    this.sendSatelliteCommand(SatelliteCommand.BEGIN, [
      this.config.device.deviceId,
      this.config.device.productName,
      String(this.config.device.keysPerRow),
      String(this.config.device.keysTotal),
      String(this.config.device.bitmapSize ?? 72),
    ]);

    // Mark as connected
    this.state.serverVersion = 'unknown'; // Will be updated if server sends version
    this.state.lastConnected = Date.now();
    this.state.reconnectAttempts = 0;
    this.updateConnectionState(ConnectionState.CONNECTED);

    // Start heartbeat
    this.startHeartbeat();

    // Emit connected event
    this.emitEvent({ type: 'connected', serverVersion: this.state.serverVersion ?? 'unknown' });

    // Publish connection state to bridge
    this.publishConnectionState();
  }

  private handleWebSocketMessage(data: WebSocket.RawData): void {
    this.metrics.messagesReceived++;

    const message = data.toString();
    const parts = message.split(' ');
    const command = parts[0] as SatelliteCommand;
    const args = parts.slice(1);

    switch (command) {
      case SatelliteCommand.PONG:
        this.handlePong();
        break;

      case SatelliteCommand.KEY_STATE:
        this.handleKeyState(args);
        break;

      case SatelliteCommand.BRIGHTNESS:
        this.handleBrightness(args);
        break;

      case SatelliteCommand.VARIABLES_UPDATE:
        // Format: VARIABLES-UPDATE varName1=value1 varName2=value2 ...
        this.handleVariablesUpdate(args);
        break;

      case SatelliteCommand.ERROR:
        this.handleSatelliteError(args.join(' '));
        break;

      case SatelliteCommand.ADD_DEVICE:
        // Server acknowledges device registration
        this.detectCapabilities(args);
        break;

      default:
        // Unknown command - log but don't fail
        console.debug(`Unknown Satellite command: ${command}`);
    }
  }

  private handleWebSocketClose(code: number, reason: string): void {
    this.clearTimers();
    this.ws = null;

    const wasConnected = this.state.connectionState === ConnectionState.CONNECTED;
    this.state.lastDisconnected = Date.now();

    this.updateConnectionState(ConnectionState.DISCONNECTED, `Close code ${code}: ${reason}`);
    this.emitEvent({ type: 'disconnected', reason: `${code}: ${reason}` });

    // Mark state as stale
    if (this.router) {
      const stateStore = this.router.getStateStore();
      stateStore.markOwnerStale(this.namespace);
    }

    // Attempt reconnect if configured
    if (wasConnected && this.config.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private handleWebSocketError(error: Error): void {
    console.error('Companion WebSocket error:', error.message);
    this.state.lastError = error.message;
    this.emitEvent({ type: 'error', error: error.message });
  }

  private handleConnectionError(message: string): void {
    this.state.lastError = message;
    this.updateConnectionState(ConnectionState.ERROR, message);

    if (this.config.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  // ---------------------------------------------------------------------------
  // Satellite Protocol Handlers
  // ---------------------------------------------------------------------------

  private handleKeyState(args: string[]): void {
    // Format: KEY-STATE deviceId keyIndex [pressed] [image_base64]
    if (args.length < 2) return;

    const deviceId = args[0]!;
    const keyIndex = parseInt(args[1]!, 10);

    if (isNaN(keyIndex)) return;

    this.metrics.keyStateUpdates++;

    const keyState: SatelliteKeyState = {
      deviceId,
      keyIndex,
    };

    // Parse optional fields
    let argIndex = 2;
    while (argIndex < args.length) {
      const arg = args[argIndex]!;

      if (arg === 'PRESSED') {
        keyState.pressed = true;
      } else if (arg === 'RELEASED') {
        keyState.pressed = false;
      } else if (arg.startsWith('COLOR:')) {
        keyState.colour = arg.substring(6);
      } else if (arg.startsWith('TEXT:')) {
        keyState.text = decodeURIComponent(arg.substring(5));
      } else if (arg.startsWith('BITMAP:')) {
        keyState.image = arg.substring(7);
      }

      argIndex++;
    }

    // Update cache
    const cacheKey = `${deviceId}:${keyIndex}`;
    this.keyStatesCache.set(cacheKey, keyState);

    // Publish to bridge
    this.publishKeyState(deviceId, keyIndex, keyState);

    // Emit event
    this.emitEvent({ type: 'key_state', deviceId, keyIndex, state: keyState });
  }

  private handleVariablesUpdate(args: string[]): void {
    // Format: VARIABLES-UPDATE varName1=value1 varName2=value2 ...
    const variables: SatelliteVariable[] = [];

    for (const arg of args) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        const name = arg.substring(0, eqIndex);
        const value = decodeURIComponent(arg.substring(eqIndex + 1));
        variables.push({ name, value });

        // Update cache
        this.variablesCache.set(name, value);
      }
    }

    if (variables.length > 0) {
      this.metrics.variableUpdates++;

      // Publish each variable to bridge
      for (const v of variables) {
        this.publishVariable(v.name, v.value);
      }

      // Emit event
      this.emitEvent({ type: 'variable_update', variables });
    }
  }

  private handleBrightness(args: string[]): void {
    if (args.length < 2) return;

    const deviceId = args[0]!;
    const level = parseInt(args[1]!, 10);

    if (isNaN(level)) return;

    // Publish to bridge
    this.publishBrightness(deviceId, level);

    // Emit event
    this.emitEvent({ type: 'brightness', deviceId, level });
  }

  private handlePong(): void {
    if (this.pendingPong !== null) {
      this.metrics.lastLatencyMs = Date.now() - this.pendingPong;
      this.pendingPong = null;
    }
  }

  private handleSatelliteError(message: string): void {
    console.error('Satellite error:', message);
    this.state.lastError = message;
    this.emitEvent({ type: 'error', error: message });
  }

  private detectCapabilities(args: string[]): void {
    // Parse capabilities from ADD-DEVICE response
    const capabilities: CompanionCapabilities = { ...DEFAULT_CAPABILITIES };

    for (const arg of args) {
      if (arg.startsWith('API:')) {
        capabilities.apiVersion = arg.substring(4);
      } else if (arg === 'VARIABLES') {
        capabilities.supportsVariables = true;
        capabilities.features.push('variables');
      } else if (arg === 'ROTATION') {
        capabilities.supportsRotation = true;
        capabilities.features.push('rotation');
      } else if (arg === 'VARIABLE_WRITE') {
        capabilities.supportsVariableWrite = true;
        capabilities.features.push('variable_write');
      } else if (arg === 'KEY_IMAGES') {
        capabilities.supportsKeyImages = true;
        capabilities.features.push('key_images');
      }
    }

    this.state.capabilities = capabilities;

    // Publish capabilities to bridge
    this.publishCapabilities();

    this.emitEvent({ type: 'capabilities_detected', capabilities });
  }

  // ---------------------------------------------------------------------------
  // Bridge Message Handler
  // ---------------------------------------------------------------------------

  private async handleBridgeMessage(message: BridgeMessage): Promise<void> {
    if (!isCommandMessage(message)) {
      return; // Only handle commands
    }

    const command = message as CommandMessage;

    // Route based on action
    switch (command.payload.action) {
      case 'press':
        await this.handlePressCommand(command);
        break;

      case 'release':
        await this.handleReleaseCommand(command);
        break;

      case 'rotate':
        await this.handleRotateCommand(command);
        break;

      case 'setVariable':
        await this.handleSetVariableCommand(command);
        break;

      case 'getVariable':
        await this.handleGetVariableCommand(command);
        break;

      case 'clearKeys':
        await this.handleClearKeysCommand(command);
        break;

      default:
        // Unknown action
        this.sendErrorResponse(command, ErrorCode.ADAPTER_ERROR, `Unknown action: ${command.payload.action}`);
    }
  }

  private async handlePressCommand(command: CommandMessage): Promise<void> {
    const params = command.payload.params as { page?: number; bank?: number; keyIndex?: number } | undefined;

    let keyIndex: number;

    if (params?.keyIndex !== undefined) {
      keyIndex = params.keyIndex;
    } else if (params?.page !== undefined && params?.bank !== undefined) {
      // Convert page/bank to keyIndex (page is 1-based, bank is 0-based)
      keyIndex = (params.page - 1) * 8 + params.bank;
    } else {
      this.sendErrorResponse(command, ErrorCode.INVALID_MESSAGE, 'Missing keyIndex or page/bank parameters');
      return;
    }

    // Send press
    this.sendSatelliteCommand(SatelliteCommand.KEY_PRESS, [
      this.config.device.deviceId,
      keyIndex.toString(),
      'PRESSED',
    ]);

    this.metrics.commandsSent++;
    this.sendCompletedAck(command);
  }

  private async handleReleaseCommand(command: CommandMessage): Promise<void> {
    const params = command.payload.params as { page?: number; bank?: number; keyIndex?: number } | undefined;

    let keyIndex: number;

    if (params?.keyIndex !== undefined) {
      keyIndex = params.keyIndex;
    } else if (params?.page !== undefined && params?.bank !== undefined) {
      keyIndex = (params.page - 1) * 8 + params.bank;
    } else {
      this.sendErrorResponse(command, ErrorCode.INVALID_MESSAGE, 'Missing keyIndex or page/bank parameters');
      return;
    }

    // Send release
    this.sendSatelliteCommand(SatelliteCommand.KEY_PRESS, [
      this.config.device.deviceId,
      keyIndex.toString(),
      'RELEASED',
    ]);

    this.metrics.commandsSent++;
    this.sendCompletedAck(command);
  }

  private async handleRotateCommand(command: CommandMessage): Promise<void> {
    if (!this.state.capabilities.supportsRotation) {
      this.sendErrorResponse(command, ErrorCode.ADAPTER_ERROR, 'Rotation not supported by this Companion instance');
      return;
    }

    const params = command.payload.params as { keyIndex: number; direction: 'left' | 'right' } | undefined;

    if (!params?.keyIndex || !params?.direction) {
      this.sendErrorResponse(command, ErrorCode.INVALID_MESSAGE, 'Missing keyIndex or direction parameters');
      return;
    }

    this.sendSatelliteCommand(SatelliteCommand.KEY_ROTATE, [
      this.config.device.deviceId,
      params.keyIndex.toString(),
      params.direction === 'left' ? '-1' : '1',
    ]);

    this.metrics.commandsSent++;
    this.sendCompletedAck(command);
  }

  private async handleSetVariableCommand(command: CommandMessage): Promise<void> {
    if (!this.state.capabilities.supportsVariableWrite) {
      this.sendErrorResponse(command, ErrorCode.ADAPTER_ERROR, 'Variable write not supported');
      return;
    }

    const params = command.payload.params as { name: string; value: string } | undefined;

    if (!params?.name || params.value === undefined) {
      this.sendErrorResponse(command, ErrorCode.INVALID_MESSAGE, 'Missing name or value parameters');
      return;
    }

    this.sendSatelliteCommand(SatelliteCommand.VARIABLE_VALUE, [
      `${params.name}=${encodeURIComponent(params.value)}`,
    ]);

    this.metrics.commandsSent++;
    this.sendCompletedAck(command);
  }

  private async handleGetVariableCommand(command: CommandMessage): Promise<void> {
    const params = command.payload.params as { name: string } | undefined;

    if (!params?.name) {
      this.sendErrorResponse(command, ErrorCode.INVALID_MESSAGE, 'Missing name parameter');
      return;
    }

    const value = this.variablesCache.get(params.name);

    this.sendCompletedAck(command, { name: params.name, value: value ?? null });
  }

  private async handleClearKeysCommand(command: CommandMessage): Promise<void> {
    this.sendSatelliteCommand(SatelliteCommand.KEYS_CLEAR, [this.config.device.deviceId]);
    this.keyStatesCache.clear();

    this.metrics.commandsSent++;
    this.sendCompletedAck(command);
  }

  // ---------------------------------------------------------------------------
  // State Publishing
  // ---------------------------------------------------------------------------

  private publishConnectionState(): void {
    if (!this.router) return;

    const stateStore = this.router.getStateStore();

    stateStore.set(
      'companion.connection.state',
      this.state.connectionState,
      this.namespace
    );

    stateStore.set(
      'companion.connection.lastConnected',
      this.state.lastConnected,
      this.namespace
    );

    stateStore.set(
      'companion.connection.lastError',
      this.state.lastError,
      this.namespace
    );
  }

  private publishCapabilities(): void {
    if (!this.router) return;

    const stateStore = this.router.getStateStore();

    stateStore.set(
      'companion.capabilities',
      this.state.capabilities,
      this.namespace
    );
  }

  private publishKeyState(deviceId: string, keyIndex: number, state: SatelliteKeyState): void {
    if (!this.router) return;

    const stateStore = this.router.getStateStore();
    const path = `companion.device.${deviceId}.key.${keyIndex}`;

    stateStore.set(path, state, this.namespace);
  }

  private publishVariable(name: string, value: string): void {
    if (!this.router) return;

    const stateStore = this.router.getStateStore();

    // Normalise variable name to path-safe format
    const safeName = name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    const path = `companion.variables.${safeName}`;

    stateStore.set(path, { name, value }, this.namespace);
  }

  private publishBrightness(deviceId: string, level: number): void {
    if (!this.router) return;

    const stateStore = this.router.getStateStore();
    const path = `companion.device.${deviceId}.brightness`;

    stateStore.set(path, level, this.namespace);
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
  // Satellite Protocol Sending
  // ---------------------------------------------------------------------------

  private sendSatelliteCommand(command: SatelliteCommand, args: string[] = []): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    const message = [command, ...args].join(' ');

    try {
      this.ws.send(message);
      this.metrics.messagesSent++;
      return true;
    } catch (error) {
      console.error('Failed to send Satellite command:', error);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.pendingPong = Date.now();
        this.sendSatelliteCommand(SatelliteCommand.PING);
      }
    }, this.config.heartbeatInterval);
  }

  // ---------------------------------------------------------------------------
  // Reconnection
  // ---------------------------------------------------------------------------

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const maxAttempts = this.config.maxReconnectAttempts;
    if (maxAttempts > 0 && this.state.reconnectAttempts >= maxAttempts) {
      console.error('Max reconnect attempts reached');
      this.updateConnectionState(ConnectionState.ERROR, 'Max reconnect attempts reached');
      return;
    }

    this.state.reconnectAttempts++;
    this.metrics.reconnects++;

    this.updateConnectionState(ConnectionState.RECONNECTING);
    this.emitEvent({ type: 'reconnecting', attempt: this.state.reconnectAttempts });

    // Exponential backoff with jitter
    const baseDelay = this.config.reconnectDelay;
    const backoff = Math.min(baseDelay * Math.pow(2, this.state.reconnectAttempts - 1), 60000);
    const jitter = Math.random() * 1000;
    const delay = backoff + jitter;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectToCompanion();
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Timer Management
  // ---------------------------------------------------------------------------

  private clearTimers(): void {
    this.clearTimer('heartbeat');
    this.clearTimer('reconnect');
    this.clearTimer('connectionTimeout');
  }

  private clearTimer(name: 'heartbeat' | 'reconnect' | 'connectionTimeout'): void {
    switch (name) {
      case 'heartbeat':
        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
        break;
      case 'reconnect':
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        break;
      case 'connectionTimeout':
        if (this.connectionTimeoutTimer) {
          clearTimeout(this.connectionTimeoutTimer);
          this.connectionTimeoutTimer = null;
        }
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // State Updates
  // ---------------------------------------------------------------------------

  private updateConnectionState(state: ConnectionState, reason?: string): void {
    const previousState = this.state.connectionState;
    this.state.connectionState = state;

    if (reason && state === ConnectionState.ERROR) {
      this.state.lastError = reason;
    }

    // Emit disconnected event when transitioning to DISCONNECTED
    if (state === ConnectionState.DISCONNECTED && previousState !== ConnectionState.DISCONNECTED) {
      this.state.lastDisconnected = Date.now();

      // Mark state as stale
      if (this.router) {
        this.markStateAsStale();
      }

      this.emitEvent({ type: 'disconnected', reason: reason ?? 'Connection closed' });
    }
  }

  /**
   * Mark all companion state entries as stale.
   */
  private markStateAsStale(): void {
    if (!this.router) return;

    const store = this.router.getStateStore();
    store.markOwnerStale(this.namespace);
  }

  // ---------------------------------------------------------------------------
  // Event Emission
  // ---------------------------------------------------------------------------

  private emitEvent(event: CompanionAdapterEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Add an event handler.
   */
  onEvent(handler: CompanionAdapterEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Remove an event handler.
   */
  offEvent(handler: CompanionAdapterEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Get current adapter state.
   */
  getState(): Readonly<CompanionAdapterState> {
    return { ...this.state };
  }

  /**
   * Get current metrics.
   */
  getMetrics(): Readonly<CompanionMetrics> {
    return { ...this.metrics };
  }

  /**
   * Get current capabilities.
   */
  getCapabilities(): Readonly<CompanionCapabilities> {
    return { ...this.state.capabilities };
  }

  /**
   * Get cached variable value.
   */
  getVariable(name: string): string | undefined {
    return this.variablesCache.get(name);
  }

  /**
   * Get all cached variables.
   */
  getVariables(): Map<string, string> {
    return new Map(this.variablesCache);
  }

  /**
   * Get cached key state.
   */
  getKeyState(deviceId: string, keyIndex: number): SatelliteKeyState | undefined {
    return this.keyStatesCache.get(`${deviceId}:${keyIndex}`);
  }

  /**
   * Check if adapter is connected.
   */
  isConnected(): boolean {
    return this.state.connectionState === ConnectionState.CONNECTED;
  }

  /**
   * Get adapter configuration.
   */
  getConfig(): Readonly<CompanionAdapterConfig> {
    return { ...this.config };
  }
}
