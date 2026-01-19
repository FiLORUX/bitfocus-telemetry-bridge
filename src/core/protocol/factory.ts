/**
 * Message Factory
 *
 * Utilities for creating properly-formed Bridge Protocol messages.
 * Handles ID generation, timestamps, and sequence management.
 */

import type {
  AckMessage,
  AckStatus,
  BridgeMessage,
  CommandMessage,
  ErrorMessage,
  EventMessage,
  StateMessage,
  SubscribeMessage,
  SubscriptionFilter,
  UnsubscribeMessage,
} from './types.js';
import { MessageType } from './types.js';

// -----------------------------------------------------------------------------
// UUID v7 Generation
// -----------------------------------------------------------------------------

/**
 * Generate a UUID v7 (time-ordered).
 * Uses crypto.randomUUID() as base and embeds timestamp.
 */
export function generateUuidV7(): string {
  const now = Date.now();

  // Extract timestamp components
  const timestampHex = now.toString(16).padStart(12, '0');

  // Generate random bytes for the rest
  const randomBytes = crypto.getRandomValues(new Uint8Array(10));

  // Build UUID v7 string
  // Format: tttttttt-tttt-7xxx-yxxx-xxxxxxxxxxxx
  // where t = timestamp, 7 = version, y = variant (8, 9, a, or b)
  const timeLow = timestampHex.slice(0, 8);
  const timeMid = timestampHex.slice(8, 12);

  // Set version (7) in the high nibble of time_hi_and_version
  const randomHigh = (randomBytes[0]! & 0x0f) | 0x70;
  const timeHighAndVersion = randomHigh.toString(16).padStart(2, '0') + bytesToHex(randomBytes.slice(1, 2));

  // Set variant bits (10xx) in clock_seq_hi_and_reserved
  const clockSeqHi = (randomBytes[2]! & 0x3f) | 0x80;
  const clockSeqLow = randomBytes[3];
  const clockSeq = clockSeqHi.toString(16).padStart(2, '0') + clockSeqLow!.toString(16).padStart(2, '0');

  // Node (6 bytes)
  const node = bytesToHex(randomBytes.slice(4, 10));

  return `${timeLow}-${timeMid}-${timeHighAndVersion}-${clockSeq}-${node}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// -----------------------------------------------------------------------------
// Sequence Counter
// -----------------------------------------------------------------------------

/**
 * Per-source sequence counter.
 * Each source should maintain its own instance.
 */
export class SequenceCounter {
  private value = 0;

  next(): number {
    return this.value++;
  }

  current(): number {
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

// -----------------------------------------------------------------------------
// Message Builders
// -----------------------------------------------------------------------------

export interface CommandOptions {
  source: string;
  target: string;
  path: string;
  action: string;
  params?: Record<string, unknown>;
  correlationId?: string;
  ttl?: number;
  idempotencyKey?: string;
}

export function createCommand(options: CommandOptions, sequence: number): CommandMessage {
  const idempotencyKey =
    options.idempotencyKey ?? `${options.action}-${options.path}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: generateUuidV7(),
    type: MessageType.COMMAND,
    source: options.source,
    target: options.target,
    path: options.path,
    payload: {
      action: options.action,
      params: options.params,
    },
    timestamp: Date.now(),
    correlationId: options.correlationId,
    sequence,
    ttl: options.ttl,
    idempotencyKey,
  };
}

export interface EventOptions {
  source: string;
  path: string;
  event: string;
  data?: unknown;
  correlationId?: string;
}

export function createEvent(options: EventOptions, sequence: number): EventMessage {
  return {
    id: generateUuidV7(),
    type: MessageType.EVENT,
    source: options.source,
    path: options.path,
    payload: {
      event: options.event,
      data: options.data,
    },
    timestamp: Date.now(),
    correlationId: options.correlationId,
    sequence,
  };
}

