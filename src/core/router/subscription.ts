/**
 * Subscription Manager
 *
 * Manages topic-based subscriptions with wildcard pattern support.
 */

import type { SubscriptionFilter } from '../protocol/types.js';
import { patternToRegex } from '../state/store.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface Subscription {
  /** Unique subscription ID */
  id: string;
  /** Client that owns this subscription */
  clientId: string;
  /** Patterns this subscription matches */
  patterns: string[];
  /** Compiled regex patterns for efficient matching */
  compiledPatterns: RegExp[];
  /** Filter for message types */
  filter: SubscriptionFilter;
  /** Whether initial snapshot was requested */
  snapshot: boolean;
  /** Whether snapshot has been sent */
  snapshotSent: boolean;
  /** Creation timestamp */
  createdAt: number;
}

export interface SubscriptionMatch {
  subscription: Subscription;
  matchedPattern: string;
}

// -----------------------------------------------------------------------------
// Subscription Manager
// -----------------------------------------------------------------------------

export class SubscriptionManager {
  /** Subscriptions indexed by ID */
  private subscriptionsById: Map<string, Subscription> = new Map();

  /** Subscriptions indexed by client ID */
  private subscriptionsByClient: Map<string, Set<string>> = new Map();

  /** Counter for generating subscription IDs */
  private idCounter = 0;

  // ---------------------------------------------------------------------------
  // Subscription CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a new subscription.
   */
  subscribe(
    clientId: string,
    patterns: string[],
    filter: SubscriptionFilter = 'all',
    snapshot = true
  ): Subscription {
    const id = `sub-${++this.idCounter}`;

    const subscription: Subscription = {
      id,
      clientId,
      patterns,
      compiledPatterns: patterns.map(patternToRegex),
      filter,
      snapshot,
      snapshotSent: false,
      createdAt: Date.now(),
    };

    this.subscriptionsById.set(id, subscription);

    let clientSubs = this.subscriptionsByClient.get(clientId);
    if (!clientSubs) {
      clientSubs = new Set();
      this.subscriptionsByClient.set(clientId, clientSubs);
    }
    clientSubs.add(id);

    return subscription;
  }

  /**
   * Remove a subscription by ID.
   */
  unsubscribe(subscriptionId: string): boolean {
    const subscription = this.subscriptionsById.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    this.subscriptionsById.delete(subscriptionId);

    const clientSubs = this.subscriptionsByClient.get(subscription.clientId);
    if (clientSubs) {
      clientSubs.delete(subscriptionId);
      if (clientSubs.size === 0) {
        this.subscriptionsByClient.delete(subscription.clientId);
      }
    }

    return true;
  }

  /**
   * Remove subscriptions by patterns for a client.
   */
  unsubscribePatterns(clientId: string, patterns: string[]): number {
    const clientSubs = this.subscriptionsByClient.get(clientId);
    if (!clientSubs) {
      return 0;
    }

    let removed = 0;
    const patternSet = new Set(patterns);

    for (const subId of clientSubs) {
      const subscription = this.subscriptionsById.get(subId);
      if (subscription) {
        // Check if any of the subscription's patterns match
        const hasMatchingPattern = subscription.patterns.some((p) => patternSet.has(p));
        if (hasMatchingPattern) {
          this.unsubscribe(subId);
          removed++;
        }
      }
    }

    return removed;
  }

  /**
   * Remove all subscriptions for a client.
   */
  unsubscribeClient(clientId: string): number {
    const clientSubs = this.subscriptionsByClient.get(clientId);
    if (!clientSubs) {
      return 0;
    }

    const count = clientSubs.size;

    for (const subId of clientSubs) {
      this.subscriptionsById.delete(subId);
    }

    this.subscriptionsByClient.delete(clientId);

    return count;
  }

  /**
   * Get a subscription by ID.
   */
  getSubscription(subscriptionId: string): Subscription | undefined {
    return this.subscriptionsById.get(subscriptionId);
  }

