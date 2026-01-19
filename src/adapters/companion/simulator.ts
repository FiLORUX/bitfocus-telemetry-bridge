/**
 * Companion Simulator
 *
 * Mock implementation of Companion's Satellite API for testing.
 * Provides deterministic, scriptable behaviour for automated tests.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type {
  SatelliteDeviceInfo,
  SatelliteKeyState,
  SatelliteVariable,
} from './types.js';
import { SatelliteCommand } from './types.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface SimulatorConfig {
  /** Port to listen on */
  port: number;
  /** Simulated API version */
  apiVersion: string;
  /** Initial variables to expose */
  initialVariables?: Record<string, string>;
  /** Whether to support variable writes */
  supportVariableWrite: boolean;
  /** Whether to support rotation */
  supportRotation: boolean;
  /** Response delay (ms) for simulating latency */
  responseDelay: number;
  /** Whether to auto-send key states on connection */
  autoSendKeyStates: boolean;
}

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  port: 16622,
  apiVersion: '1.0.0',
  supportVariableWrite: true,
  supportRotation: false,
  responseDelay: 0,
  autoSendKeyStates: true,
};

export interface SimulatorClient {
  id: string;
  ws: WebSocket;
  device: SatelliteDeviceInfo | null;
  connectedAt: number;
}

export interface SimulatorEvent {
  type: 'client_connected' | 'client_disconnected' | 'key_press' | 'key_rotate' | 'variable_set' | 'message_received';
  clientId: string;
  data?: unknown;
  timestamp: number;
}

export type SimulatorEventHandler = (event: SimulatorEvent) => void;

// -----------------------------------------------------------------------------
// Companion Simulator
// -----------------------------------------------------------------------------

export class CompanionSimulator {
  private readonly config: SimulatorConfig;
  private server: WebSocketServer | null = null;
  private clients: Map<string, SimulatorClient> = new Map();
  private eventHandlers: Set<SimulatorEventHandler> = new Set();

  /** Simulated variables */
  private variables: Map<string, string> = new Map();

  /** Simulated key states */
  private keyStates: Map<string, SatelliteKeyState> = new Map();

  /** Script queue for automated testing */
  private scriptQueue: Array<() => void | Promise<void>> = [];
  private scriptRunning = false;

  /** Event log for verification */
  private eventLog: SimulatorEvent[] = [];

  private clientIdCounter = 0;

