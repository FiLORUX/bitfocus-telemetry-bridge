/**
 * Telemetry Bridge Orchestrator
 *
 * Main orchestration class that initialises and coordinates all components.
 */

import type { BridgeConfig } from './config/schema.js';
import { loadConfig } from './config/loader.js';
import { StateStore } from './core/state/store.js';
import { MessageRouter } from './core/router/router.js';
import { CompanionAdapter } from './adapters/companion/adapter.js';
import { ClientTransportServer } from './transports/client/server.js';
import {
  initLogger,
  getLogger,
  createLogger,
} from './observability/logger.js';
import {
  HealthManager,
  createStateStoreChecker,
  createRouterChecker,
  createAdapterChecker,
  createTransportChecker,
} from './observability/health.js';
import {
  getMetrics,
  getContentType,
  updateAdapterState,
} from './observability/metrics.js';
import { GuiServer, createGuiServerChecker } from './gui/server.js';
import { createServer, type Server } from 'http';

// -----------------------------------------------------------------------------
// Bridge Class
// -----------------------------------------------------------------------------

export class TelemetryBridge {
  private config: BridgeConfig;
  private logger = createLogger({ component: 'bridge' });

  // Core
  private stateStore: StateStore | null = null;
  private router: MessageRouter | null = null;

  // Adapters
  private companionAdapter: CompanionAdapter | null = null;

  // Transports
  private clientTransport: ClientTransportServer | null = null;

  // Observability
  private healthManager: HealthManager;
  private metricsServer: Server | null = null;
  private healthServer: Server | null = null;
  private guiServer: GuiServer | null = null;

  // State
  private running = false;

  constructor(config?: Partial<BridgeConfig>) {
    this.config = loadConfig({ overrides: config });
    this.healthManager = new HealthManager();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start the telemetry bridge.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Bridge is already running');
    }

    this.logger.info('Starting Telemetry Bridge...');

