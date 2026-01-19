/**
 * Message Router
 *
 * Central routing hub for all Bridge Protocol messages.
 * Handles pub/sub, command routing, and message distribution.
 */

import type {
  BridgeMessage,
  CommandMessage,
  StateMessage,
  EventMessage,
  AckMessage,
  ErrorMessage,
  SubscribeMessage,
  UnsubscribeMessage,
} from '../protocol/types.js';
import {
  MessageType,
  isCommandMessage,
  isEventMessage,
  isStateMessage,
  isSubscribeMessage,
  isUnsubscribeMessage,
} from '../protocol/types.js';
import { createAck, createError, SequenceCounter } from '../protocol/factory.js';
import { StateStore, type StateDelta } from '../state/store.js';
import { SubscriptionManager } from './subscription.js';
import { AckStatus, ErrorCode } from '../protocol/types.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type MessageHandler = (message: BridgeMessage) => void | Promise<void>;

export interface RouteTarget {
  id: string;
  namespace: string;
  handler: MessageHandler;
}

export interface RouterOptions {
  /** Enable command deduplication */
  enableIdempotency?: boolean;
  /** TTL for idempotency cache entries (ms) */
  idempotencyTtl?: number;
  /** Maximum pending commands per target */
  maxPendingCommands?: number;
  /** Default command timeout (ms) */
  defaultCommandTimeout?: number;
}

export interface PendingCommand {
  message: CommandMessage;
  sentAt: number;
  timeout: ReturnType<typeof setTimeout>;
  resolve: (ack: AckMessage) => void;
  reject: (error: Error) => void;
}

// -----------------------------------------------------------------------------
// Message Router
// -----------------------------------------------------------------------------

export class MessageRouter {
  private targets: Map<string, RouteTarget> = new Map();
  private stateStore: StateStore;
  private subscriptionManager: SubscriptionManager;
  private sequenceCounter: SequenceCounter;
  private options: Required<RouterOptions>;

  /** Idempotency cache: key -> result/timestamp */
  private idempotencyCache: Map<string, { result: AckMessage | null; timestamp: number }> =
    new Map();

  /** Pending commands awaiting ack */
  private pendingCommands: Map<string, PendingCommand> = new Map();