  constructor(config: Partial<SimulatorConfig> = {}) {
    this.config = { ...DEFAULT_SIMULATOR_CONFIG, ...config };

    // Initialise variables
    if (this.config.initialVariables) {
      for (const [name, value] of Object.entries(this.config.initialVariables)) {
        this.variables.set(name, value);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start the simulator server.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = new WebSocketServer({ port: this.config.port });

        this.server.on('connection', (ws, req) => this.handleConnection(ws, req));

        this.server.on('listening', () => {
          console.log(`Companion Simulator listening on port ${this.config.port}`);
          resolve();
        });

        this.server.on('error', (error) => {
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the simulator server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Close all client connections
      for (const client of this.clients.values()) {
        client.ws.close(1000, 'Server shutdown');
      }
      this.clients.clear();

      // Close server
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Connection Handling
  // ---------------------------------------------------------------------------

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = `client-${++this.clientIdCounter}`;

    const client: SimulatorClient = {
      id: clientId,
      ws,
      device: null,
      connectedAt: Date.now(),
    };

    this.clients.set(clientId, client);

    ws.on('message', (data) => this.handleMessage(client, data.toString()));
    ws.on('close', () => this.handleDisconnect(client));
    ws.on('error', (error) => console.error(`Client ${clientId} error:`, error));

    this.emitEvent({
      type: 'client_connected',
      clientId,
      timestamp: Date.now(),
    });
  }

  private handleDisconnect(client: SimulatorClient): void {
    this.clients.delete(client.id);

    this.emitEvent({
      type: 'client_disconnected',
      clientId: client.id,
      timestamp: Date.now(),
    });
  }

  private handleMessage(client: SimulatorClient, message: string): void {
    const parts = message.split(' ');
    const command = parts[0] as SatelliteCommand;
    const args = parts.slice(1);

    this.emitEvent({
      type: 'message_received',
      clientId: client.id,
      data: { command, args },
      timestamp: Date.now(),
    });

    // Apply response delay
    const respond = () => this.processCommand(client, command, args);

    if (this.config.responseDelay > 0) {
      setTimeout(respond, this.config.responseDelay);
    } else {
      respond();
    }
  }

  private processCommand(client: SimulatorClient, command: SatelliteCommand, args: string[]): void {
    switch (command) {
      case SatelliteCommand.BEGIN:
        this.handleBegin(client, args);
        break;

      case SatelliteCommand.KEY_PRESS:
        this.handleKeyPress(client, args);
        break;

      case SatelliteCommand.KEY_ROTATE:
        this.handleKeyRotate(client, args);
        break;

      case SatelliteCommand.VARIABLE_VALUE:
        this.handleVariableValue(client, args);
        break;

      case SatelliteCommand.PING:
        this.handlePing(client);
        break;

      case SatelliteCommand.KEYS_CLEAR:
        this.handleKeysClear(client, args);
        break;

      default:
        this.sendError(client, `Unknown command: ${command}`);
    }
  }

  private handleBegin(client: SimulatorClient, args: string[]): void {
    // Parse device info: deviceId productName keysPerRow keysTotal [bitmapSize]
    if (args.length < 4) {
      this.sendError(client, 'BEGIN requires at least 4 arguments');
      return;
    }

    client.device = {
      deviceId: args[0]!,
      productName: args[1]!,
      keysPerRow: parseInt(args[2]!, 10),
      keysTotal: parseInt(args[3]!, 10),
      bitmapSize: args[4] ? parseInt(args[4], 10) : undefined,
    };

    // Send ADD-DEVICE response with capabilities
    const capabilities: string[] = [`API:${this.config.apiVersion}`, 'VARIABLES', 'KEY_IMAGES'];

    if (this.config.supportVariableWrite) {
      capabilities.push('VARIABLE_WRITE');
    }

    if (this.config.supportRotation) {
      capabilities.push('ROTATION');
    }

    this.send(client, `${SatelliteCommand.ADD_DEVICE} ${client.device.deviceId} ${capabilities.join(' ')}`);

    // Send initial variables
    if (this.variables.size > 0) {
      const varUpdates = Array.from(this.variables.entries())
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join(' ');

      this.send(client, `${SatelliteCommand.VARIABLES_UPDATE} ${varUpdates}`);
    }

    // Send initial key states if configured
    if (this.config.autoSendKeyStates) {
      for (const [key, state] of this.keyStates) {
        this.sendKeyState(client, state);
      }
    }
  }

  private handleKeyPress(client: SimulatorClient, args: string[]): void {
    // Format: KEY-PRESS deviceId keyIndex PRESSED|RELEASED
    if (args.length < 3) {
      this.sendError(client, 'KEY-PRESS requires 3 arguments');
      return;
    }

    const deviceId = args[0]!;
    const keyIndex = parseInt(args[1]!, 10);
    const action = args[2];

    this.emitEvent({
      type: 'key_press',
      clientId: client.id,
      data: { deviceId, keyIndex, action },
      timestamp: Date.now(),
    });

    // Echo back key state
    const state: SatelliteKeyState = {
      deviceId,
      keyIndex,
      pressed: action === 'PRESSED',
    };

    this.keyStates.set(`${deviceId}:${keyIndex}`, state);
    this.sendKeyState(client, state);
  }

  private handleKeyRotate(client: SimulatorClient, args: string[]): void {
    if (!this.config.supportRotation) {
      this.sendError(client, 'Rotation not supported');
      return;
    }

    if (args.length < 3) {
      this.sendError(client, 'KEY-ROTATE requires 3 arguments');
      return;
    }

    const deviceId = args[0]!;
    const keyIndex = parseInt(args[1]!, 10);
    const direction = parseInt(args[2]!, 10);

    this.emitEvent({
      type: 'key_rotate',
      clientId: client.id,
      data: { deviceId, keyIndex, direction },
      timestamp: Date.now(),
    });
  }

  private handleVariableValue(client: SimulatorClient, args: string[]): void {
    if (!this.config.supportVariableWrite) {
      this.sendError(client, 'Variable write not supported');
      return;
    }

    // Format: VARIABLE-VALUE name=value [name2=value2] ...
    for (const arg of args) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex > 0) {
        const name = arg.substring(0, eqIndex);
        const value = decodeURIComponent(arg.substring(eqIndex + 1));

        this.variables.set(name, value);

        this.emitEvent({
          type: 'variable_set',
          clientId: client.id,
          data: { name, value },
          timestamp: Date.now(),
        });
      }
    }
  }

  private handlePing(client: SimulatorClient): void {
    this.send(client, SatelliteCommand.PONG);
  }

  private handleKeysClear(client: SimulatorClient, args: string[]): void {
    const deviceId = args[0] ?? client.device?.deviceId;

    if (deviceId) {
      // Clear all keys for device
      for (const [key] of this.keyStates) {
        if (key.startsWith(`${deviceId}:`)) {
          this.keyStates.delete(key);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Sending Messages
  // ---------------------------------------------------------------------------

  private send(client: SimulatorClient, message: string): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }

  private sendError(client: SimulatorClient, message: string): void {
    this.send(client, `${SatelliteCommand.ERROR} ${message}`);
  }

  private sendKeyState(client: SimulatorClient, state: SatelliteKeyState): void {
    const parts = [
      SatelliteCommand.KEY_STATE,
      state.deviceId,
      state.keyIndex.toString(),
    ];

    if (state.pressed !== undefined) {
      parts.push(state.pressed ? 'PRESSED' : 'RELEASED');
    }

    if (state.colour) {
      parts.push(`COLOR:${state.colour}`);
    }

    if (state.text) {
      parts.push(`TEXT:${encodeURIComponent(state.text)}`);
    }

    if (state.image) {
      parts.push(`BITMAP:${state.image}`);
    }

    this.send(client, parts.join(' '));
  }

  // ---------------------------------------------------------------------------
  // Public Simulation API
  // ---------------------------------------------------------------------------

  /**
   * Simulate a variable update from Companion.
   */
  setVariable(name: string, value: string): void {
    this.variables.set(name, value);

    // Broadcast to all clients
    const update = `${SatelliteCommand.VARIABLES_UPDATE} ${name}=${encodeURIComponent(value)}`;

    for (const client of this.clients.values()) {
      if (client.device) {
        this.send(client, update);
      }
    }
  }

  /**
   * Simulate multiple variable updates.
   */
  setVariables(variables: Record<string, string>): void {
    const updates: string[] = [];

    for (const [name, value] of Object.entries(variables)) {
      this.variables.set(name, value);
      updates.push(`${name}=${encodeURIComponent(value)}`);
    }

    if (updates.length > 0) {
      const message = `${SatelliteCommand.VARIABLES_UPDATE} ${updates.join(' ')}`;

      for (const client of this.clients.values()) {
        if (client.device) {
          this.send(client, message);
        }
      }
    }
  }

  /**
   * Simulate a key state update from Companion.
   */
  setKeyState(state: SatelliteKeyState): void {
    this.keyStates.set(`${state.deviceId}:${state.keyIndex}`, state);

    for (const client of this.clients.values()) {
      if (client.device) {
        this.sendKeyState(client, state);
      }
    }
  }

  /**
   * Simulate a brightness change.
   */
  setBrightness(deviceId: string, level: number): void {
    const message = `${SatelliteCommand.BRIGHTNESS} ${deviceId} ${level}`;

    for (const client of this.clients.values()) {
      if (client.device) {
        this.send(client, message);
      }
    }
  }

  /**
   * Get current variable value.
   */
  getVariable(name: string): string | undefined {
    return this.variables.get(name);
  }

  /**
   * Get all variables.
   */
  getVariables(): Map<string, string> {
    return new Map(this.variables);
  }

  /**
   * Get connected clients.
   */
  getClients(): SimulatorClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get client count.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  // ---------------------------------------------------------------------------
  // Scripting API
  // ---------------------------------------------------------------------------

  /**
   * Add a scripted action to the queue.
   */
  script(action: () => void | Promise<void>): this {
    this.scriptQueue.push(action);
    return this;
  }

  /**
   * Add a delay to the script queue.
   */
  delay(ms: number): this {
    this.scriptQueue.push(() => new Promise((resolve) => setTimeout(resolve, ms)));
    return this;
  }

  /**
   * Execute all queued script actions.
   */
  async runScript(): Promise<void> {
    if (this.scriptRunning) {
      throw new Error('Script already running');
    }

    this.scriptRunning = true;

    try {
      while (this.scriptQueue.length > 0) {
        const action = this.scriptQueue.shift()!;
        await action();
      }
    } finally {
      this.scriptRunning = false;
    }
  }

  /**
   * Clear the script queue.
   */
  clearScript(): void {
    this.scriptQueue = [];
  }

  // ---------------------------------------------------------------------------
  // Event Handling
  // ---------------------------------------------------------------------------

  /**
   * Add an event handler.
   */
  onEvent(handler: SimulatorEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Remove an event handler.
   */
  offEvent(handler: SimulatorEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emitEvent(event: SimulatorEvent): void {
    this.eventLog.push(event);

    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Simulator event handler error:', error);
      }
    }
  }

  /**
   * Get the event log.
   */
  getEventLog(): SimulatorEvent[] {
    return [...this.eventLog];
  }

  /**
   * Clear the event log.
   */
  clearEventLog(): void {
    this.eventLog = [];
  }

  /**
   * Wait for a specific event type.
   */
  async waitForEvent(
    type: SimulatorEvent['type'],
    timeout = 5000
  ): Promise<SimulatorEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.offEvent(handler);
        reject(new Error(`Timeout waiting for event: ${type}`));
      }, timeout);

      const handler: SimulatorEventHandler = (event) => {
        if (event.type === type) {
          clearTimeout(timer);
          this.offEvent(handler);
          resolve(event);
        }
      };

      this.onEvent(handler);
    });
  }

  /**
   * Check if running.
   */
  isRunning(): boolean {
    return this.server !== null;
  }
}