    try {
      // Initialise logging
      initLogger({
        level: this.config.logging.level,
        pretty: this.config.logging.pretty || this.config.environment === 'development',
      });

      // Initialise core
      await this.initCore();

      // Initialise adapters
      await this.initAdapters();

      // Initialise transports
      await this.initTransports();

      // Initialise observability
      await this.initObservability();

      // Initialise GUI
      await this.initGui();

      this.running = true;
      this.logger.info('Telemetry Bridge started successfully');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to start Telemetry Bridge');
      await this.stop();
      throw error;
    }
  }

  /**
   * Stop the telemetry bridge.
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping Telemetry Bridge...');

    // Stop health checks
    this.healthManager.stopBackgroundChecks();

    // Stop GUI server
    if (this.guiServer) {
      await this.guiServer.stop();
      this.guiServer = null;
    }

    // Stop observability servers
    await this.stopObservabilityServers();

    // Disconnect adapters
    if (this.companionAdapter) {
      await this.companionAdapter.disconnect();
      this.companionAdapter = null;
    }

    // Stop transports
    if (this.clientTransport) {
      await this.clientTransport.stop();
      this.clientTransport = null;
    }

    // Shutdown router
    if (this.router) {
      this.router.shutdown();
      this.router = null;
    }

    this.stateStore = null;
    this.running = false;

    this.logger.info('Telemetry Bridge stopped');
  }

  // ---------------------------------------------------------------------------
  // Initialisation
  // ---------------------------------------------------------------------------

  private async initCore(): Promise<void> {
    this.logger.debug('Initialising core components...');

    // Create state store
    this.stateStore = new StateStore('hub.core');

    // Create router
    this.router = new MessageRouter(this.stateStore);

    // Register health checkers
    this.healthManager.registerChecker(
      'state_store',
      createStateStoreChecker(() => this.stateStore)
    );

    this.healthManager.registerChecker(
      'router',
      createRouterChecker(() => this.router)
    );

    this.logger.debug('Core components initialised');
  }

  private async initAdapters(): Promise<void> {
    this.logger.debug('Initialising adapters...');

    // Companion adapter
    if (this.config.companion.enabled) {
      this.companionAdapter = new CompanionAdapter({
        host: this.config.companion.host,
        port: this.config.companion.port,
        device: this.config.companion.device,
        autoReconnect: this.config.companion.autoReconnect,
        reconnectDelay: this.config.companion.reconnectDelay,
        maxReconnectAttempts: this.config.companion.maxReconnectAttempts,
        heartbeatInterval: this.config.companion.heartbeatInterval,
        connectionTimeout: this.config.companion.connectionTimeout,
      });

      // Add event listeners for metrics
      this.companionAdapter.onEvent((event) => {
        if (event.type === 'connected') {
          updateAdapterState('companion', true);
        } else if (event.type === 'disconnected') {
          updateAdapterState('companion', false);
        }
      });

      // Register health checker
      this.healthManager.registerChecker(
        'companion',
        createAdapterChecker('companion', () => this.companionAdapter)
      );

      // Connect adapter
      await this.companionAdapter.connect(this.router!);

      this.logger.info(
        { host: this.config.companion.host, port: this.config.companion.port },
        'Companion adapter initialised'
      );
    }

    this.logger.debug('Adapters initialised');
  }

  private async initTransports(): Promise<void> {
    this.logger.debug('Initialising transports...');

    // Client transport
    if (this.config.clientTransport.enabled) {
      this.clientTransport = new ClientTransportServer({
        port: this.config.clientTransport.port,
        host: this.config.clientTransport.host,
        maxClients: this.config.clientTransport.maxClients,
        rateLimit: this.config.clientTransport.rateLimit,
        rateLimitWindow: this.config.clientTransport.rateLimitWindow,
        idleTimeout: this.config.clientTransport.idleTimeout,
        requireAuth: this.config.clientTransport.requireAuth,
        authTokens: this.config.clientTransport.authTokens,
        enableCompression: this.config.clientTransport.enableCompression,
        maxMessageSize: this.config.clientTransport.maxMessageSize,
        heartbeatInterval: this.config.clientTransport.heartbeatInterval,
      });

      // Register health checker
      this.healthManager.registerChecker(
        'client_transport',
        createTransportChecker('client_transport', () => this.clientTransport)
      );

      // Start transport
      await this.clientTransport.start(this.router!);

      this.logger.info(
        { host: this.config.clientTransport.host, port: this.config.clientTransport.port },
        'Client transport started'
      );
    }

    this.logger.debug('Transports initialised');
  }

  private async initObservability(): Promise<void> {
    this.logger.debug('Initialising observability...');

    // Metrics server
    if (this.config.metrics.enabled) {
      this.metricsServer = createServer(async (req, res) => {
        if (req.url === this.config.metrics.path) {
          const metrics = await getMetrics();
          res.setHeader('Content-Type', getContentType());
          res.end(metrics);
        } else {
          res.statusCode = 404;
          res.end('Not found');
        }
      });

      await new Promise<void>((resolve) => {
        this.metricsServer!.listen(this.config.metrics.port, () => {
          this.logger.info(
            { port: this.config.metrics.port, path: this.config.metrics.path },
            'Metrics endpoint started'
          );
          resolve();
        });
      });
    }

    // Health server
    if (this.config.health.enabled) {
      this.healthServer = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/health' || req.url === '/health/') {
          const health = await this.healthManager.health();
          res.statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
          res.end(JSON.stringify(health));
        } else if (req.url === '/health/live' || req.url === '/live') {
          const liveness = this.healthManager.liveness();
          res.statusCode = liveness.alive ? 200 : 503;
          res.end(JSON.stringify(liveness));
        } else if (req.url === '/health/ready' || req.url === '/ready') {
          const readiness = await this.healthManager.readiness();
          res.statusCode = readiness.ready ? 200 : 503;
          res.end(JSON.stringify(readiness));
        } else {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      });

      await new Promise<void>((resolve) => {
        this.healthServer!.listen(this.config.health.port, () => {
          this.logger.info(
            { port: this.config.health.port },
            'Health endpoint started'
          );
          resolve();
        });
      });

      // Start background health checks
      this.healthManager.startBackgroundChecks(this.config.health.checkInterval);
    }

    this.logger.debug('Observability initialised');
  }

  private async initGui(): Promise<void> {
    if (!this.config.gui.enabled) {
      return;
    }

    this.logger.debug('Initialising GUI server...');

    this.guiServer = new GuiServer({
      config: this.config.gui,
      getConfig: () => this.config,
      getStateStore: () => this.stateStore,
      getHealthManager: () => this.healthManager,
    });

    // Register health checker
    this.healthManager.registerChecker(
      'gui_server',
      createGuiServerChecker(() => this.guiServer)
    );

    await this.guiServer.start();

    this.logger.info(
      { host: this.config.gui.host, port: this.config.gui.port },
      'GUI server started'
    );
  }

  private async stopObservabilityServers(): Promise<void> {
    if (this.metricsServer) {
      await new Promise<void>((resolve) => {
        this.metricsServer!.close(() => resolve());
      });
      this.metricsServer = null;
    }

    if (this.healthServer) {
      await new Promise<void>((resolve) => {
        this.healthServer!.close(() => resolve());
      });
      this.healthServer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Check if the bridge is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): Readonly<BridgeConfig> {
    return this.config;
  }

  /**
   * Get the state store (for direct access if needed).
   */
  getStateStore(): StateStore | null {
    return this.stateStore;
  }

  /**
   * Get the router (for direct access if needed).
   */
  getRouter(): MessageRouter | null {
    return this.router;
  }

  /**
   * Get the Companion adapter (for direct access if needed).
   */
  getCompanionAdapter(): CompanionAdapter | null {
    return this.companionAdapter;
  }

  /**
   * Get the client transport (for direct access if needed).
   */
  getClientTransport(): ClientTransportServer | null {
    return this.clientTransport;
  }

  /**
   * Get the health manager.
   */
  getHealthManager(): HealthManager {
    return this.healthManager;
  }
}