export interface StateOptions {
  source: string;
  path: string;
  value: unknown;
  stale?: boolean;
  owner?: string;
  version?: number;
  correlationId?: string;
}

export function createState(options: StateOptions, sequence: number): StateMessage {
  return {
    id: generateUuidV7(),
    type: MessageType.STATE,
    source: options.source,
    path: options.path,
    payload: {
      value: options.value,
      stale: options.stale,
      owner: options.owner ?? options.source,
      version: options.version,
    },
    timestamp: Date.now(),
    correlationId: options.correlationId,
    sequence,
  };
}

export interface AckOptions {
  source: string;
  target: string;
  path: string;
  commandId: string;
  status: AckStatus;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  correlationId?: string;
}

export function createAck(options: AckOptions, sequence: number): AckMessage {
  return {
    id: generateUuidV7(),
    type: MessageType.ACK,
    source: options.source,
    target: options.target,
    path: options.path,
    payload: {
      status: options.status,
      commandId: options.commandId,
      result: options.result,
      error: options.error,
    },
    timestamp: Date.now(),
    correlationId: options.correlationId,
    sequence,
  };
}

export interface ErrorOptions {
  source: string;
  target?: string;
  path: string;
  code: string;
  message: string;
  details?: unknown;
  relatedMessageId?: string;
  correlationId?: string;
}

export function createError(options: ErrorOptions, sequence: number): ErrorMessage {
  return {
    id: generateUuidV7(),
    type: MessageType.ERROR,
    source: options.source,
    target: options.target,
    path: options.path,
    payload: {
      code: options.code,
      message: options.message,
      details: options.details,
      relatedMessageId: options.relatedMessageId,
    },
    timestamp: Date.now(),
    correlationId: options.correlationId,
    sequence,
  };
}

export interface SubscribeOptions {
  source: string;
  patterns: string[];
  filter?: SubscriptionFilter;
  snapshot?: boolean;
  correlationId?: string;
}

export function createSubscribe(options: SubscribeOptions, sequence: number): SubscribeMessage {
  return {
    id: generateUuidV7(),
    type: MessageType.SUBSCRIBE,
    source: options.source,
    path: 'hub.subscriptions',
    payload: {
      patterns: options.patterns,
      filter: options.filter,
      snapshot: options.snapshot,
    },
    timestamp: Date.now(),
    correlationId: options.correlationId,
    sequence,
  };
}

export interface UnsubscribeOptions {
  source: string;
  patterns: string[];
  correlationId?: string;
}

export function createUnsubscribe(options: UnsubscribeOptions, sequence: number): UnsubscribeMessage {
  return {
    id: generateUuidV7(),
    type: MessageType.UNSUBSCRIBE,
    source: options.source,
    path: 'hub.subscriptions',
    payload: {
      patterns: options.patterns,
    },
    timestamp: Date.now(),
    correlationId: options.correlationId,
    sequence,
  };
}

// -----------------------------------------------------------------------------
// Message Cloning with New ID/Timestamp
// -----------------------------------------------------------------------------

/**
 * Clone a message with a new ID and timestamp.
 * Useful for retries or forwarding.
 */
export function cloneMessage<T extends BridgeMessage>(message: T, newSequence: number): T {
  return {
    ...message,
    id: generateUuidV7(),
    timestamp: Date.now(),
    sequence: newSequence,
  };
}

// -----------------------------------------------------------------------------
// Idempotency Key Generation
// -----------------------------------------------------------------------------

/**
 * Generate a deterministic idempotency key for a command.
 * Based on action, path, and relevant parameters.
 */
export function generateIdempotencyKey(
  action: string,
  path: string,
  params?: Record<string, unknown>,
  timestamp?: number
): string {
  const ts = timestamp ?? Date.now();
  const paramsHash = params ? hashObject(params) : '';
  return `${action}:${path}:${ts}:${paramsHash}`;
}

function hashObject(obj: Record<string, unknown>): string {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
