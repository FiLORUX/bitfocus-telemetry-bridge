# ADR 002: Use Companion Satellite API

## Status

Accepted

## Context

We need to integrate with Bitfocus Companion for:
- Receiving variable values and changes
- Sending button presses and releases
- Receiving key/button state (images, text, colours)
- Detecting capabilities

Companion exposes several interfaces:
1. **REST API** - Limited, mostly for configuration
2. **Satellite API** (WebSocket) - Full control surface protocol
3. **Internal APIs** - Undocumented, subject to change

## Decision

We use the **Satellite API** (WebSocket protocol on port 16622) because:

1. It is the official interface for external control surfaces
2. It is documented and stable
3. It supports all required features:
   - Device registration
   - Variable subscriptions
   - Key press/release
   - Key state updates (images, colours, text)
   - Brightness control
4. It is designed for real-time, bidirectional communication
5. It supports capability negotiation

### Protocol Overview

```
Client -> Companion: BEGIN <deviceId> <productName> <keysPerRow> <keysTotal>
Companion -> Client: ADD-DEVICE <deviceId> [capabilities...]
Companion -> Client: KEY-STATE <deviceId> <keyIndex> [PRESSED|RELEASED] [COLOR:hex] [TEXT:encoded]
Companion -> Client: VARIABLES-UPDATE <varName>=<value> [...]
Client -> Companion: KEY-PRESS <deviceId> <keyIndex> PRESSED|RELEASED
Client -> Companion: VARIABLE-VALUE <name>=<value>
Client -> Companion: PING
Companion -> Client: PONG
```

## Consequences

### Positive

- Official, supported interface
- Feature complete for our needs
- Built-in capability detection
- Real-time updates

### Negative

- Protocol is text-based (not as efficient as binary)
- Some features (like variable write) may not be available on older Companion versions
- Need to maintain protocol compatibility across Companion versions

## Notes

The Satellite API was originally designed for the Satellite hardware product, but Companion has generalised it for any external control surface. Our "device" is virtual.