  /** Cleanup interval for expired entries */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(stateStore: StateStore, options: RouterOptions = {}) {
    this.stateStore = stateStore;
    this.subscriptionManager = new SubscriptionManager();
    this.sequenceCounter = new SequenceCounter();

    this.options = {
      enableIdempotency: options.enableIdempotency ?? true,
      idempotencyTtl: options.idempotencyTtl ?? 60000, // 1 minute
      maxPendingCommands: options.maxPendingCommands ?? 1000,
      defaultCommandTimeout: options.defaultCommandTimeout ?? 30000, // 30 seconds
    };

    // Listen for state changes and route to subscribers
    this.stateStore.addListener(this.handleStateDelta.bind(this));

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 10000);
  }

  // ---------------------------------------------------------------------------
  // Target Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a target that can receive commands and messages.
   */
  registerTarget(target: RouteTarget): void {
    if (this.targets.has(target.namespace)) {
      throw new Error(`Target already registered: ${target.namespace}`);
    }
    this.targets.set(target.namespace, target);
  }

  /**
   * Unregister a target.
   */
  unregisterTarget(namespace: string): boolean {
    const target = this.targets.get(namespace);
    if (!target) {
      return false;
    }

    // Clean up subscriptions for this target
    this.subscriptionManager.unsubscribeClient(target.id);

    // Cancel pending commands to this target
    for (const [commandId, pending] of this.pendingCommands) {
      if (pending.message.target === namespace) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Target unregistered: ${namespace}`));
        this.pendingCommands.delete(commandId);
      }
    }

    this.targets.delete(namespace);
    return true;
  }

  /**
   * Get a registered target by namespace.
   */
  getTarget(namespace: string): RouteTarget | undefined {
    return this.targets.get(namespace);
  }

  /**
   * Get all registered targets.
   */
  getTargets(): RouteTarget[] {
    return Array.from(this.targets.values());
  }

  // ---------------------------------------------------------------------------
  // Message Routing
  // ---------------------------------------------------------------------------

  /**
   * Route an incoming message to appropriate handlers.
   */
  async route(message: BridgeMessage): Promise<void> {
    switch (message.type) {
      case MessageType.COMMAND:
        await this.routeCommand(message as CommandMessage);
        break;

      case MessageType.EVENT:
        await this.routeEvent(message as EventMessage);
        break;

      case MessageType.STATE:
        await this.routeState(message as StateMessage);
        break;

      case MessageType.ACK:
        this.handleAck(message as AckMessage);
        break;

      case MessageType.ERROR:
        this.handleError(message as ErrorMessage);
        break;

      case MessageType.SUBSCRIBE:
        await this.handleSubscribe(message as SubscribeMessage);
        break;

      case MessageType.UNSUBSCRIBE:
        this.handleUnsubscribe(message as UnsubscribeMessage);
        break;
    }
  }

  /**
   * Route a command to its target.
   */
  private async routeCommand(message: CommandMessage): Promise<void> {
    // Check idempotency
    if (this.options.enableIdempotency && message.idempotencyKey) {
      const cached = this.idempotencyCache.get(message.idempotencyKey);
      if (cached) {
        // Return cached result
        if (cached.result) {
          const sourceTarget = this.targets.get(message.source);
          if (sourceTarget) {
            await sourceTarget.handler(cached.result);
          }
        }
        return;
      }
    }

    // Find target
    const target = this.findTarget(message.target);
    if (!target) {
      await this.sendError(message, ErrorCode.UNKNOWN_TARGET, `Unknown target: ${message.target}`);
      return;
    }

    // Send received ack
    const receivedAck = createAck(
      {
        source: 'hub.core',
        target: message.source,
        path: message.path,
        commandId: message.id,
        status: AckStatus.RECEIVED,
        correlationId: message.correlationId,
      },
      this.sequenceCounter.next()
    );

    const sourceTarget = this.targets.get(message.source);
    if (sourceTarget) {
      await sourceTarget.handler(receivedAck);
    }

    // Route to target
    try {
      await target.handler(message);

      // Cache the command as in-flight
      if (this.options.enableIdempotency && message.idempotencyKey) {
        this.idempotencyCache.set(message.idempotencyKey, {
          result: null,
          timestamp: Date.now(),
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.sendError(message, ErrorCode.ADAPTER_ERROR, errorMessage);
    }
  }

  /**
   * Route an event to all matching subscribers.
   */
  private async routeEvent(message: EventMessage): Promise<void> {
    const subscribedClients = this.subscriptionManager.getSubscribedClients(message.path, 'event');

    for (const clientId of subscribedClients) {
      const target = this.findTargetById(clientId);
      if (target && target.namespace !== message.source) {
        try {
          await target.handler(message);
        } catch (error) {
          // Log but continue to other subscribers
          console.error(`Failed to deliver event to ${clientId}:`, error);
        }
      }
    }
  }

  /**
   * Route a state update to all matching subscribers.
   */
  private async routeState(message: StateMessage): Promise<void> {
    // Update state store
    const payload = message.payload;
    try {
      this.stateStore.set(message.path, payload.value, message.source);
    } catch (error) {
      if (error instanceof Error && error.name === 'StateOwnershipError') {
        await this.sendError(message, ErrorCode.STATE_CONFLICT, error.message);
      }
      // Other errors are logged but not sent back
      return;
    }

    // State change listeners will handle routing via handleStateDelta
  }

  /**
   * Handle a state delta from the state store.
   */
  private handleStateDelta(delta: StateDelta): void {
    const message = this.stateStore.deltaToMessage(delta);
    const subscribedClients = this.subscriptionManager.getSubscribedClients(delta.path, 'state');

    for (const clientId of subscribedClients) {
      const target = this.findTargetById(clientId);
      if (target && target.namespace !== delta.entry.owner) {
        Promise.resolve(target.handler(message)).catch((error: unknown) => {
          console.error(`Failed to deliver state to ${clientId}:`, error);
        });
      }
    }
  }

  /**
   * Handle an acknowledgement.
   */
  private handleAck(message: AckMessage): void {
    const pending = this.pendingCommands.get(message.payload.commandId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingCommands.delete(message.payload.commandId);
      pending.resolve(message);

      // Update idempotency cache with result
      if (this.options.enableIdempotency && pending.message.idempotencyKey) {
        this.idempotencyCache.set(pending.message.idempotencyKey, {
          result: message,
          timestamp: Date.now(),
        });
      }
    }

    // Forward ack to original sender
    const sourceTarget = this.targets.get(message.target);
    if (sourceTarget) {
      Promise.resolve(sourceTarget.handler(message)).catch((error: unknown) => {
        console.error(`Failed to deliver ack to ${message.target}:`, error);
      });
    }
  }

  /**
   * Handle an error message.
   */
  private handleError(message: ErrorMessage): void {
    // Forward error to target if specified
    if (message.target) {
      const target = this.targets.get(message.target);
      if (target) {
        Promise.resolve(target.handler(message)).catch((error: unknown) => {
          console.error(`Failed to deliver error to ${message.target}:`, error);
        });
      }
    }
  }

  /**
   * Handle a subscription request.
   */
  private async handleSubscribe(message: SubscribeMessage): Promise<void> {
    const subscription = this.subscriptionManager.subscribe(
      message.source,
      message.payload.patterns,
      message.payload.filter,
      message.payload.snapshot
    );

    // Send ack
    const ack = createAck(
      {
        source: 'hub.core',
        target: message.source,
        path: message.path,
        commandId: message.id,
        status: AckStatus.COMPLETED,
        result: { subscriptionId: subscription.id },
        correlationId: message.correlationId,
      },
      this.sequenceCounter.next()
    );

    const sourceTarget = this.targets.get(message.source);
    if (sourceTarget) {
      await sourceTarget.handler(ack);

      // Send snapshot if requested
      if (message.payload.snapshot) {
        for (const pattern of message.payload.patterns) {
          const snapshot = this.stateStore.getSnapshotForPattern(pattern);
          const messages = this.stateStore.snapshotToMessages(snapshot);

          for (const stateMsg of messages) {
            await sourceTarget.handler(stateMsg);
          }
        }

        // Send snapshot complete event
        const completeEvent: EventMessage = {
          id: `snapshot-complete-${subscription.id}`,
          type: MessageType.EVENT,
          source: 'hub.core',
          path: 'hub.subscriptions',
          payload: {
            event: 'snapshot_complete',
            data: { subscriptionId: subscription.id },
          },
          timestamp: Date.now(),
          sequence: this.sequenceCounter.next(),
        };

        await sourceTarget.handler(completeEvent);
        this.subscriptionManager.markSnapshotSent(subscription.id);
      }
    }
  }

  /**
   * Handle an unsubscription request.
   */
  private handleUnsubscribe(message: UnsubscribeMessage): void {
    const removed = this.subscriptionManager.unsubscribePatterns(
      message.source,
      message.payload.patterns
    );

    // Send ack
    const ack = createAck(
      {
        source: 'hub.core',
        target: message.source,
        path: message.path,
        commandId: message.id,
        status: AckStatus.COMPLETED,
        result: { removedCount: removed },
        correlationId: message.correlationId,
      },
      this.sequenceCounter.next()
    );

    const sourceTarget = this.targets.get(message.source);
    if (sourceTarget) {
      Promise.resolve(sourceTarget.handler(ack)).catch((error: unknown) => {
        console.error(`Failed to deliver unsubscribe ack:`, error);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Helper Methods
  // ---------------------------------------------------------------------------

  /**
   * Find a target by namespace.
   */
  private findTarget(namespace: string): RouteTarget | undefined {
    // Exact match first
    const exact = this.targets.get(namespace);
    if (exact) return exact;

    // Try prefix match (e.g., 'companion.satellite' matches 'companion')
    const parts = namespace.split('.');
    while (parts.length > 1) {
      parts.pop();
      const prefix = parts.join('.');
      const match = this.targets.get(prefix);
      if (match) return match;
    }

    return undefined;
  }

  /**
   * Find a target by its ID.
   */
  private findTargetById(id: string): RouteTarget | undefined {
    for (const target of this.targets.values()) {
      if (target.id === id) {
        return target;
      }
    }
    return undefined;
  }

  /**
   * Send an error message back to a command source.
   */
  private async sendError(
    originalMessage: BridgeMessage,
    code: string,
    errorMessage: string
  ): Promise<void> {
    const error = createError(
      {
        source: 'hub.core',
        target: originalMessage.source,
        path: originalMessage.path,
        code,
        message: errorMessage,
        relatedMessageId: originalMessage.id,
        correlationId: originalMessage.correlationId,
      },
      this.sequenceCounter.next()
    );

    const sourceTarget = this.targets.get(originalMessage.source);
    if (sourceTarget) {
      await sourceTarget.handler(error);
    }
  }

  /**
   * Clean up expired idempotency entries and timed-out commands.
   */
  private cleanupExpired(): void {
    const now = Date.now();

    // Clean idempotency cache
    for (const [key, entry] of this.idempotencyCache) {
      if (now - entry.timestamp > this.options.idempotencyTtl * 2) {
        this.idempotencyCache.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public Utilities
  // ---------------------------------------------------------------------------

  /**
   * Get the subscription manager for direct access.
   */
  getSubscriptionManager(): SubscriptionManager {
    return this.subscriptionManager;
  }

  /**
   * Get the state store for direct access.
   */
  getStateStore(): StateStore {
    return this.stateStore;
  }

  /**
   * Get router statistics.
   */
  getStats(): RouterStats {
    return {
      registeredTargets: this.targets.size,
      pendingCommands: this.pendingCommands.size,
      idempotencyCacheSize: this.idempotencyCache.size,
      subscriptions: this.subscriptionManager.getStats(),
      stateEntries: this.stateStore.size,
    };
  }

  /**
   * Shutdown the router and clean up resources.
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Cancel all pending commands
    for (const [_, pending] of this.pendingCommands) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Router shutdown'));
    }
    this.pendingCommands.clear();

    // Clear caches
    this.idempotencyCache.clear();
  }
}

export interface RouterStats {
  registeredTargets: number;
  pendingCommands: number;
  idempotencyCacheSize: number;
  subscriptions: {
    totalSubscriptions: number;
    totalClients: number;
    totalPatterns: number;
    uniquePatterns: number;
  };
  stateEntries: number;
}
