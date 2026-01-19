/**
 * Subscription Manager Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SubscriptionManager } from '../../src/core/router/subscription.js';

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    manager = new SubscriptionManager();
  });

  describe('subscribe', () => {
    it('should create a subscription', () => {
      const sub = manager.subscribe('client-1', ['companion.**']);

      expect(sub.id).toBeDefined();
      expect(sub.clientId).toBe('client-1');
      expect(sub.patterns).toEqual(['companion.**']);
    });

    it('should support multiple patterns', () => {
      const sub = manager.subscribe('client-1', ['companion.**', 'buttons.**']);

      expect(sub.patterns).toHaveLength(2);
      expect(sub.compiledPatterns).toHaveLength(2);
    });

    it('should track subscription count', () => {
      expect(manager.totalSubscriptions).toBe(0);

      manager.subscribe('client-1', ['a.*']);
      expect(manager.totalSubscriptions).toBe(1);

      manager.subscribe('client-2', ['b.*']);
      expect(manager.totalSubscriptions).toBe(2);
    });

    it('should track client count', () => {
      manager.subscribe('client-1', ['a.*']);
      manager.subscribe('client-1', ['b.*']);
      manager.subscribe('client-2', ['c.*']);

      expect(manager.totalClients).toBe(2);
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscription by ID', () => {
      const sub = manager.subscribe('client-1', ['a.*']);
      expect(manager.totalSubscriptions).toBe(1);

      const result = manager.unsubscribe(sub.id);

      expect(result).toBe(true);
      expect(manager.totalSubscriptions).toBe(0);
    });

    it('should return false for non-existent subscription', () => {
      expect(manager.unsubscribe('non-existent')).toBe(false);
    });

    it('should remove subscriptions by patterns', () => {
      manager.subscribe('client-1', ['a.*']);
      manager.subscribe('client-1', ['b.*']);

      const removed = manager.unsubscribePatterns('client-1', ['a.*']);

      expect(removed).toBe(1);
      expect(manager.totalSubscriptions).toBe(1);
    });

    it('should remove all subscriptions for a client', () => {
      manager.subscribe('client-1', ['a.*']);
      manager.subscribe('client-1', ['b.*']);
      manager.subscribe('client-2', ['c.*']);

      const removed = manager.unsubscribeClient('client-1');

      expect(removed).toBe(2);
      expect(manager.totalSubscriptions).toBe(1);
      expect(manager.totalClients).toBe(1);
    });
  });

  describe('matching', () => {
    beforeEach(() => {
      manager.subscribe('client-1', ['companion.variables.**']);
      manager.subscribe('client-2', ['companion.**']);
      manager.subscribe('client-3', ['buttons.**']);
    });

    it('should find matching subscriptions', () => {
      const matches = manager.getMatchingSubscriptions('companion.variables.internal.tally');

      expect(matches).toHaveLength(2);
      expect(matches.map((m) => m.subscription.clientId).sort()).toEqual(['client-1', 'client-2']);
    });

    it('should return empty for non-matching paths', () => {
      const matches = manager.getMatchingSubscriptions('app.custom.state');

      expect(matches).toHaveLength(0);
    });

    it('should get subscribed clients', () => {
      const clients = manager.getSubscribedClients('companion.page.1.bank.0');

      expect(clients.size).toBe(1);
      expect(clients.has('client-2')).toBe(true);
    });

    it('should check if client is subscribed', () => {
      expect(manager.isClientSubscribed('client-1', 'companion.variables.foo')).toBe(true);
      expect(manager.isClientSubscribed('client-1', 'buttons.device.a')).toBe(false);
      expect(manager.isClientSubscribed('client-3', 'buttons.device.a')).toBe(true);
    });
  });

  describe('filter', () => {
    beforeEach(() => {
      manager.subscribe('client-1', ['companion.**'], 'state');
      manager.subscribe('client-2', ['companion.**'], 'events');
      manager.subscribe('client-3', ['companion.**'], 'all');
    });

    it('should filter by state only', () => {
      const matches = manager.getMatchingSubscriptions('companion.variables.x', 'state');

      const clientIds = matches.map((m) => m.subscription.clientId);
      expect(clientIds).toContain('client-1');
      expect(clientIds).toContain('client-3');
      expect(clientIds).not.toContain('client-2');
    });

    it('should filter by events only', () => {
      const matches = manager.getMatchingSubscriptions('companion.variables.x', 'event');

      const clientIds = matches.map((m) => m.subscription.clientId);
      expect(clientIds).toContain('client-2');
      expect(clientIds).toContain('client-3');
      expect(clientIds).not.toContain('client-1');
    });
  });

  describe('snapshot tracking', () => {
    it('should track snapshot sent status', () => {
      const sub = manager.subscribe('client-1', ['a.*'], 'all', true);

      expect(sub.snapshotSent).toBe(false);

      manager.markSnapshotSent(sub.id);

      const updated = manager.getSubscription(sub.id);
      expect(updated?.snapshotSent).toBe(true);
    });

    it('should get subscriptions awaiting snapshot', () => {
      manager.subscribe('client-1', ['a.*'], 'all', true);
      manager.subscribe('client-2', ['b.*'], 'all', false);

      const awaiting = manager.getAwaitingSnapshot();

      expect(awaiting).toHaveLength(1);
      expect(awaiting[0]?.clientId).toBe('client-1');
    });
  });

  describe('statistics', () => {
    it('should provide subscription stats', () => {
      manager.subscribe('client-1', ['a.*', 'b.*']);
      manager.subscribe('client-2', ['a.*']);
      manager.subscribe('client-3', ['c.*']);

      const stats = manager.getStats();

      expect(stats.totalSubscriptions).toBe(3);
      expect(stats.totalClients).toBe(3);
      expect(stats.totalPatterns).toBe(4);
      expect(stats.uniquePatterns).toBe(3);
      expect(stats.topPatterns[0]?.pattern).toBe('a.*');
      expect(stats.topPatterns[0]?.count).toBe(2);
    });
  });
});
