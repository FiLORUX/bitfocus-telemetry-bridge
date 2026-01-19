/**
 * Bridge Protocol Type Definitions
 *
 * Canonical types for the telemetry bridge message exchange protocol.
 * See /docs/specs/BRIDGE-PROTOCOL-v0.1.md for full specification.
 */

import { z } from 'zod';

// -----------------------------------------------------------------------------
// Message Type Discriminators
// -----------------------------------------------------------------------------

export const MessageType = {
  COMMAND: 'command',
  EVENT: 'event',
  STATE: 'state',
  ACK: 'ack',
  ERROR: 'error',
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];

// -----------------------------------------------------------------------------
// Acknowledgement Status
// -----------------------------------------------------------------------------

export const AckStatus = {
  RECEIVED: 'received',
  COMPLETED: 'completed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  REJECTED: 'rejected',
} as const;

export type AckStatus = (typeof AckStatus)[keyof typeof AckStatus];

// -----------------------------------------------------------------------------
// Standard Error Codes
// -----------------------------------------------------------------------------

export const ErrorCode = {
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  UNKNOWN_TARGET: 'UNKNOWN_TARGET',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  ADAPTER_ERROR: 'ADAPTER_ERROR',
  STATE_CONFLICT: 'STATE_CONFLICT',
  SUBSCRIPTION_FAILED: 'SUBSCRIPTION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// -----------------------------------------------------------------------------
// Subscription Filter Types
// -----------------------------------------------------------------------------

export const SubscriptionFilter = {
  STATE: 'state',
  EVENTS: 'events',
  ALL: 'all',
} as const;

export type SubscriptionFilter = (typeof SubscriptionFilter)[keyof typeof SubscriptionFilter];

// -----------------------------------------------------------------------------
// Zod Schemas for Runtime Validation
// -----------------------------------------------------------------------------

const uuidV7Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MessageIdSchema = z.string().regex(uuidV7Regex, 'Must be a valid UUID v7');

export const NamespaceSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/, 'Invalid namespace format');

export const PathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-z][a-z0-9]*(\.[a-z0-9_*]+)*$/, 'Invalid path format');

export const TimestampSchema = z.number().int().positive();

export const SequenceSchema = z.number().int().nonnegative();

// -----------------------------------------------------------------------------
// Base Message Envelope Schema
// -----------------------------------------------------------------------------

export const BaseMessageSchema = z.object({
  id: MessageIdSchema,
  type: z.enum([
    MessageType.COMMAND,
    MessageType.EVENT,
    MessageType.STATE,
    MessageType.ACK,
    MessageType.ERROR,
    MessageType.SUBSCRIBE,
    MessageType.UNSUBSCRIBE,
  ]),
  source: NamespaceSchema,
  target: NamespaceSchema.optional(),
  path: PathSchema,
  payload: z.unknown(),
  timestamp: TimestampSchema,
  correlationId: z.string().max(64).optional(),
  sequence: SequenceSchema,
  ttl: z.number().int().positive().max(300000).optional(), // Max 5 minutes
  idempotencyKey: z.string().max(128).optional(),
});

// -----------------------------------------------------------------------------
// Command Message Schema
// -----------------------------------------------------------------------------

export const CommandPayloadSchema = z.object({
  action: z.string().min(1).max(64),
  params: z.record(z.unknown()).optional(),
});

export const CommandMessageSchema = BaseMessageSchema.extend({
  type: z.literal(MessageType.COMMAND),
  target: NamespaceSchema, // Required for commands
  payload: CommandPayloadSchema,
  idempotencyKey: z.string().max(128), // Required for commands
});

// -----------------------------------------------------------------------------
// Event Message Schema
// -----------------------------------------------------------------------------

export const EventPayloadSchema = z.object({
  event: z.string().min(1).max(64),
  data: z.unknown().optional(),
});

export const EventMessageSchema = BaseMessageSchema.extend({
  type: z.literal(MessageType.EVENT),
  payload: EventPayloadSchema,
});

// -----------------------------------------------------------------------------
// State Message Schema
// -----------------------------------------------------------------------------

export const StatePayloadSchema = z.object({
  value: z.unknown(),
  stale: z.boolean().optional(),
  owner: NamespaceSchema.optional(),
  version: z.number().int().nonnegative().optional(),
});

export const StateMessageSchema = BaseMessageSchema.extend({
  type: z.literal(MessageType.STATE),
  payload: StatePayloadSchema,
});

// -----------------------------------------------------------------------------
// Ack Message Schema
// -----------------------------------------------------------------------------

export const AckPayloadSchema = z.object({
  status: z.enum([
    AckStatus.RECEIVED,
    AckStatus.COMPLETED,
    AckStatus.FAILED,
    AckStatus.TIMEOUT,
    AckStatus.REJECTED,
  ]),
  commandId: MessageIdSchema,
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    })
    .optional(),
});

