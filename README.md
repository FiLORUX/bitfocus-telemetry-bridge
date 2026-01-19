# Bitfocus Telemetry Bridge

> State-first integration hub for Bitfocus Companion and custom applications.

## What It Is

The Telemetry Bridge is a software integration hub that provides bidirectional, state-first integration between:

- **Bitfocus Companion** (fully implemented, production-grade)
- **Multiple custom applications** (concurrent clients, first-class support)
- **Bitfocus Buttons** (framework and contracts only; full protocol is future work)

It maintains a canonical state store, publishes deltas, provides snapshot-on-connect, and enables external applications to both consume Companion telemetry and send commands.

## What It Is Not

- Not a hardware device or control surface
- Not a replacement for Companion's UI
- Not a generic message broker (it's domain-specific)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BITFOCUS TELEMETRY BRIDGE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌─────────────────────────────────────┐               │
│  │  Companion  │◄───►│         COMPANION ADAPTER           │               │
│  │  (External) │     │  • Satellite API (WebSocket)        │               │
│  └─────────────┘     │  • Variable subscriptions           │               │
│                      │  • Action invocation                │               │
│                      │  • Capability detection             │               │
│                      └──────────────┬──────────────────────┘               │
│                                     │                                       │
│                                     ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                           CORE HUB                                    │  │
│  │  ┌────────────────┐  ┌─────────────────┐  ┌────────────────────────┐ │  │
│  │  │  State Store   │  │  Message Router │  │   Event Log (Append)   │ │  │
│  │  │  • Snapshots   │◄─┤  • Topic-based  ├─►│   • Replay support     │ │  │
│  │  │  • Deltas      │  │  • Wildcards    │  │   • Correlation IDs    │ │  │
│  │  │  • Ownership   │  │  • Backpressure │  │   • Sequencing         │ │  │
│  │  └────────────────┘  └─────────────────┘  └────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                     │                                       │
│           ┌─────────────────────────┼─────────────────────────┐            │
│           │                         │                         │            │
│           ▼                         ▼                         ▼            │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────┐  │
│  │ CLIENT TRANSPORT│     │ CLIENT TRANSPORT│     │  BUTTONS ADAPTER    │  │
│  │ (WebSocket API) │     │ (WebSocket API) │     │  (PLACEHOLDER)      │  │
│  │  App Client 1   │     │  App Client N   │     │  • Interface only   │  │
│  └─────────────────┘     └─────────────────┘     │  • Simulator        │  │
│                                                   │  • Contract tests   │  │
│                                                   └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20 or later
- Bitfocus Companion running with Satellite API enabled

### Installation

```bash
# Clone the repository
git clone https://github.com/thast/bitfocus-telemetry-bridge.git
cd bitfocus-telemetry-bridge

# Install dependencies
npm install

# Build
npm run build
```

### Running in Development

```bash
# Start with default configuration
npm run dev

# Or with a custom config file
npm run dev -- -c ./my-config.json
```

### Running in Production

```bash
# Build first
npm run build

# Start
npm start

# Or use the CLI directly
npx telemetry-bridge -c /path/to/config.json
```

### Configuration

Create a `bridge.config.json` file:

```json
{
  "name": "my-bridge",
  "environment": "production",
  "companion": {
    "enabled": true,
    "host": "localhost",
    "port": 16622
  },
  "clientTransport": {
    "port": 9000,
    "requireAuth": false
  },
  "logging": {
    "level": "info"
  }
}
```

See the [Configuration Guide](docs/guides/configuration.md) for all options.

## Companion Capabilities

| Feature | Supported | Notes |
|---------|-----------|-------|
| Variable subscription | ✅ | Real-time updates |
| Variable write | ✅ | Via commands |
| Button press/release | ✅ | Via Satellite API |
| Key state updates | ✅ | Images, text, colours |
| Brightness control | ✅ | Per-device |
| Encoder rotation | ⚠️ | If Companion supports |
| Auto-reconnect | ✅ | Configurable backoff |
| Capability detection | ✅ | Feature negotiation |

## Bridge Protocol

The hub uses a vendor-agnostic protocol. Key concepts:

### Message Types

- **command**: Request to perform an action
- **event**: Notification of something that happened
- **state**: State update (delta or snapshot)
- **ack**: Acknowledgement of command
- **error**: Error response
- **subscribe/unsubscribe**: Manage subscriptions

### Message Envelope

```typescript
interface BridgeMessage {
  id: string;           // UUID v7 (time-ordered)
  type: string;         // Message type
  source: string;       // Sender namespace
  target?: string;      // Recipient (for commands)
  path: string;         // Hierarchical key
  payload: unknown;     // Type-specific data
  timestamp: number;    // Unix ms
  correlationId?: string;
  sequence: number;     // Monotonic per source
  ttl?: number;         // Command TTL
  idempotencyKey?: string;
}
```

### State Paths

```
companion.variables.internal.tally_pgm
companion.device.<id>.key.<index>
companion.connection.state
buttons.device.<id>.key.<index>
app.<name>.custom.<key>
```

See [Bridge Protocol Specification](docs/specs/BRIDGE-PROTOCOL-v0.1.md) for full details.

## Client Integration

### Connecting

```typescript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9000');

// Send handshake
ws.on('open', () => {
  ws.send(JSON.stringify({
    type: 'handshake',
    name: 'my-app',
    version: '1.0.0',
  }));
});

// Handle response
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === 'handshake_response' && msg.success) {
    console.log('Connected!', msg.namespace);
  }
});
```

### Subscribing to State

```typescript
ws.send(JSON.stringify({
  id: 'sub-1',
  type: 'subscribe',
  source: 'app.myapp',
  path: 'hub.subscriptions',
  payload: {
    patterns: ['companion.variables.**', 'companion.device.*.key.*'],
    snapshot: true,
  },
  timestamp: Date.now(),
  sequence: 1,
}));
```

### Sending Commands

```typescript
ws.send(JSON.stringify({
  id: 'cmd-1',
  type: 'command',
  source: 'app.myapp',
  target: 'companion.satellite',
  path: 'companion.page.1.bank.0',
  payload: {
    action: 'press',
    params: { keyIndex: 5 },
  },
  timestamp: Date.now(),
  sequence: 2,
  idempotencyKey: 'press-5-' + Date.now(),
}));
```

See [examples/client-app](examples/client-app) for a complete working example.

## Buttons Placeholder

The Buttons adapter is scaffolded but not fully implemented. Current status:

| Component | Status |
|-----------|--------|
| Type definitions | ✅ Complete |
| Adapter interface | ✅ Complete |
| Placeholder implementation | ✅ Complete |
| Simulator | ✅ Complete |
| Contract tests | ✅ Complete |
| Full protocol | ❌ Future work |

The placeholder can be used for development and testing while the full implementation is pending.

## Observability

### Metrics (Prometheus)

```bash
curl http://localhost:9090/metrics
```

Key metrics:
- `telemetry_bridge_connections_current` - Active connections by type
- `telemetry_bridge_messages_received_total` - Messages received
- `telemetry_bridge_command_duration_seconds` - Command latency histogram
- `telemetry_bridge_adapter_state` - Adapter connection status

### Health Endpoints

```bash
# Full health report
curl http://localhost:9091/health

# Liveness (is process alive?)
curl http://localhost:9091/health/live

# Readiness (can handle requests?)
curl http://localhost:9091/health/ready
```

### Logging

Logs are structured JSON with correlation ID propagation:

```json
{
  "level": 30,
  "time": "2024-01-17T12:00:00.000Z",
  "service": "telemetry-bridge",
  "component": "companion",
  "correlationId": "abc-123",
  "msg": "Variable updated"
}
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suites
npm run test:contract
npm run test:integration
```

## Project Structure

```
src/
├── core/
│   ├── protocol/     # Message types, schemas, factory
│   ├── state/        # State store with ownership
│   └── router/       # Message routing, subscriptions
├── adapters/
│   ├── companion/    # Full Companion integration
│   └── buttons/      # Placeholder implementation
├── transports/
│   └── client/       # WebSocket server for apps
├── observability/    # Logging, metrics, health
├── config/           # Schema and loader
├── bridge.ts         # Main orchestrator
└── cli.ts            # CLI entry point

tests/
├── unit/             # Unit tests
├── contract/         # Adapter contract tests
└── integration/      # Integration tests

docs/
├── specs/            # Protocol specifications
├── guides/           # Operational guides
└── adr/              # Architecture decisions
```

## Development

### Prerequisites for Development

```bash
# Install development dependencies
npm install

# Run in watch mode
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint
```

### Adding a New Adapter

1. Create adapter directory under `src/adapters/`
2. Define types implementing `XxxAdapter` interface
3. Create simulator for testing
4. Write contract tests
5. Register in router via `registerTarget()`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT
