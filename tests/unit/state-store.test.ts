/**
 * State Store Unit Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateStore, StateOwnershipError, patternToRegex, pathMatchesPattern } from '../../src/core/state/store.js';

describe('StateStore', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
  });

  describe('basic operations', () => {
    it('should set and get values', () => {
      store.set('test.key', 'value', 'owner.a');
      expect(store.getValue('test.key')).toBe('value');
    });

    it('should return undefined for non-existent keys', () => {
      expect(store.getValue('nonexistent')).toBeUndefined();
    });

    it('should check key existence', () => {
      store.set('test.key', 'value', 'owner.a');
      expect(store.has('test.key')).toBe(true);
      expect(store.has('other.key')).toBe(false);
    });

    it('should track entry count', () => {
      expect(store.size).toBe(0);
      store.set('key1', 'v1', 'owner');
      expect(store.size).toBe(1);
      store.set('key2', 'v2', 'owner');
      expect(store.size).toBe(2);
    });

    it('should increment global version on changes', () => {
      expect(store.version).toBe(0);
      store.set('key1', 'v1', 'owner');
      expect(store.version).toBe(1);
      store.set('key2', 'v2', 'owner');
      expect(store.version).toBe(2);
    });
  });

  describe('ownership', () => {
    it('should allow owner to update their keys', () => {
      store.set('test.key', 'v1', 'owner.a');
      store.set('test.key', 'v2', 'owner.a');
      expect(store.getValue('test.key')).toBe('v2');
    });

    it('should prevent other owners from updating keys', () => {
      store.set('test.key', 'v1', 'owner.a');
      expect(() => store.set('test.key', 'v2', 'owner.b')).toThrow(StateOwnershipError);
    });

    it('should track owner in entry', () => {
      store.set('test.key', 'value', 'my.owner');
      const entry = store.get('test.key');
      expect(entry?.owner).toBe('my.owner');
    });
  });

  describe('versioning', () => {
    it('should increment version on each update', () => {
      store.set('key', 'v1', 'owner');
      let entry = store.get('key');
      expect(entry?.version).toBe(1);

      store.set('key', 'v2', 'owner');
      entry = store.get('key');
      expect(entry?.version).toBe(2);
    });

    it('should not update version if value unchanged', () => {
      store.set('key', 'same', 'owner');
      const delta1 = store.set('key', 'same', 'owner');
      expect(delta1).toBeNull(); // No change
    });
  });

  describe('deletion', () => {
    it('should delete keys', () => {
      store.set('key', 'value', 'owner');
      expect(store.has('key')).toBe(true);
      store.delete('key', 'owner');
      expect(store.has('key')).toBe(false);
    });

    it('should prevent deletion by non-owners', () => {
      store.set('key', 'value', 'owner.a');
      expect(() => store.delete('key', 'owner.b')).toThrow(StateOwnershipError);
    });

    it('should return null when deleting non-existent key', () => {
      expect(store.delete('nonexistent', 'owner')).toBeNull();
    });
  });

  describe('staleness', () => {
    it('should mark owner entries as stale', () => {
      store.set('key1', 'v1', 'owner.a');
      store.set('key2', 'v2', 'owner.a');
      store.set('key3', 'v3', 'owner.b');

      const deltas = store.markOwnerStale('owner.a');

      expect(deltas).toHaveLength(2);
      expect(store.get('key1')?.stale).toBe(true);
      expect(store.get('key2')?.stale).toBe(true);
      expect(store.get('key3')?.stale).toBe(false);
    });

    it('should clear stale flag for owner', () => {
      store.set('key1', 'v1', 'owner.a');
      store.markOwnerStale('owner.a');
      expect(store.get('key1')?.stale).toBe(true);

      store.clearOwnerStale('owner.a');
      expect(store.get('key1')?.stale).toBe(false);
    });
  });

  describe('pattern matching', () => {
    beforeEach(() => {
      store.set('companion.variables.internal.var1', 'v1', 'companion');
      store.set('companion.variables.internal.var2', 'v2', 'companion');
      store.set('companion.variables.custom.myvar', 'v3', 'companion');
      store.set('companion.page.1.bank.0', 'p1b0', 'companion');
      store.set('buttons.device.a.key.0', 'k0', 'buttons');
    });

    it('should match exact paths', () => {
      const paths = store.getMatchingPaths('companion.variables.internal.var1');
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe('companion.variables.internal.var1');
    });

    it('should match single-level wildcards', () => {
      const paths = store.getMatchingPaths('companion.variables.internal.*');
      expect(paths).toHaveLength(2);
    });

    it('should match multi-level wildcards', () => {
      const paths = store.getMatchingPaths('companion.**');
      expect(paths).toHaveLength(4);
    });

    it('should return entries for pattern', () => {
      const entries = store.getMatchingEntries('companion.variables.**');
      expect(entries.size).toBe(3);
    });
  });

  describe('bulk operations', () => {
    it('should set multiple values in bulk', () => {
      const deltas = store.setBulk([
        { path: 'key1', value: 'v1' },
        { path: 'key2', value: 'v2' },
        { path: 'key3', value: 'v3' },
      ], 'owner');

      expect(deltas).toHaveLength(3);
      expect(store.size).toBe(3);
    });

    it('should delete all entries by owner', () => {
      store.set('key1', 'v1', 'owner.a');
      store.set('key2', 'v2', 'owner.a');
      store.set('key3', 'v3', 'owner.b');

      store.deleteByOwner('owner.a');

      expect(store.size).toBe(1);
      expect(store.has('key3')).toBe(true);
    });
  });

  describe('snapshots', () => {
    it('should create snapshot of all state', () => {
      store.set('key1', 'v1', 'owner');
      store.set('key2', 'v2', 'owner');

      const snapshot = store.getSnapshot();

      expect(snapshot.entries.size).toBe(2);
      expect(snapshot.version).toBe(2);
    });

    it('should create snapshot for pattern', () => {
      store.set('ns1.key1', 'v1', 'owner');
      store.set('ns1.key2', 'v2', 'owner');
      store.set('ns2.key1', 'v3', 'owner');

      const snapshot = store.getSnapshotForPattern('ns1.*');

      expect(snapshot.entries.size).toBe(2);
    });
  });

  describe('change listeners', () => {
    it('should notify listeners on changes', () => {
      const listener = vi.fn();
      store.addListener(listener);

      store.set('key', 'value', 'owner');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        path: 'key',
        entry: expect.objectContaining({ value: 'value' }),
      }));
    });

    it('should allow removing listeners', () => {
      const listener = vi.fn();
      store.addListener(listener);
      store.removeListener(listener);

      store.set('key', 'value', 'owner');

      expect(listener).not.toHaveBeenCalled();
    });
  });
});

describe('Pattern matching utilities', () => {
  describe('patternToRegex', () => {
    it('should match exact paths', () => {
      const regex = patternToRegex('a.b.c');
      expect(regex.test('a.b.c')).toBe(true);
      expect(regex.test('a.b.d')).toBe(false);
    });

    it('should handle single-level wildcard', () => {
      const regex = patternToRegex('a.*.c');
      expect(regex.test('a.b.c')).toBe(true);
      expect(regex.test('a.x.c')).toBe(true);
      expect(regex.test('a.b.d')).toBe(false);
      expect(regex.test('a.b.c.d')).toBe(false);
    });

    it('should handle multi-level wildcard', () => {
      const regex = patternToRegex('a.**');
      expect(regex.test('a.b')).toBe(true);
      expect(regex.test('a.b.c')).toBe(true);
      expect(regex.test('a.b.c.d.e')).toBe(true);
      expect(regex.test('b.c')).toBe(false);
    });
  });

  describe('pathMatchesPattern', () => {
    it('should match paths against patterns', () => {
      expect(pathMatchesPattern('companion.variables.internal.tally', 'companion.variables.**')).toBe(true);
      expect(pathMatchesPattern('companion.page.1.bank.0', 'companion.page.*.bank.*')).toBe(true);
      expect(pathMatchesPattern('buttons.device.a.key.5', 'companion.**')).toBe(false);
    });
  });
});
