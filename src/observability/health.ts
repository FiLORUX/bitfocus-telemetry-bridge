/**
 * Health Checks
 *
 * Liveness, readiness, and dependency health endpoints.
 */

import type { StateStore } from '../core/state/store.js';
import type { MessageRouter } from '../core/router/router.js';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export const HealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
} as const;

export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

export interface DependencyHealth {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  lastCheck: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface HealthReport {
  status: HealthStatus;
  timestamp: number;
  uptime: number;
  version: string;
  dependencies: DependencyHealth[];
  metrics?: {
    stateEntries: number;
    subscriptions: number;
    clients: number;
  };
}

export interface LivenessReport {
  alive: boolean;
  timestamp: number;
}

export interface ReadinessReport {
  ready: boolean;
  timestamp: number;
  reason?: string;
}

export type HealthChecker = () => Promise<DependencyHealth>;

// -----------------------------------------------------------------------------
// Health Manager
// -----------------------------------------------------------------------------

export class HealthManager {
  private readonly startTime: number;
  private readonly version: string;
  private checkers: Map<string, HealthChecker> = new Map();
  private lastCheckResults: Map<string, DependencyHealth> = new Map();
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(version = '0.1.0') {
    this.startTime = Date.now();
    this.version = version;
  }

  // ---------------------------------------------------------------------------
  // Checker Registration
  // ---------------------------------------------------------------------------

  /**
   * Register a health checker for a dependency.
   */
  registerChecker(name: string, checker: HealthChecker): void {
    this.checkers.set(name, checker);
  }

  /**
   * Unregister a health checker.
   */
  unregisterChecker(name: string): void {
    this.checkers.delete(name);
    this.lastCheckResults.delete(name);
  }

  // ---------------------------------------------------------------------------
  // Health Checks
  // ---------------------------------------------------------------------------

  /**
   * Check liveness (is the process alive and responsive).
   */
  liveness(): LivenessReport {
    return {
      alive: true,
      timestamp: Date.now(),
    };
  }

  /**
   * Check readiness (is the service ready to handle requests).
   */
  async readiness(): Promise<ReadinessReport> {
    // Run all health checks
    const results = await this.runAllChecks();

    // Service is ready if all critical dependencies are healthy
    const unhealthyDeps = results.filter((r) => r.status === HealthStatus.UNHEALTHY);

    if (unhealthyDeps.length > 0) {
      return {
        ready: false,
        timestamp: Date.now(),
        reason: `Unhealthy dependencies: ${unhealthyDeps.map((d) => d.name).join(', ')}`,
      };
    }

    return {
      ready: true,
      timestamp: Date.now(),
    };
  }

  /**
   * Get full health report.
   */
  async health(metrics?: { stateEntries: number; subscriptions: number; clients: number }): Promise<HealthReport> {
    const dependencies = await this.runAllChecks();

    // Determine overall status
    let status: HealthStatus = HealthStatus.HEALTHY;

    const hasUnhealthy = dependencies.some((d) => d.status === HealthStatus.UNHEALTHY);
    const hasDegraded = dependencies.some((d) => d.status === HealthStatus.DEGRADED);

    if (hasUnhealthy) {
      status = HealthStatus.UNHEALTHY;
    } else if (hasDegraded) {
      status = HealthStatus.DEGRADED;
    }

    return {
      status,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      version: this.version,
      dependencies,
      metrics,
    };
  }

  /**
   * Run all registered health checks.
   */
  private async runAllChecks(): Promise<DependencyHealth[]> {
    const results: DependencyHealth[] = [];

    for (const [name, checker] of this.checkers) {
      try {
        const startTime = Date.now();
        const result = await Promise.race([
          checker(),
          this.timeout(5000, name),
        ]);
        result.latencyMs = Date.now() - startTime;
        results.push(result);
        this.lastCheckResults.set(name, result);
      } catch (error) {
        const errorResult: DependencyHealth = {
          name,
          status: HealthStatus.UNHEALTHY,
          lastCheck: Date.now(),
          error: error instanceof Error ? error.message : 'Check failed',
        };
        results.push(errorResult);
        this.lastCheckResults.set(name, errorResult);
      }
    }

    return results;
  }

