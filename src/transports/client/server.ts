/**
 * Client Transport Server
 *
 * WebSocket server for client application connections.
 * Handles authentication, session management, and message routing.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { BridgeMessage } from '../../core/protocol/types.js';
import { validateMessage, MessageType } from '../../core/protocol/types.js';
import { generateUuidV7 } from '../../core/protocol/factory.js';
import type { MessageRouter } from '../../core/router/router.js';
import type {
  ClientSession,
  ClientTransportConfig,
  ClientTransportEvent,
  ClientTransportEventHandler,
  ClientTransportMetrics,
  ClientHandshake,
  ServerHandshake,
} from './types.js';
import { DEFAULT_CLIENT_TRANSPORT_CONFIG, INITIAL_TRANSPORT_METRICS } from './types.js';

// -----------------------------------------------------------------------------
// Version
// -----------------------------------------------------------------------------

const SERVER_VERSION = '0.1.0';

// -----------------------------------------------------------------------------
// Client Transport Server
// -----------------------------------------------------------------------------

export class ClientTransportServer {
  private readonly config: ClientTransportConfig;
  private server: WebSocketServer | null = null;
  private router: MessageRouter | null = null;

  /** Active client sessions */
  private sessions: Map<string, ClientSession> = new Map();

  /** WebSocket -> Session ID mapping */
  private wsToSession: Map<WebSocket, string> = new Map();

  /** Event handlers */
  private eventHandlers: Set<ClientTransportEventHandler> = new Set();

  /** Metrics */
  private metrics: ClientTransportMetrics = { ...INITIAL_TRANSPORT_METRICS };

  /** Heartbeat timer */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** Idle check timer */
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<ClientTransportConfig> = {}) {
    this.config = { ...DEFAULT_CLIENT_TRANSPORT_CONFIG, ...config };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start the transport server.
   */
  async start(router: MessageRouter): Promise<void> {
    this.router = router;

    return new Promise((resolve, reject) => {
      try {
        this.server = new WebSocketServer({
          port: this.config.port,
          host: this.config.host,
          maxPayload: this.config.maxMessageSize,
          perMessageDeflate: this.config.enableCompression,
        });

        this.server.on('connection', (ws, req) => this.handleConnection(ws, req));

        this.server.on('listening', () => {
          console.log(`Client transport listening on ${this.config.host}:${this.config.port}`);

          // Start heartbeat
          this.startHeartbeat();

          // Start idle check
          this.startIdleCheck();

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
   * Stop the transport server.
   */
  async stop(): Promise<void> {
    // Stop timers
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }

    // Disconnect all clients
    for (const [ws, sessionId] of this.wsToSession) {
      ws.close(1001, 'Server shutdown');
    }

    this.sessions.clear();
    this.wsToSession.clear();

    // Close server
    return new Promise((resolve) => {
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
    // Check max clients
    if (this.sessions.size >= this.config.maxClients) {
      ws.close(1013, 'Maximum clients reached');
      return;
    }

    this.metrics.totalConnections++;

    // Wait for handshake
    let handshakeTimeout = setTimeout(() => {
      ws.close(4000, 'Handshake timeout');
    }, 10000);

    const handleFirstMessage = (data: WebSocket.RawData) => {
      clearTimeout(handshakeTimeout);
      ws.off('message', handleFirstMessage);

      try {
        const message = JSON.parse(data.toString());

        if (message.type !== 'handshake') {
          ws.close(4001, 'Expected handshake');
          return;
        }

        this.processHandshake(ws, message as ClientHandshake);
      } catch (error) {
        ws.close(4002, 'Invalid handshake');
      }
    };

    ws.on('message', handleFirstMessage);

    ws.on('error', (error) => {
      const sessionId = this.wsToSession.get(ws);
      this.emitEvent({
        type: 'error',
        sessionId,
        error: error.message,
      });
    });
  }

  private processHandshake(ws: WebSocket, handshake: ClientHandshake): void {
    // Check authentication if required
    if (this.config.requireAuth) {
      if (!handshake.authToken || !this.config.authTokens.includes(handshake.authToken)) {
        this.metrics.authFailures++;

        const response: ServerHandshake = {
          type: 'handshake_response',
          success: false,
          serverVersion: SERVER_VERSION,
          error: 'Authentication failed',
        };

        ws.send(JSON.stringify(response));
        ws.close(4003, 'Authentication failed');
        return;
      }
    }

    // Create session
    const sessionId = generateUuidV7();
    const sanitisedName = this.sanitiseName(handshake.name);
    const namespace = `app.${sanitisedName}`;

    const session: ClientSession = {
      id: sessionId,
      name: sanitisedName,
      namespace,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      authToken: handshake.authToken,
      metadata: handshake.metadata ?? {},
      subscriptions: new Set(),
      sequence: 0,
      rateLimitState: {
        messageCount: 0,
        windowStart: Date.now(),
        throttled: false,
      },
    };

    this.sessions.set(sessionId, session);
    this.wsToSession.set(ws, sessionId);

    // Register with router
    this.router?.registerTarget({
      id: sessionId,
      namespace,
      handler: (message) => this.sendToClient(ws, session, message),
    });

    // Send handshake response
    const response: ServerHandshake = {
      type: 'handshake_response',
      success: true,
      sessionId,
      namespace,
      serverVersion: SERVER_VERSION,
    };

    ws.send(JSON.stringify(response));

    // Set up message handler
    ws.on('message', (data) => this.handleMessage(ws, session, data));
    ws.on('close', (code, reason) => this.handleDisconnect(ws, session, code, reason.toString()));

    this.metrics.connectedClients++;

    this.emitEvent({
      type: 'client_connected',
      session,
    });

    if (this.config.requireAuth) {
      this.emitEvent({
        type: 'client_authenticated',
        sessionId,
      });
    }
  }

  private handleMessage(ws: WebSocket, session: ClientSession, data: WebSocket.RawData): void {
    session.lastActivity = Date.now();
    this.metrics.messagesReceived++;

    // Check rate limit
    if (this.isRateLimited(session)) {
      this.metrics.rateLimitViolations++;
      this.emitEvent({ type: 'rate_limited', sessionId: session.id });
      return;
    }

    try {
      const parsed = JSON.parse(data.toString());

      // Handle ping/pong
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        return;
      }

      if (parsed.type === 'pong') {
        return;
      }

      // Validate as Bridge message
      const validation = validateMessage(parsed);
      if (!validation.success) {
        this.sendError(ws, session, 'INVALID_MESSAGE', validation.error ?? 'Validation failed');
        return;
      }

      const message = validation.data!;

      // Inject source if not set
      if (!message.source || message.source !== session.namespace) {
        (message as { source: string }).source = session.namespace;
      }

      this.emitEvent({
        type: 'message_received',
        sessionId: session.id,
        message,
      });

      // Route through hub
      this.router?.route(message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Parse error';
      this.sendError(ws, session, 'PARSE_ERROR', errorMessage);
    }
  }

  private handleDisconnect(
    ws: WebSocket,
    session: ClientSession,
    code: number,
    reason: string
  ): void {
    // Unregister from router
    this.router?.unregisterTarget(session.namespace);

    // Clean up
    this.sessions.delete(session.id);
    this.wsToSession.delete(ws);

    this.metrics.connectedClients--;
    this.metrics.totalDisconnections++;

    this.emitEvent({
      type: 'client_disconnected',
      sessionId: session.id,
      reason: `${code}: ${reason}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Message Sending
  // ---------------------------------------------------------------------------

  private sendToClient(ws: WebSocket, session: ClientSession, message: BridgeMessage): void {
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      ws.send(JSON.stringify(message));
      this.metrics.messagesSent++;

      this.emitEvent({
        type: 'message_sent',
        sessionId: session.id,
        message,
      });
    } catch (error) {
      console.error(`Failed to send to client ${session.id}:`, error);
    }
  }

  private sendError(ws: WebSocket, session: ClientSession, code: string, message: string): void {
    const error = {
      type: 'error',
      code,
      message,
      timestamp: Date.now(),
    };

    try {
      ws.send(JSON.stringify(error));
    } catch (err) {
      console.error(`Failed to send error to client ${session.id}:`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // Rate Limiting
  // ---------------------------------------------------------------------------

  private isRateLimited(session: ClientSession): boolean {
    const now = Date.now();
    const state = session.rateLimitState;

    // Reset window if expired
    if (now - state.windowStart > this.config.rateLimitWindow) {
      state.messageCount = 0;
      state.windowStart = now;
      state.throttled = false;
    }

    // Check limit
    state.messageCount++;

    if (state.messageCount > this.config.rateLimit) {
      state.throttled = true;
      return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Heartbeat & Idle
  // ---------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const ping = JSON.stringify({ type: 'ping', timestamp: Date.now() });

      for (const [ws] of this.wsToSession) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(ping);
        }
      }
    }, this.config.heartbeatInterval);
  }

  private startIdleCheck(): void {
    this.idleCheckTimer = setInterval(() => {
      const now = Date.now();

      for (const [ws, sessionId] of this.wsToSession) {
        const session = this.sessions.get(sessionId);
        if (session && now - session.lastActivity > this.config.idleTimeout) {
          ws.close(4004, 'Idle timeout');
        }
      }
    }, 60000); // Check every minute
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private sanitiseName(name: string): string {
    // Convert to lowercase, replace invalid characters
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 32) || 'client';
  }

  // ---------------------------------------------------------------------------
  // Event Handling
  // ---------------------------------------------------------------------------

  onEvent(handler: ClientTransportEventHandler): void {
    this.eventHandlers.add(handler);
  }

  offEvent(handler: ClientTransportEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  private emitEvent(event: ClientTransportEvent): void {
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
   * Get all active sessions.
   */
  getSessions(): ClientSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session by ID.
   */
  getSession(sessionId: string): ClientSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get session count.
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get metrics.
   */
  getMetrics(): Readonly<ClientTransportMetrics> {
    return { ...this.metrics };
  }

  /**
   * Disconnect a specific client.
   */
  disconnectClient(sessionId: string, reason = 'Disconnected by server'): boolean {
    for (const [ws, sid] of this.wsToSession) {
      if (sid === sessionId) {
        ws.close(4005, reason);
        return true;
      }
    }
    return false;
  }

  /**
   * Broadcast a message to all connected clients.
   */
  broadcast(message: BridgeMessage): void {
    const data = JSON.stringify(message);

    for (const [ws] of this.wsToSession) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  /**
   * Check if running.
   */
  isRunning(): boolean {
    return this.server !== null;
  }
}