  /**
   * Get all subscriptions for a client.
   */
  getClientSubscriptions(clientId: string): Subscription[] {
    const subIds = this.subscriptionsByClient.get(clientId);
    if (!subIds) {
      return [];
    }

    const subscriptions: Subscription[] = [];
    for (const subId of subIds) {
      const sub = this.subscriptionsById.get(subId);
      if (sub) {
        subscriptions.push(sub);
      }
    }

    return subscriptions;
  }

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------

  /**
   * Find all subscriptions that match a path.
   * Optionally filter by message type (state/event).
   */
  getMatchingSubscriptions(path: string, messageType?: 'state' | 'event'): SubscriptionMatch[] {
    const matches: SubscriptionMatch[] = [];

    for (const subscription of this.subscriptionsById.values()) {
      // Check filter
      if (messageType) {
        if (subscription.filter === 'state' && messageType !== 'state') continue;
        if (subscription.filter === 'events' && messageType !== 'event') continue;
      }

      // Check patterns
      for (let i = 0; i < subscription.compiledPatterns.length; i++) {
        const regex = subscription.compiledPatterns[i]!;
        if (regex.test(path)) {
          matches.push({
            subscription,
            matchedPattern: subscription.patterns[i]!,
          });
          break; // Only match once per subscription
        }
      }
    }

    return matches;
  }

  /**
   * Get unique client IDs that should receive a message for a path.
   */
  getSubscribedClients(path: string, messageType?: 'state' | 'event'): Set<string> {
    const matches = this.getMatchingSubscriptions(path, messageType);
    const clients = new Set<string>();

    for (const match of matches) {
      clients.add(match.subscription.clientId);
    }

    return clients;
  }

  /**
   * Check if a specific client is subscribed to a path.
   */
  isClientSubscribed(clientId: string, path: string, messageType?: 'state' | 'event'): boolean {
    const subscriptions = this.getClientSubscriptions(clientId);

    for (const sub of subscriptions) {
      // Check filter
      if (messageType) {
        if (sub.filter === 'state' && messageType !== 'state') continue;
        if (sub.filter === 'events' && messageType !== 'event') continue;
      }

      // Check patterns
      for (const regex of sub.compiledPatterns) {
        if (regex.test(path)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Mark a subscription's snapshot as sent.
   */
  markSnapshotSent(subscriptionId: string): void {
    const subscription = this.subscriptionsById.get(subscriptionId);
    if (subscription) {
      subscription.snapshotSent = true;
    }
  }

  /**
   * Get subscriptions awaiting snapshot.
   */
  getAwaitingSnapshot(): Subscription[] {
    const awaiting: Subscription[] = [];

    for (const sub of this.subscriptionsById.values()) {
      if (sub.snapshot && !sub.snapshotSent) {
        awaiting.push(sub);
      }
    }

    return awaiting;
  }

  // ---------------------------------------------------------------------------
  // Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get total number of subscriptions.
   */
  get totalSubscriptions(): number {
    return this.subscriptionsById.size;
  }

  /**
   * Get number of unique clients with subscriptions.
   */
  get totalClients(): number {
    return this.subscriptionsByClient.size;
  }

  /**
   * Get subscription statistics.
   */
  getStats(): SubscriptionStats {
    let totalPatterns = 0;
    const patternCounts = new Map<string, number>();

    for (const sub of this.subscriptionsById.values()) {
      totalPatterns += sub.patterns.length;
      for (const pattern of sub.patterns) {
        patternCounts.set(pattern, (patternCounts.get(pattern) ?? 0) + 1);
      }
    }

    return {
      totalSubscriptions: this.subscriptionsById.size,
      totalClients: this.subscriptionsByClient.size,
      totalPatterns,
      uniquePatterns: patternCounts.size,
      topPatterns: Array.from(patternCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([pattern, count]) => ({ pattern, count })),
    };
  }
}

export interface SubscriptionStats {
  totalSubscriptions: number;
  totalClients: number;
  totalPatterns: number;
  uniquePatterns: number;
  topPatterns: Array<{ pattern: string; count: number }>;
}