  /**
   * Create a timeout promise for health checks.
   */
  private timeout(ms: number, name: string): Promise<DependencyHealth> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Health check timeout for ${name}`));
      }, ms);
    });
  }

  // ---------------------------------------------------------------------------
  // Background Checks
  // ---------------------------------------------------------------------------

  /**
   * Start periodic background health checks.
   */
  startBackgroundChecks(intervalMs = 30000): void {
    if (this.checkInterval) {
      return;
    }

    this.checkInterval = setInterval(async () => {
      await this.runAllChecks();
    }, intervalMs);

    // Run initial check
    this.runAllChecks();
  }

  /**
   * Stop background health checks.
   */
  stopBackgroundChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get cached results from last check.
   */
  getLastResults(): DependencyHealth[] {
    return Array.from(this.lastCheckResults.values());
  }

  /**
   * Get uptime in milliseconds.
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }
}

// -----------------------------------------------------------------------------
// Built-in Health Checkers
// -----------------------------------------------------------------------------

/**
 * Create a health checker for the state store.
 */
export function createStateStoreChecker(getStore: () => StateStore | null): HealthChecker {
  return async () => {
    const store = getStore();

    if (!store) {
      return {
        name: 'state_store',
        status: HealthStatus.UNHEALTHY,
        lastCheck: Date.now(),
        error: 'Store not initialised',
      };
    }

    try {
      // Simple check: can we read from the store?
      const size = store.size;

      return {
        name: 'state_store',
        status: HealthStatus.HEALTHY,
        lastCheck: Date.now(),
        metadata: {
          entries: size,
          version: store.version,
        },
      };
    } catch (error) {
      return {
        name: 'state_store',
        status: HealthStatus.UNHEALTHY,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };
}

/**
 * Create a health checker for an adapter.
 */
export function createAdapterChecker(
  name: string,
  getAdapter: () => { isConnected: () => boolean; getState?: () => { lastError: string | null } } | null
): HealthChecker {
  return async () => {
    const adapter = getAdapter();

    if (!adapter) {
      return {
        name,
        status: HealthStatus.UNHEALTHY,
        lastCheck: Date.now(),
        error: 'Adapter not initialised',
      };
    }

    const connected = adapter.isConnected();
    const state = adapter.getState?.();

    if (!connected) {
      return {
        name,
        status: HealthStatus.DEGRADED,
        lastCheck: Date.now(),
        error: state?.lastError ?? 'Not connected',
        metadata: { connected: false },
      };
    }

    return {
      name,
      status: HealthStatus.HEALTHY,
      lastCheck: Date.now(),
      metadata: { connected: true },
    };
  };
}

/**
 * Create a health checker for the router.
 */
export function createRouterChecker(getRouter: () => MessageRouter | null): HealthChecker {
  return async () => {
    const router = getRouter();

    if (!router) {
      return {
        name: 'router',
        status: HealthStatus.UNHEALTHY,
        lastCheck: Date.now(),
        error: 'Router not initialised',
      };
    }

    try {
      const stats = router.getStats();

      return {
        name: 'router',
        status: HealthStatus.HEALTHY,
        lastCheck: Date.now(),
        metadata: {
          targets: stats.registeredTargets,
          pendingCommands: stats.pendingCommands,
          subscriptions: stats.subscriptions.totalSubscriptions,
        },
      };
    } catch (error) {
      return {
        name: 'router',
        status: HealthStatus.UNHEALTHY,
        lastCheck: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };
}

/**
 * Create a health checker for the client transport.
 */
export function createTransportChecker(
  name: string,
  getTransport: () => { isRunning: () => boolean; getSessionCount: () => number } | null
): HealthChecker {
  return async () => {
    const transport = getTransport();

    if (!transport) {
      return {
        name,
        status: HealthStatus.UNHEALTHY,
        lastCheck: Date.now(),
        error: 'Transport not initialised',
      };
    }

    const running = transport.isRunning();

    if (!running) {
      return {
        name,
        status: HealthStatus.UNHEALTHY,
        lastCheck: Date.now(),
        error: 'Transport not running',
      };
    }

    return {
      name,
      status: HealthStatus.HEALTHY,
      lastCheck: Date.now(),
      metadata: {
        running: true,
        clients: transport.getSessionCount(),
      },
    };
  };
}