export const AckMessageSchema = BaseMessageSchema.extend({
  type: z.literal(MessageType.ACK),
  target: NamespaceSchema, // Acks are directed
  payload: AckPayloadSchema,
});

// -----------------------------------------------------------------------------
// Error Message Schema
// -----------------------------------------------------------------------------

export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  relatedMessageId: MessageIdSchema.optional(),
});

export const ErrorMessageSchema = BaseMessageSchema.extend({
  type: z.literal(MessageType.ERROR),
  payload: ErrorPayloadSchema,
});

// -----------------------------------------------------------------------------
// Subscribe Message Schema
// -----------------------------------------------------------------------------

export const SubscribePayloadSchema = z.object({
  patterns: z.array(PathSchema).min(1).max(100),
  filter: z.enum([SubscriptionFilter.STATE, SubscriptionFilter.EVENTS, SubscriptionFilter.ALL]).optional(),
  snapshot: z.boolean().optional(),
});

export const SubscribeMessageSchema = BaseMessageSchema.extend({
  type: z.literal(MessageType.SUBSCRIBE),
  payload: SubscribePayloadSchema,
});

// -----------------------------------------------------------------------------
// Unsubscribe Message Schema
// -----------------------------------------------------------------------------

export const UnsubscribePayloadSchema = z.object({
  patterns: z.array(PathSchema).min(1).max(100),
});

export const UnsubscribeMessageSchema = BaseMessageSchema.extend({
  type: z.literal(MessageType.UNSUBSCRIBE),
  payload: UnsubscribePayloadSchema,
});

// -----------------------------------------------------------------------------
// Union Schema for Any Valid Message
// -----------------------------------------------------------------------------

export const BridgeMessageSchema = z.discriminatedUnion('type', [
  CommandMessageSchema,
  EventMessageSchema,
  StateMessageSchema,
  AckMessageSchema,
  ErrorMessageSchema,
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
]);

// -----------------------------------------------------------------------------
// TypeScript Type Exports (inferred from Zod schemas)
// -----------------------------------------------------------------------------

export type BaseMessage = z.infer<typeof BaseMessageSchema>;
export type CommandMessage = z.infer<typeof CommandMessageSchema>;
export type EventMessage = z.infer<typeof EventMessageSchema>;
export type StateMessage = z.infer<typeof StateMessageSchema>;
export type AckMessage = z.infer<typeof AckMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type SubscribeMessage = z.infer<typeof SubscribeMessageSchema>;
export type UnsubscribeMessage = z.infer<typeof UnsubscribeMessageSchema>;
export type BridgeMessage = z.infer<typeof BridgeMessageSchema>;

export type CommandPayload = z.infer<typeof CommandPayloadSchema>;
export type EventPayload = z.infer<typeof EventPayloadSchema>;
export type StatePayload = z.infer<typeof StatePayloadSchema>;
export type AckPayload = z.infer<typeof AckPayloadSchema>;
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
export type SubscribePayload = z.infer<typeof SubscribePayloadSchema>;
export type UnsubscribePayload = z.infer<typeof UnsubscribePayloadSchema>;

// -----------------------------------------------------------------------------
// Type Guards
// -----------------------------------------------------------------------------

export function isCommandMessage(msg: BridgeMessage): msg is CommandMessage {
  return msg.type === MessageType.COMMAND;
}

export function isEventMessage(msg: BridgeMessage): msg is EventMessage {
  return msg.type === MessageType.EVENT;
}

export function isStateMessage(msg: BridgeMessage): msg is StateMessage {
  return msg.type === MessageType.STATE;
}

export function isAckMessage(msg: BridgeMessage): msg is AckMessage {
  return msg.type === MessageType.ACK;
}

export function isErrorMessage(msg: BridgeMessage): msg is ErrorMessage {
  return msg.type === MessageType.ERROR;
}

export function isSubscribeMessage(msg: BridgeMessage): msg is SubscribeMessage {
  return msg.type === MessageType.SUBSCRIBE;
}

export function isUnsubscribeMessage(msg: BridgeMessage): msg is UnsubscribeMessage {
  return msg.type === MessageType.UNSUBSCRIBE;
}

// -----------------------------------------------------------------------------
// Validation Utilities
// -----------------------------------------------------------------------------

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function validateMessage(message: unknown): ValidationResult<BridgeMessage> {
  const result = BridgeMessageSchema.safeParse(message);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
  };
}

export function validateCommandMessage(message: unknown): ValidationResult<CommandMessage> {
  const result = CommandMessageSchema.safeParse(message);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
  };
}
