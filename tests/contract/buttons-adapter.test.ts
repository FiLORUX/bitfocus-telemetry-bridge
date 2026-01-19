/**
 * Buttons Adapter Contract Tests
 *
 * These tests verify that any implementation of the ButtonsAdapter interface
 * satisfies the expected contract. The placeholder implementation must pass
 * these tests, and any future real implementation must also pass them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ButtonsSimulator,
  SimulatedButtonsTransport,
  STREAM_DECK_CONFIGS,
} from '../../src/adapters/buttons/simulator.js';
import {
  ButtonsPlaceholderAdapter,
  SimpleButtonsCodec,
} from '../../src/adapters/buttons/adapter.js';
import type { ButtonsAdapter, ButtonsDevice } from '../../src/adapters/buttons/types.js';
import { StateStore } from '../../src/core/state/store.js';
import { MessageRouter } from '../../src/core/router/router.js';

describe('ButtonsAdapter Contract', () => {
  let simulator: ButtonsSimulator;
  let transport: SimulatedButtonsTransport;
  let adapter: ButtonsAdapter;
  let stateStore: StateStore;
  let router: MessageRouter;

  beforeEach(async () => {
    // Create simulator with a standard Stream Deck
    simulator = new ButtonsSimulator({
      initialDevices: [STREAM_DECK_CONFIGS.STANDARD!],
    });

    transport = simulator.getTransport();
    const codec = new SimpleButtonsCodec();

    // Create adapter
    adapter = new ButtonsPlaceholderAdapter(transport, codec);

    // Create router
    stateStore = new StateStore();
    router = new MessageRouter(stateStore);

    // Connect adapter
    await adapter.connect(router);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('connection lifecycle', () => {
    it('should report connected state after connect', () => {
      expect(adapter.isConnected()).toBe(true);
    });

    it('should report disconnected state after disconnect', async () => {
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('should have a valid namespace', () => {
      expect(adapter.namespace).toBe('buttons.device');
    });
  });

  describe('device discovery', () => {
    it('should discover devices from simulator', async () => {
      // Wait for device discovery
      await new Promise((resolve) => setTimeout(resolve, 50));

      const devices = adapter.getDevices();
      expect(devices.length).toBeGreaterThan(0);
    });

    it('should return device by ID', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const device = adapter.getDevice('stream-deck-001');
      expect(device).toBeDefined();
      expect(device?.name).toBe('Stream Deck');
    });

    it('should return undefined for unknown device', () => {
      expect(adapter.getDevice('nonexistent')).toBeUndefined();
    });

    it('should handle device removal', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(adapter.getDevice('stream-deck-001')).toBeDefined();

      simulator.removeDevice('stream-deck-001');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(adapter.getDevice('stream-deck-001')).toBeUndefined();
    });
  });

  describe('key state', () => {
    it('should track key state from simulator', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      simulator.pressKey('stream-deck-001', 0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const state = adapter.getKeyState('stream-deck-001', 0);
      expect(state).toBeDefined();
      expect(state?.pressed).toBe(true);
    });

    it('should update key state on release', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      simulator.pressKey('stream-deck-001', 0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      simulator.releaseKey('stream-deck-001', 0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const state = adapter.getKeyState('stream-deck-001', 0);
      expect(state?.pressed).toBe(false);
    });
  });

  describe('key commands', () => {
    it('should set key image', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      // This should not throw
      await adapter.setKeyImage('stream-deck-001', 0, 'base64imagedata');
    });

    it('should set key text', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      await adapter.setKeyText('stream-deck-001', 0, 'Test');
    });

    it('should set key colour', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      await adapter.setKeyColour('stream-deck-001', 0, '#FF0000');
    });

    it('should clear key', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      await adapter.clearKey('stream-deck-001', 0);
    });

    it('should set brightness', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      await adapter.setBrightness('stream-deck-001', 80);
    });

    it('should reject commands when disconnected', async () => {
      await adapter.disconnect();

      await expect(adapter.setKeyImage('stream-deck-001', 0, 'data')).rejects.toThrow();
    });
  });

  describe('state and metrics', () => {
    it('should provide adapter state', () => {
      const state = adapter.getState();

      expect(state).toHaveProperty('connectionState');
      expect(state).toHaveProperty('lastConnected');
      expect(state).toHaveProperty('lastDisconnected');
      expect(state).toHaveProperty('lastError');
      expect(state).toHaveProperty('deviceCount');
    });

    it('should provide metrics', () => {
      const metrics = adapter.getMetrics();

      expect(metrics).toHaveProperty('deviceCount');
      expect(metrics).toHaveProperty('keyEvents');
      expect(metrics).toHaveProperty('encoderEvents');
      expect(metrics).toHaveProperty('commandsSent');
      expect(metrics).toHaveProperty('commandsFailed');
      expect(metrics).toHaveProperty('reconnects');
    });

    it('should track command metrics', async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      const before = adapter.getMetrics();

      await adapter.setKeyText('stream-deck-001', 0, 'Test');

      const after = adapter.getMetrics();
      expect(after.commandsSent).toBe(before.commandsSent + 1);
    });
  });

  describe('event handling', () => {
    it('should emit events for key presses', async () => {
      const events: unknown[] = [];
      adapter.onEvent((e) => events.push(e));

      await new Promise((resolve) => setTimeout(resolve, 50));

      simulator.pressKey('stream-deck-001', 5);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events.some((e: any) => e.type === 'key_pressed')).toBe(true);
    });

    it('should allow removing event handlers', async () => {
      const events: unknown[] = [];
      const handler = (e: unknown) => events.push(e);

      adapter.onEvent(handler);
      adapter.offEvent(handler);

      simulator.pressKey('stream-deck-001', 0);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events).toHaveLength(0);
    });
  });
});

describe('ButtonsSimulator', () => {
  let simulator: ButtonsSimulator;

  beforeEach(() => {
    simulator = new ButtonsSimulator({
      initialDevices: [STREAM_DECK_CONFIGS.STANDARD!],
    });
  });

  describe('device management', () => {
    it('should have initial devices', () => {
      expect(simulator.getDevices()).toHaveLength(1);
    });

    it('should add devices', () => {
      simulator.addDevice(STREAM_DECK_CONFIGS.MINI!);
      expect(simulator.getDevices()).toHaveLength(2);
    });

    it('should remove devices', () => {
      expect(simulator.removeDevice('stream-deck-001')).toBe(true);
      expect(simulator.getDevices()).toHaveLength(0);
    });
  });

  describe('event simulation', () => {
    it('should log key press events', () => {
      simulator.pressKey('stream-deck-001', 0);

      const log = simulator.getEventLog();
      expect(log.some((e) => e.event.type === 'key_event')).toBe(true);
    });

    it('should update key state on press/release', () => {
      simulator.pressKey('stream-deck-001', 0);
      expect(simulator.getKeyState('stream-deck-001', 0)?.pressed).toBe(true);

      simulator.releaseKey('stream-deck-001', 0);
      expect(simulator.getKeyState('stream-deck-001', 0)?.pressed).toBe(false);
    });

    it('should simulate tap (press + release)', async () => {
      simulator.tapKey('stream-deck-001', 0, 50);

      // Immediately after tap, should be pressed
      expect(simulator.getKeyState('stream-deck-001', 0)?.pressed).toBe(true);

      // After hold duration, should be released
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(simulator.getKeyState('stream-deck-001', 0)?.pressed).toBe(false);
    });
  });

  describe('scripting', () => {
    it('should execute scripts', async () => {
      simulator.clearEventLog();

      await simulator.runScript({
        name: 'test-script',
        actions: [
          { type: 'press', deviceId: 'stream-deck-001', keyIndex: 0 },
          { type: 'delay', ms: 10 },
          { type: 'release', deviceId: 'stream-deck-001', keyIndex: 0 },
        ],
      });

      const log = simulator.getEventLog();
      expect(log.filter((e) => e.event.type === 'key_event')).toHaveLength(2);
    });
  });
});
