# ADR 003: Buttons Integration as Placeholder

## Status

Accepted

## Context

The system should support Bitfocus Buttons as a first-class adapter. However:

1. The full Buttons protocol is not yet finalised
2. We need to define the adapter interface now
3. Development and testing should proceed without waiting for full Buttons implementation
4. Contract tests should be ready for when implementation happens

## Decision

We implement Buttons integration as a **placeholder** with:

### What IS Implemented

1. **Type definitions**: Complete type system for devices, keys, encoders, events
2. **Adapter interface**: Full `ButtonsAdapter` interface contract
3. **Transport abstraction**: Generic transport layer (WebSocket, OSC, MQTT, etc.)
4. **Protocol codec abstraction**: Encode/decode layer for protocol messages
5. **Placeholder adapter**: Working implementation using in-memory transport
6. **Simulator**: Full simulator for testing scenarios
7. **Contract tests**: Test suite that validates the interface contract

### What is NOT Implemented

1. Actual Buttons protocol wire format
2. Real transport connections to Buttons devices
3. Device discovery over network
4. Production-ready error handling for real hardware

### Interface Contract

Any future implementation MUST:

```typescript
interface ButtonsAdapter {
  readonly namespace: string;
  connect(router: MessageRouter): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getDevices(): ButtonsDevice[];
  getDevice(deviceId: string): ButtonsDevice | undefined;
  getKeyState(deviceId: string, keyIndex: number): ButtonsKeyState | undefined;
  setKeyImage(deviceId: string, keyIndex: number, image: string): Promise<void>;
  setKeyText(deviceId: string, keyIndex: number, text: string): Promise<void>;
  setKeyColour(deviceId: string, keyIndex: number, colour: string): Promise<void>;
  clearKey(deviceId: string, keyIndex: number): Promise<void>;
  setBrightness(deviceId: string, level: number): Promise<void>;
  getState(): ButtonsAdapterState;
  getMetrics(): ButtonsAdapterMetrics;
  onEvent(handler: ButtonsAdapterEventHandler): void;
  offEvent(handler: ButtonsAdapterEventHandler): void;
}
```

## Consequences

### Positive

- Development can proceed with simulated Buttons
- Interface is defined and documented
- Contract tests ensure future implementations are compatible
- No breaking changes when real implementation arrives

### Negative

- Placeholder cannot connect to real Buttons devices
- Some real-world edge cases may not be covered
- Interface may need adjustment based on actual protocol

## Migration Path

When full implementation is ready:

1. Implement real transport (WebSocket, etc.)
2. Implement real codec (protocol wire format)
3. Pass placeholder adapter to new implementation
4. Ensure all contract tests pass
5. Remove placeholder, keep simulator for testing
