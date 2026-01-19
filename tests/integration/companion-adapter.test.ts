/**
 * Companion Adapter Integration Tests
 *
 * Tests the Companion adapter against the simulator.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CompanionAdapter } from '../../src/adapters/companion/adapter.js';
import { CompanionSimulator } from '../../src/adapters/companion/simulator.js';
import { StateStore } from '../../src/core/state/store.js';
import { MessageRouter } from '../../src/core/router/router.js';
import { ConnectionState } from '../../src/adapters/companion/types.js';

describe('CompanionAdapter Integration', () => {
  let simulator: CompanionSimulator;
  let adapter: CompanionAdapter;
  let stateStore: StateStore;
  let router: MessageRouter;
  const PORT = 16623; // Use different port to avoid conflicts

  beforeEach(async () => {
    // Start simulator
    simulator = new CompanionSimulator({
      port: PORT,
      initialVariables: {
        'internal:tally_pgm': 'Camera 1',
        'internal:tally_pvw': 'Camera 2',
        'custom:my_var': 'test value',
      },
    });

    await simulator.start();

    // Create adapter
    adapter = new CompanionAdapter({
      host: 'localhost',
      port: PORT,
      device: {
        deviceId: 'test-device',
        productName: 'Test Bridge',
        keysPerRow: 8,
        keysTotal: 32,
      },
      autoReconnect: false, // Disable for tests
    });

    // Create router
    stateStore = new StateStore();
    router = new MessageRouter(stateStore);
  });

  afterEach(async () => {
    await adapter.disconnect();
    await simulator.stop();
  });

  describe('connection', () => {
    it('should connect to simulator', async () => {
      await adapter.connect(router);

      // Wait for connection
      await waitFor(() => adapter.isConnected(), 2000);

      expect(adapter.isConnected()).toBe(true);
      expect(adapter.getState().connectionState).toBe(ConnectionState.CONNECTED);
    });

    it('should receive initial variables', async () => {
      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      // Wait for variables to sync
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter.getVariable('internal:tally_pgm')).toBe('Camera 1');
      expect(adapter.getVariable('custom:my_var')).toBe('test value');
    });

    it('should emit connected event', async () => {
      const events: unknown[] = [];
      adapter.onEvent((e) => events.push(e));

      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      expect(events.some((e: any) => e.type === 'connected')).toBe(true);
    });

    it('should detect capabilities', async () => {
      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      const caps = adapter.getCapabilities();
      expect(caps.supportsVariables).toBe(true);
      expect(caps.apiVersion).toBeDefined();
    });
  });

  describe('variable updates', () => {
    it('should receive variable updates from simulator', async () => {
      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      // Update variable in simulator
      simulator.setVariable('custom:dynamic', 'new value');

      // Wait for update
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(adapter.getVariable('custom:dynamic')).toBe('new value');
    });

    it('should publish variables to state store', async () => {
      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check state store has variables
      const paths = stateStore.getMatchingPaths('companion.variables.**');
      expect(paths.length).toBeGreaterThan(0);
    });

    it('should emit variable_update event', async () => {
      const events: unknown[] = [];
      adapter.onEvent((e) => events.push(e));

      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      simulator.setVariable('custom:event_test', 'trigger');
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(events.some((e: any) => e.type === 'variable_update')).toBe(true);
    });
  });

  describe('key states', () => {
    it('should receive key state updates', async () => {
      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      // Simulate key state from Companion
      simulator.setKeyState({
        deviceId: 'test-device',
        keyIndex: 0,
        text: 'Button 1',
        colour: '#FF0000',
        pressed: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const state = adapter.getKeyState('test-device', 0);
      expect(state).toBeDefined();
      expect(state?.text).toBe('Button 1');
    });
  });

  describe('commands', () => {
    it('should send key press command', async () => {
      const received: unknown[] = [];
      simulator.onEvent((e) => {
        if (e.type === 'key_press') {
          received.push(e);
        }
      });

      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      // Send command through router
      await router.route({
        id: 'test-cmd-1',
        type: 'command',
        source: 'app.test',
        target: 'companion.satellite',
        path: 'companion.page.1.bank.0',
        payload: {
          action: 'press',
          params: { keyIndex: 5 },
        },
        timestamp: Date.now(),
        sequence: 1,
        idempotencyKey: 'test-press-1',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check simulator received the press
      expect(received.length).toBeGreaterThan(0);
    });

    it('should track command metrics', async () => {
      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      const before = adapter.getMetrics();

      await router.route({
        id: 'test-cmd-2',
        type: 'command',
        source: 'app.test',
        target: 'companion.satellite',
        path: 'companion.page.1.bank.0',
        payload: {
          action: 'press',
          params: { keyIndex: 0 },
        },
        timestamp: Date.now(),
        sequence: 1,
        idempotencyKey: 'test-press-2',
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const after = adapter.getMetrics();
      expect(after.commandsSent).toBeGreaterThan(before.commandsSent);
    });
  });

  describe('disconnection', () => {
    it('should handle graceful disconnect', async () => {
      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      await adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
      expect(adapter.getState().connectionState).toBe(ConnectionState.DISCONNECTED);
    });

    it('should emit disconnected event', async () => {
      const events: unknown[] = [];
      adapter.onEvent((e) => events.push(e));

      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      await adapter.disconnect();

      expect(events.some((e: any) => e.type === 'disconnected')).toBe(true);
    });

    it('should mark state as stale on disconnect', async () => {
      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Get a variable path
      const paths = stateStore.getMatchingPaths('companion.variables.**');

      await adapter.disconnect();

      // Check entries are marked stale
      for (const path of paths) {
        const entry = stateStore.get(path);
        expect(entry?.stale).toBe(true);
      }
    });
  });

  describe('metrics', () => {
    it('should track messages received', async () => {
      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      const metrics = adapter.getMetrics();
      expect(metrics.messagesReceived).toBeGreaterThan(0);
    });

    it('should track variable updates', async () => {
      await adapter.connect(router);
      await waitFor(() => adapter.isConnected(), 2000);

      simulator.setVariable('test:metric', 'value1');
      await new Promise((resolve) => setTimeout(resolve, 50));

      simulator.setVariable('test:metric', 'value2');
      await new Promise((resolve) => setTimeout(resolve, 50));

      const metrics = adapter.getMetrics();
      expect(metrics.variableUpdates).toBeGreaterThan(0);
    });
  });
});

// Utility function to wait for a condition
async function waitFor(condition: () => boolean, timeout: number): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
