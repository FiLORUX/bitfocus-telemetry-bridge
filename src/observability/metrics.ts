/**
 * Prometheus Metrics
 *
 * Metrics collection and export for monitoring.
 * Exposes Prometheus-compatible metrics endpoint.
 */

import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

const registry = new Registry();

// Collect default Node.js metrics (memory, CPU, etc.)
collectDefaultMetrics({ register: registry });

// -----------------------------------------------------------------------------
// Connection Metrics
// -----------------------------------------------------------------------------

export const connectionGauge = new Gauge({
  name: 'telemetry_bridge_connections_current',
  help: 'Current number of connections by type',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const connectionTotal = new Counter({
  name: 'telemetry_bridge_connections_total',
  help: 'Total number of connections by type',
  labelNames: ['type'] as const,
  registers: [registry],
});

export const disconnectionTotal = new Counter({
  name: 'telemetry_bridge_disconnections_total',
  help: 'Total number of disconnections by type and reason',
  labelNames: ['type', 'reason'] as const,
  registers: [registry],
});

// -----------------------------------------------------------------------------
// Message Metrics
// -----------------------------------------------------------------------------

export const messagesReceived = new Counter({
  name: 'telemetry_bridge_messages_received_total',
  help: 'Total messages received by type and source',
  labelNames: ['type', 'source'] as const,
  registers: [registry],
});

export const messagesSent = new Counter({
  name: 'telemetry_bridge_messages_sent_total',
  help: 'Total messages sent by type and target',
  labelNames: ['type', 'target'] as const,
  registers: [registry],
});

export const messageErrors = new Counter({
  name: 'telemetry_bridge_message_errors_total',
  help: 'Total message errors by type and error code',
  labelNames: ['type', 'code'] as const,
  registers: [registry],
});

// -----------------------------------------------------------------------------
// Command Metrics
// -----------------------------------------------------------------------------

export const commandsTotal = new Counter({
  name: 'telemetry_bridge_commands_total',
  help: 'Total commands processed by action and status',
  labelNames: ['action', 'status'] as const,
  registers: [registry],
});

export const commandDuration = new Histogram({
  name: 'telemetry_bridge_command_duration_seconds',
  help: 'Command processing duration in seconds',
  labelNames: ['action'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// -----------------------------------------------------------------------------
// State Metrics
// -----------------------------------------------------------------------------

export const stateEntriesGauge = new Gauge({
  name: 'telemetry_bridge_state_entries_current',
  help: 'Current number of state entries by owner',
  labelNames: ['owner'] as const,
  registers: [registry],
});

export const stateUpdatesTotal = new Counter({
  name: 'telemetry_bridge_state_updates_total',
  help: 'Total state updates by path prefix',
  labelNames: ['prefix'] as const,
  registers: [registry],
});

// -----------------------------------------------------------------------------
// Subscription Metrics
// -----------------------------------------------------------------------------

export const subscriptionsGauge = new Gauge({
  name: 'telemetry_bridge_subscriptions_current',
  help: 'Current number of subscriptions',
  registers: [registry],
});

export const subscribersGauge = new Gauge({
  name: 'telemetry_bridge_subscribers_current',
  help: 'Current number of unique subscribers',
  registers: [registry],
});

// -----------------------------------------------------------------------------
// Queue/Backpressure Metrics
// -----------------------------------------------------------------------------

export const queueSizeGauge = new Gauge({
  name: 'telemetry_bridge_queue_size_current',
  help: 'Current queue size by queue name',
  labelNames: ['queue'] as const,
  registers: [registry],
});

export const rateLimitHits = new Counter({
  name: 'telemetry_bridge_rate_limit_hits_total',
  help: 'Total rate limit hits by client',
  labelNames: ['client'] as const,
  registers: [registry],
});

// -----------------------------------------------------------------------------
// Adapter Metrics
// -----------------------------------------------------------------------------

export const adapterStateGauge = new Gauge({
  name: 'telemetry_bridge_adapter_state',
  help: 'Adapter connection state (1 = connected, 0 = disconnected)',
  labelNames: ['adapter'] as const,
  registers: [registry],
});

export const adapterReconnects = new Counter({
  name: 'telemetry_bridge_adapter_reconnects_total',
  help: 'Total adapter reconnection attempts',
  labelNames: ['adapter'] as const,
  registers: [registry],
});

export const adapterLatency = new Histogram({
  name: 'telemetry_bridge_adapter_latency_seconds',
  help: 'Adapter round-trip latency in seconds',
  labelNames: ['adapter'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

// -----------------------------------------------------------------------------
// Export Functions
// -----------------------------------------------------------------------------

/**
 * Get metrics in Prometheus format.
 */
export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

/**
 * Get metrics as JSON.
 */
export async function getMetricsJson(): Promise<object> {
  return registry.getMetricsAsJSON();
}

/**
 * Get the registry for custom metrics.
 */
export function getRegistry(): Registry {
  return registry;
}

/**
 * Get content type for Prometheus endpoint.
 */
export function getContentType(): string {
  return registry.contentType;
}

// -----------------------------------------------------------------------------
// Convenience Functions
// -----------------------------------------------------------------------------

/**
 * Record a connection event.
 */
export function recordConnection(type: string): void {
  connectionGauge.labels(type).inc();
  connectionTotal.labels(type).inc();
}

/**
 * Record a disconnection event.
 */
export function recordDisconnection(type: string, reason = 'normal'): void {
  connectionGauge.labels(type).dec();
  disconnectionTotal.labels(type, reason).inc();
}

/**
 * Record a message received.
 */
export function recordMessageReceived(type: string, source: string): void {
  messagesReceived.labels(type, source).inc();
}

/**
 * Record a message sent.
 */
export function recordMessageSent(type: string, target: string): void {
  messagesSent.labels(type, target).inc();
}

/**
 * Record a command execution.
 */
export function recordCommand(action: string, status: 'success' | 'failure'): void {
  commandsTotal.labels(action, status).inc();
}

/**
 * Time a command execution.
 */
export function timeCommand(action: string): () => void {
  const end = commandDuration.labels(action).startTimer();
  return end;
}

/**
 * Update state entry count.
 */
export function updateStateCount(owner: string, count: number): void {
  stateEntriesGauge.labels(owner).set(count);
}

/**
 * Record a state update.
 */
export function recordStateUpdate(path: string): void {
  const prefix = path.split('.').slice(0, 2).join('.');
  stateUpdatesTotal.labels(prefix).inc();
}

/**
 * Update adapter state.
 */
export function updateAdapterState(adapter: string, connected: boolean): void {
  adapterStateGauge.labels(adapter).set(connected ? 1 : 0);
}

/**
 * Record adapter reconnect.
 */
export function recordAdapterReconnect(adapter: string): void {
  adapterReconnects.labels(adapter).inc();
}

/**
 * Record adapter latency.
 */
export function recordAdapterLatency(adapter: string, latencyMs: number): void {
  adapterLatency.labels(adapter).observe(latencyMs / 1000);
}
