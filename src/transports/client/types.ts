/**
 * Client Transport Types
 *
 * Type definitions for the client-facing WebSocket API.
 */

import type { BridgeMessage, SubscriptionFilter } from '../../core/protocol/types.js';

// -----------------------------------------------------------------------------
// Client Session Types
// -----------------------------------------------------------------------------

export interface ClientSession {
  /** Unique session ID */
  id: string;
  /** Client-provided name/identifier */
  name: string;
  /** Assigned namespace (app.<name>) */
  namespace: string;
  /** Connection timestamp */
  connectedAt: number;
  /** Last activity timestamp */
  lastActivity: number;
  /** Authentication token (if provided) */
  authToken?: string;
  /** Client metadata */
  metadata: Record<string, unknown>;
  /** Active subscription IDs */
  subscriptions: Set<string>;
  /** Message sequence counter */
  sequence: number;
  /** Rate limit state */
  rateLimitState: RateLimitState;
}

export interface RateLimitState {
  /** Messages sent in current window */
  messageCount: number;
  /** Window start timestamp */
  windowStart: number;
  /** Whether currently throttled */
  throttled: boolean;
}

// -----------------------------------------------------------------------------
// Transport Configuration
// -----------------------------------------------------------------------------

export interface ClientTransportConfig {
  /** Port to listen on */
  port: number;
  /** Host to bind to */
  host: string;
  /** Maximum concurrent clients */
  maxClients: number;
  /** Message rate limit (messages per second) */
  rateLimit: number;
  /** Rate limit window (ms) */
  rateLimitWindow: number;
  /** Idle timeout (ms) - disconnect after inactivity */
  idleTimeout: number;
  /** Require authentication token */
  requireAuth: boolean;
  /** Valid auth tokens (if requireAuth) */
  authTokens: string[];
  /** Enable compression */
  enableCompression: boolean;
  /** Maximum message size (bytes) */
  maxMessageSize: number;
  /** Heartbeat interval (ms) */
  heartbeatInterval: number;
}

export const DEFAULT_CLIENT_TRANSPORT_CONFIG: ClientTransportConfig = {
  port: 9000,
  host: '0.0.0.0',
  maxClients: 100,
  rateLimit: 100,
  rateLimitWindow: 1000,
  idleTimeout: 300000, // 5 minutes
  requireAuth: false,
  authTokens: [],
  enableCompression: true,
  maxMessageSize: 1024 * 1024, // 1MB
  heartbeatInterval: 30000,
};

// -----------------------------------------------------------------------------
// Transport Events
// -----------------------------------------------------------------------------

export type ClientTransportEvent =
  | { type: 'client_connected'; session: ClientSession }
  | { type: 'client_disconnected'; sessionId: string; reason: string }
  | { type: 'client_authenticated'; sessionId: string }
  | { type: 'message_received'; sessionId: string; message: BridgeMessage }
  | { type: 'message_sent'; sessionId: string; message: BridgeMessage }
  | { type: 'rate_limited'; sessionId: string }
  | { type: 'error'; sessionId?: string; error: string };

export type ClientTransportEventHandler = (event: ClientTransportEvent) => void;

// -----------------------------------------------------------------------------
// Client Protocol Messages
// -----------------------------------------------------------------------------

/**
 * Client handshake message (first message from client).
 */
export interface ClientHandshake {
  type: 'handshake';
  name: string;
  version: string;
  authToken?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Server handshake response.
 */
export interface ServerHandshake {
  type: 'handshake_response';
  success: boolean;
  sessionId?: string;
  namespace?: string;
  serverVersion: string;
  error?: string;
}

/**
 * Heartbeat ping/pong.
 */
export interface HeartbeatMessage {
  type: 'ping' | 'pong';
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Transport Metrics
// -----------------------------------------------------------------------------

export interface ClientTransportMetrics {
  /** Current connected clients */
  connectedClients: number;
  /** Total connections since start */
  totalConnections: number;
  /** Total disconnections */
  totalDisconnections: number;
  /** Messages received */
  messagesReceived: number;
  /** Messages sent */
  messagesSent: number;
  /** Rate limit violations */
  rateLimitViolations: number;
  /** Authentication failures */
  authFailures: number;
  /** Average message latency (ms) */
  averageLatencyMs: number;
}

export const INITIAL_TRANSPORT_METRICS: ClientTransportMetrics = {
  connectedClients: 0,
  totalConnections: 0,
  totalDisconnections: 0,
  messagesReceived: 0,
  messagesSent: 0,
  rateLimitViolations: 0,
  authFailures: 0,
  averageLatencyMs: 0,
};
