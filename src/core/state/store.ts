/**
 * State Store
 *
 * In-memory state store with last-known-value semantics.
 * Supports snapshots, deltas, ownership tracking, and staleness.
 */

import type { StateMessage } from '../protocol/types.js';
import { createState, SequenceCounter } from '../protocol/factory.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface StateEntry {
  /** Current value */
  value: unknown;
  /** Namespace that owns this key */
  owner: string;
  /** Monotonic version within this key */
  version: number;
  /** Whether the value may be outdated */
  stale: boolean;
  /** Last update timestamp (Unix ms) */
  updatedAt: number;
  /** Path for this entry */
  path: string;
}

export interface StateUpdate {
  path: string;
  value: unknown;
  owner?: string;
  stale?: boolean;
}

export interface StateSnapshot {
  entries: Map<string, StateEntry>;
  timestamp: number;
  version: number;
}

export interface StateDelta {
  path: string;
  entry: StateEntry;
  previousVersion: number | null;
}

export type StateChangeListener = (delta: StateDelta) => void;

// -----------------------------------------------------------------------------
// State Store Implementation
// -----------------------------------------------------------------------------

export class StateStore {
  private entries: Map<string, StateEntry> = new Map();
  private listeners: Set<StateChangeListener> = new Set();
  private globalVersion = 0;
  private sequenceCounter: SequenceCounter;
  private source: string;

  constructor(source = 'hub.core') {
    this.source = source;
    this.sequenceCounter = new SequenceCounter();
  }

  // ---------------------------------------------------------------------------
  // Read Operations
  // ---------------------------------------------------------------------------

  /**
   * Get a single state entry by path.
   */
  get(path: string): StateEntry | undefined {
    return this.entries.get(path);
  }

  /**
   * Get the value of a state key, or undefined if not set.
   */
  getValue(path: string): unknown {
    return this.entries.get(path)?.value;
  }

  /**
   * Check if a path exists in the store.
   */
  has(path: string): boolean {
    return this.entries.has(path);
  }

  /**
   * Get all paths matching a pattern.
   * Supports wildcards: * (single level), ** (multi-level)
   */
  getMatchingPaths(pattern: string): string[] {
    const regex = patternToRegex(pattern);
    const results: string[] = [];

    for (const path of this.entries.keys()) {
      if (regex.test(path)) {
        results.push(path);
      }
    }

    return results;
  }

  /**
   * Get all entries matching a pattern.
   */
  getMatchingEntries(pattern: string): Map<string, StateEntry> {
    const paths = this.getMatchingPaths(pattern);
    const results = new Map<string, StateEntry>();

    for (const path of paths) {
      const entry = this.entries.get(path);
      if (entry) {
        results.set(path, entry);
      }
    }

    return results;
  }

  /**
   * Get all entries owned by a specific namespace.
   */
  getEntriesByOwner(owner: string): Map<string, StateEntry> {
    const results = new Map<string, StateEntry>();

    for (const [path, entry] of this.entries) {
      if (entry.owner === owner) {
        results.set(path, entry);
      }
    }

    return results;
  }

  /**
   * Get a snapshot of all state.
   */
  getSnapshot(): StateSnapshot {
    return {
      entries: new Map(this.entries),
      timestamp: Date.now(),
      version: this.globalVersion,
    };
  }

  /**
   * Get a snapshot of state matching a pattern.
   */
  getSnapshotForPattern(pattern: string): StateSnapshot {
    return {
      entries: this.getMatchingEntries(pattern),
      timestamp: Date.now(),
      version: this.globalVersion,
    };
  }

  /**
   * Get the total number of entries.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Get the global version counter.
   */
  get version(): number {
    return this.globalVersion;
  }

  // ---------------------------------------------------------------------------
  // Write Operations
  // ---------------------------------------------------------------------------

  /**
   * Set a state value.
   * Returns the delta if the value changed, null otherwise.
   */
  set(path: string, value: unknown, owner: string): StateDelta | null {
    const existing = this.entries.get(path);

    // Check ownership
    if (existing && existing.owner !== owner) {
      throw new StateOwnershipError(path, existing.owner, owner);
    }

    // Check if value actually changed
    if (existing && !valueChanged(existing.value, value)) {
      return null;
    }

    const previousVersion = existing?.version ?? null;
    const newVersion = (existing?.version ?? 0) + 1;

    const entry: StateEntry = {
      value,
      owner,
      version: newVersion,
      stale: false,
      updatedAt: Date.now(),
      path,
    };

    this.entries.set(path, entry);
    this.globalVersion++;

    const delta: StateDelta = {
      path,
      entry,
      previousVersion,
    };

    this.notifyListeners(delta);
    return delta;
  }

  /**
   * Bulk set multiple values from the same owner.
   * More efficient than individual sets.
   */
  setBulk(updates: StateUpdate[], owner: string): StateDelta[] {
    const deltas: StateDelta[] = [];

    for (const update of updates) {
      const delta = this.set(update.path, update.value, update.owner ?? owner);
      if (delta) {
        deltas.push(delta);
      }
    }

    return deltas;
  }

  /**
   * Delete a state key.
   * Only the owner can delete.
   */
  delete(path: string, owner: string): StateDelta | null {
    const existing = this.entries.get(path);

    if (!existing) {
      return null;
    }

    if (existing.owner !== owner) {
      throw new StateOwnershipError(path, existing.owner, owner);
    }

    this.entries.delete(path);
    this.globalVersion++;

    // Emit delta with null value to indicate deletion
    const delta: StateDelta = {
      path,
      entry: {
        ...existing,
        value: null,
        version: existing.version + 1,
        updatedAt: Date.now(),
      },
      previousVersion: existing.version,
    };

    this.notifyListeners(delta);
    return delta;
  }

