# ADR 001: State-First Architecture

## Status

Accepted

## Context

We need to design an integration hub that connects Bitfocus Companion with multiple external applications. The hub needs to:

1. Share state/telemetry from Companion to all connected clients
2. Allow clients to send commands to Companion
3. Support multiple concurrent clients
4. Be resilient to disconnections and reconnections

Traditional event-driven architectures have challenges:
- New clients miss events that occurred before connection
- Clients must maintain their own state reconstruction
- State consistency is difficult to guarantee

## Decision

We adopt a **state-first architecture** where:

1. The hub maintains a canonical **state store** with last-known-value semantics
2. Each state key has a single **owner** (namespace) that can write to it
3. On connection, clients receive a **snapshot** of current state
4. After snapshot, clients receive **delta updates** for changes
5. State keys are marked **stale** when their owner disconnects
6. Events are secondary to state - used for ephemeral notifications only

### State Store Properties

- **Ownership**: Each key has exactly one owner. Only the owner can modify.
- **Versioning**: Each key has a monotonic version number.
- **Staleness**: Keys can be marked stale (owner disconnected).
- **Pattern matching**: Subscriptions use wildcard patterns.

### Event Log

Events are logged to an append-only log for:
- Debugging and replay
- Audit trail
- State reconstruction if needed

But events are not the source of truth - state is.

## Consequences

### Positive

- New clients immediately have consistent state
- No "catch-up" logic needed in clients
- Clear ownership prevents conflicts
- Staleness tracking makes disconnections visible
- Deterministic behaviour under normal operation

### Negative

- Memory usage scales with state size
- State store is a single point of truth (must be reliable)
- Some event-only patterns don't fit naturally

## Alternatives Considered

1. **Pure event sourcing**: Rejected because it requires all clients to replay events.
2. **Distributed state**: Rejected as overly complex for this use case.
3. **Request-response only**: Rejected because real-time updates are essential.
