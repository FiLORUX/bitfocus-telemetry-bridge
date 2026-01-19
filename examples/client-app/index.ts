#!/usr/bin/env npx tsx

/**
 * Example Client Application
 *
 * Demonstrates how to connect to the Telemetry Bridge, subscribe to state,
 * send commands, and react to state changes.
 */

import WebSocket from 'ws';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const BRIDGE_URL = process.env['BRIDGE_URL'] ?? 'ws://localhost:9000';
const CLIENT_NAME = process.env['CLIENT_NAME'] ?? 'example-app';
const AUTH_TOKEN = process.env['AUTH_TOKEN'];

// -----------------------------------------------------------------------------
// Types (subset of Bridge Protocol)
// -----------------------------------------------------------------------------

interface BridgeMessage {
  id: string;
  type: 'command' | 'event' | 'state' | 'ack' | 'error' | 'subscribe' | 'unsubscribe';
  source: string;
  target?: string;
  path: string;
  payload: unknown;
  timestamp: number;
  correlationId?: string;
  sequence: number;
  ttl?: number;
  idempotencyKey?: string;
}

interface ClientHandshake {
  type: 'handshake';
  name: string;
  version: string;
  authToken?: string;
}

interface ServerHandshake {
  type: 'handshake_response';
  success: boolean;
  sessionId?: string;
  namespace?: string;
  serverVersion: string;
  error?: string;
}

// -----------------------------------------------------------------------------
// Client Class
// -----------------------------------------------------------------------------

class TelemetryBridgeClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private namespace: string | null = null;
  private sequence = 0;
  private connected = false;

  /** State cache */
  private state: Map<string, unknown> = new Map();

  /** Pending command callbacks */
  private pendingCommands: Map<string, { resolve: (ack: any) => void; reject: (err: Error) => void }> =
    new Map();

  constructor(
    private readonly url: string,
    private readonly name: string,
    private readonly authToken?: string
  ) {}

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`Connecting to ${this.url}...`);

      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        // Send handshake
        const handshake: ClientHandshake = {
          type: 'handshake',
          name: this.name,
          version: '1.0.0',
          authToken: this.authToken,
        };

        this.ws!.send(JSON.stringify(handshake));
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          // Handle handshake response
          if (message.type === 'handshake_response') {
            const response = message as ServerHandshake;

            if (response.success) {
              this.sessionId = response.sessionId ?? null;
              this.namespace = response.namespace ?? null;
              this.connected = true;
              console.log(`Connected! Session: ${this.sessionId}, Namespace: ${this.namespace}`);
              resolve();
            } else {
              reject(new Error(response.error ?? 'Handshake failed'));
            }
            return;
          }

          // Handle other messages
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`Disconnected: ${code} - ${reason}`);
        this.connected = false;
      });
    });
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  // ---------------------------------------------------------------------------
  // Message Handling
  // ---------------------------------------------------------------------------

  private handleMessage(message: BridgeMessage): void {
    switch (message.type) {
      case 'state':
        this.handleState(message);
        break;

      case 'event':
        this.handleEvent(message);
        break;

      case 'ack':
        this.handleAck(message);
        break;

      case 'error':
        this.handleError(message);
        break;
    }
  }

  private handleState(message: BridgeMessage): void {
    const payload = message.payload as { value: unknown; stale?: boolean };

    if (payload.stale) {
      console.log(`[STATE STALE] ${message.path}`);
    } else {
      this.state.set(message.path, payload.value);
      console.log(`[STATE] ${message.path} = ${JSON.stringify(payload.value)}`);
    }

    // React to specific state changes
    this.onStateChange(message.path, payload.value);
  }

  private handleEvent(message: BridgeMessage): void {
    const payload = message.payload as { event: string; data?: unknown };
    console.log(`[EVENT] ${payload.event} @ ${message.path}`, payload.data ?? '');

    // Handle snapshot complete
    if (payload.event === 'snapshot_complete') {
      console.log('Snapshot complete - ready for real-time updates');
    }
  }

  private handleAck(message: BridgeMessage): void {
    const payload = message.payload as { status: string; commandId: string; result?: unknown; error?: unknown };
    console.log(`[ACK] ${payload.status} for command ${payload.commandId}`);

    const pending = this.pendingCommands.get(payload.commandId);
    if (pending) {
      this.pendingCommands.delete(payload.commandId);

      if (payload.status === 'completed') {
        pending.resolve(payload);
      } else if (payload.status === 'failed') {
        pending.reject(new Error(JSON.stringify(payload.error)));
      }
    }
  }

  private handleError(message: BridgeMessage): void {
    const payload = message.payload as { code: string; message: string };
    console.error(`[ERROR] ${payload.code}: ${payload.message}`);
  }

  // ---------------------------------------------------------------------------
  // Subscription
  // ---------------------------------------------------------------------------

  async subscribe(patterns: string[], snapshot = true): Promise<void> {
    const message: BridgeMessage = {
      id: this.generateId(),
      type: 'subscribe',
      source: this.namespace!,
      path: 'hub.subscriptions',
      payload: {
        patterns,
        filter: 'all',
        snapshot,
      },
      timestamp: Date.now(),
      sequence: this.sequence++,
    };

    this.send(message);
    console.log(`Subscribed to: ${patterns.join(', ')}`);
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async sendCommand(
    target: string,
    path: string,
    action: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const commandId = this.generateId();
    const idempotencyKey = `${action}-${path}-${Date.now()}`;

    const message: BridgeMessage = {
      id: commandId,
      type: 'command',
      source: this.namespace!,
      target,
      path,
      payload: {
        action,
        params,
      },
      timestamp: Date.now(),
      sequence: this.sequence++,
      ttl: 5000,
      idempotencyKey,
    };

    return new Promise((resolve, reject) => {
      this.pendingCommands.set(commandId, { resolve, reject });

      // Timeout
      setTimeout(() => {
        if (this.pendingCommands.has(commandId)) {
          this.pendingCommands.delete(commandId);
          reject(new Error('Command timeout'));
        }
      }, 10000);

      this.send(message);
      console.log(`Sent command: ${action} -> ${target}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Application Logic
  // ---------------------------------------------------------------------------

  private onStateChange(path: string, value: unknown): void {
    // Example: React to tally changes
    if (path.includes('tally_pgm')) {
      console.log(`\n*** PROGRAM TALLY CHANGED: ${value} ***\n`);
    }

    // Example: React to button presses
    if (path.includes('.key.') && typeof value === 'object' && value !== null) {
      const state = value as { pressed?: boolean };
      if (state.pressed) {
        console.log(`\n*** KEY PRESSED: ${path} ***\n`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private send(message: BridgeMessage): void {
    if (!this.ws || !this.connected) {
      throw new Error('Not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  private generateId(): string {
    // Simple UUID-like ID
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  getState(path: string): unknown {
    return this.state.get(path);
  }

  getAllState(): Map<string, unknown> {
    return new Map(this.state);
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = new TelemetryBridgeClient(BRIDGE_URL, CLIENT_NAME, AUTH_TOKEN);

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    client.disconnect();
    process.exit(0);
  });

  try {
    // Connect
    await client.connect();

    // Subscribe to Companion variables and key states
    await client.subscribe([
      'companion.variables.**',
      'companion.device.*.key.*',
      'companion.connection.*',
    ]);

    // Wait for snapshot
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Print current state
    console.log('\n=== Current State ===');
    for (const [path, value] of client.getAllState()) {
      console.log(`${path}: ${JSON.stringify(value)}`);
    }
    console.log('=====================\n');

    // Example: Send a command to press button 0 on page 1
    console.log('Sending test command...');
    try {
      const result = await client.sendCommand(
        'companion.satellite',
        'companion.page.1.bank.0',
        'press',
        { keyIndex: 0 }
      );
      console.log('Command result:', result);
    } catch (error) {
      console.error('Command failed:', error);
    }

    // Keep running and watching for changes
    console.log('\nWatching for state changes... (Ctrl+C to exit)\n');

    // Keep alive
    await new Promise(() => {});
  } catch (error) {
    console.error('Error:', error);
    client.disconnect();
    process.exit(1);
  }
}

main();