  /**
   * Mark all entries from a specific owner as stale.
   * Typically called when an adapter disconnects.
   */
  markOwnerStale(owner: string): StateDelta[] {
    const deltas: StateDelta[] = [];

    for (const [path, entry] of this.entries) {
      if (entry.owner === owner && !entry.stale) {
        const newEntry: StateEntry = {
          ...entry,
          stale: true,
          version: entry.version + 1,
          updatedAt: Date.now(),
        };

        this.entries.set(path, newEntry);
        this.globalVersion++;

        const delta: StateDelta = {
          path,
          entry: newEntry,
          previousVersion: entry.version,
        };

        deltas.push(delta);
        this.notifyListeners(delta);
      }
    }

    return deltas;
  }

  /**
   * Clear stale flag for all entries from an owner.
   * Typically called when an adapter reconnects.
   */
  clearOwnerStale(owner: string): StateDelta[] {
    const deltas: StateDelta[] = [];

    for (const [path, entry] of this.entries) {
      if (entry.owner === owner && entry.stale) {
        const newEntry: StateEntry = {
          ...entry,
          stale: false,
          version: entry.version + 1,
          updatedAt: Date.now(),
        };

        this.entries.set(path, newEntry);
        this.globalVersion++;

        const delta: StateDelta = {
          path,
          entry: newEntry,
          previousVersion: entry.version,
        };

        deltas.push(delta);
        this.notifyListeners(delta);
      }
    }

    return deltas;
  }

  /**
   * Delete all entries from a specific owner.
   */
  deleteByOwner(owner: string): StateDelta[] {
    const deltas: StateDelta[] = [];

    for (const [path, entry] of this.entries) {
      if (entry.owner === owner) {
        this.entries.delete(path);
        this.globalVersion++;

        const delta: StateDelta = {
          path,
          entry: {
            ...entry,
            value: null,
            version: entry.version + 1,
            updatedAt: Date.now(),
          },
          previousVersion: entry.version,
        };

        deltas.push(delta);
        this.notifyListeners(delta);
      }
    }

    return deltas;
  }

  /**
   * Clear all state.
   */
  clear(): void {
    const paths = Array.from(this.entries.keys());

    for (const path of paths) {
      const entry = this.entries.get(path)!;
      const delta: StateDelta = {
        path,
        entry: {
          ...entry,
          value: null,
          version: entry.version + 1,
          updatedAt: Date.now(),
        },
        previousVersion: entry.version,
      };
      this.notifyListeners(delta);
    }

    this.entries.clear();
    this.globalVersion++;
  }

  // ---------------------------------------------------------------------------
  // Change Listeners
  // ---------------------------------------------------------------------------

  /**
   * Add a listener for state changes.
   */
  addListener(listener: StateChangeListener): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a state change listener.
   */
  removeListener(listener: StateChangeListener): void {
    this.listeners.delete(listener);
  }

  private notifyListeners(delta: StateDelta): void {
    for (const listener of this.listeners) {
      try {
        listener(delta);
      } catch (error) {
        // Log but don't throw - one listener failure shouldn't affect others
        console.error('State listener error:', error);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Message Conversion
  // ---------------------------------------------------------------------------

  /**
   * Convert a state entry to a StateMessage.
   */
  entryToMessage(path: string, entry: StateEntry): StateMessage {
    return createState(
      {
        source: this.source,
        path,
        value: entry.value,
        stale: entry.stale || undefined,
        owner: entry.owner,
        version: entry.version,
      },
      this.sequenceCounter.next()
    );
  }

  /**
   * Generate StateMessages for a snapshot.
   */
  snapshotToMessages(snapshot: StateSnapshot): StateMessage[] {
    const messages: StateMessage[] = [];

    for (const [path, entry] of snapshot.entries) {
      messages.push(this.entryToMessage(path, entry));
    }

    return messages;
  }

  /**
   * Generate a StateMessage from a delta.
   */
  deltaToMessage(delta: StateDelta): StateMessage {
    return this.entryToMessage(delta.path, delta.entry);
  }
}

// -----------------------------------------------------------------------------
// Pattern Matching
// -----------------------------------------------------------------------------

/**
 * Convert a subscription pattern to a regular expression.
 * - `*` matches a single path segment
 * - `**` matches zero or more path segments
 */
export function patternToRegex(pattern: string): RegExp {
  // Escape regex special characters except * and **
  let escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\./g, '\\.'); // Dots are literal in paths

  // Handle ** first (multi-level wildcard)
  escaped = escaped.replace(/\*\*/g, '{{DOUBLE_STAR}}');

  // Handle * (single-level wildcard)
  escaped = escaped.replace(/\*/g, '[^.]+');

  // Replace placeholder with actual multi-level pattern
  escaped = escaped.replace(/\{\{DOUBLE_STAR\}\}/g, '.*');

  return new RegExp(`^${escaped}$`);
}

/**
 * Check if a path matches a pattern.
 */
export function pathMatchesPattern(path: string, pattern: string): boolean {
  return patternToRegex(pattern).test(path);
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function valueChanged(oldValue: unknown, newValue: unknown): boolean {
  // Fast path for primitives
  if (oldValue === newValue) {
    return false;
  }

  // Deep comparison for objects/arrays
  try {
    return JSON.stringify(oldValue) !== JSON.stringify(newValue);
  } catch {
    // If serialisation fails, assume changed
    return true;
  }
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class StateOwnershipError extends Error {
  constructor(
    public readonly path: string,
    public readonly currentOwner: string,
    public readonly attemptedOwner: string
  ) {
    super(
      `State key '${path}' is owned by '${currentOwner}', cannot be modified by '${attemptedOwner}'`
    );
    this.name = 'StateOwnershipError';
  }
}
