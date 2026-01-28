/**
 * GUI Server
 *
 * Serves the web GUI and provides API endpoints for configuration and state.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import type { GuiConfig, BridgeConfig } from '../config/schema.js';
import type { StateStore } from '../core/state/store.js';
import type { HealthManager } from '../observability/health.js';
import { createLogger } from '../observability/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface GuiServerOptions {
  config: GuiConfig;
  getConfig: () => BridgeConfig;
  getStateStore: () => StateStore | null;
  getHealthManager: () => HealthManager;
}

// -----------------------------------------------------------------------------
// MIME Types
// -----------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// -----------------------------------------------------------------------------
// GUI Server
// -----------------------------------------------------------------------------

export class GuiServer {
  private readonly logger = createLogger({ component: 'gui' });
  private readonly config: GuiConfig;
  private readonly getConfig: () => BridgeConfig;
  private readonly getStateStore: () => StateStore | null;
  private readonly getHealthManager: () => HealthManager;
  private readonly staticPath: string;
  private server: Server | null = null;
  private running = false;

  constructor(options: GuiServerOptions) {
    this.config = options.config;
    this.getConfig = options.getConfig;
    this.getStateStore = options.getStateStore;
    this.getHealthManager = options.getHealthManager;

    // Static files are in public/gui relative to project root
    this.staticPath = join(__dirname, '..', '..', 'public', 'gui');
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.server = createServer((req, res) => this.handleRequest(req, res));

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.config.port, this.config.host, () => {
        this.server!.removeListener('error', reject);
        this.running = true;
        this.logger.info(
          { host: this.config.host, port: this.config.port },
          'GUI server started'
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.running || !this.server) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.running = false;
        this.server = null;
        this.logger.info('GUI server stopped');
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  // ---------------------------------------------------------------------------
  // Request Handling
  // ---------------------------------------------------------------------------

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      // API routes
      if (url.startsWith('/api/')) {
        await this.handleApi(req, res, url, method);
        return;
      }

      // Static files
      await this.handleStatic(req, res, url);
    } catch (error) {
      this.logger.error({ err: error, url, method }, 'Request error');
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  // ---------------------------------------------------------------------------
  // API Handlers
  // ---------------------------------------------------------------------------

  private async handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    url: string,
    method: string
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');

    switch (url) {
      case '/api/config':
        if (method === 'GET') {
          await this.handleGetConfig(res);
        } else {
          this.methodNotAllowed(res);
        }
        break;

      case '/api/snapshot':
        if (method === 'GET') {
          await this.handleGetSnapshot(res);
        } else {
          this.methodNotAllowed(res);
        }
        break;

      case '/api/health':
        if (method === 'GET') {
          await this.handleGetHealth(res);
        } else {
          this.methodNotAllowed(res);
        }
        break;

      case '/api/info':
        if (method === 'GET') {
          await this.handleGetInfo(res);
        } else {
          this.methodNotAllowed(res);
        }
        break;

      default:
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private async handleGetConfig(res: ServerResponse): Promise<void> {
    const config = this.getConfig();

    // Sanitise config - remove sensitive data
    const sanitised = {
      name: config.name,
      environment: config.environment,
      companion: {
        enabled: config.companion.enabled,
        host: config.companion.host,
        port: config.companion.port,
        device: config.companion.device,
        autoReconnect: config.companion.autoReconnect,
        reconnectDelay: config.companion.reconnectDelay,
      },
      buttons: {
        enabled: config.buttons.enabled,
        autoReconnect: config.buttons.autoReconnect,
      },
      clientTransport: {
        enabled: config.clientTransport.enabled,
        port: config.clientTransport.port,
        host: config.clientTransport.host,
        maxClients: config.clientTransport.maxClients,
        requireAuth: config.clientTransport.requireAuth,
        // Note: authTokens intentionally omitted
      },
      logging: config.logging,
      metrics: config.metrics,
      health: config.health,
      gui: config.gui,
    };

    res.statusCode = 200;
    res.end(JSON.stringify(sanitised, null, 2));
  }

  private async handleGetSnapshot(res: ServerResponse): Promise<void> {
    const store = this.getStateStore();

    if (!store) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: 'State store not available' }));
      return;
    }

    const snapshot = store.getSnapshot();
    const entries: Record<string, unknown> = {};

    for (const [path, entry] of snapshot) {
      entries[path] = {
        value: entry.value,
        owner: entry.owner,
        version: entry.version,
        stale: entry.stale,
        updatedAt: entry.updatedAt,
      };
    }

    res.statusCode = 200;
    res.setHeader('Content-Disposition', `attachment; filename="snapshot-${Date.now()}.json"`);
    res.end(JSON.stringify({
      timestamp: Date.now(),
      storeVersion: store.version,
      entryCount: snapshot.size,
      entries,
    }, null, 2));
  }

  private async handleGetHealth(res: ServerResponse): Promise<void> {
    const healthManager = this.getHealthManager();
    const health = await healthManager.health();

    res.statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    res.end(JSON.stringify(health, null, 2));
  }

  private async handleGetInfo(res: ServerResponse): Promise<void> {
    const config = this.getConfig();
    const store = this.getStateStore();

    res.statusCode = 200;
    res.end(JSON.stringify({
      name: config.name,
      version: '0.1.0',
      environment: config.environment,
      websocketPort: config.clientTransport.port,
      stateEntries: store?.size ?? 0,
      storeVersion: store?.version ?? 0,
    }));
  }

  private methodNotAllowed(res: ServerResponse): void {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // ---------------------------------------------------------------------------
  // Static File Handling
  // ---------------------------------------------------------------------------

  private async handleStatic(
    _req: IncomingMessage,
    res: ServerResponse,
    url: string
  ): Promise<void> {
    // Default to index.html
    let filePath = url === '/' ? '/index.html' : url;

    // Security: prevent directory traversal
    if (filePath.includes('..')) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    const fullPath = join(this.staticPath, filePath);

    try {
      // Check if file exists
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        // Try index.html in directory
        filePath = join(filePath, 'index.html');
        const indexPath = join(this.staticPath, filePath);
        await stat(indexPath);
        await this.serveFile(res, indexPath);
      } else {
        await this.serveFile(res, fullPath);
      }
    } catch {
      // File not found - serve index.html for SPA routing
      try {
        await this.serveFile(res, join(this.staticPath, 'index.html'));
      } catch {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Not found');
      }
    }
  }

  private async serveFile(res: ServerResponse, filePath: string): Promise<void> {
    const ext = extname(filePath);
    const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';

    const content = await readFile(filePath);

    res.statusCode = 200;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(content);
  }
}

// -----------------------------------------------------------------------------
// Health Checker
// -----------------------------------------------------------------------------

export function createGuiServerChecker(
  getServer: () => GuiServer | null
): () => Promise<{
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: number;
  error?: string;
  metadata?: Record<string, unknown>;
}> {
  return async () => {
    const server = getServer();

    if (!server) {
      return {
        name: 'gui_server',
        status: 'unhealthy' as const,
        lastCheck: Date.now(),
        error: 'Server not initialised',
      };
    }

    if (!server.isRunning()) {
      return {
        name: 'gui_server',
        status: 'unhealthy' as const,
        lastCheck: Date.now(),
        error: 'Server not running',
      };
    }

    return {
      name: 'gui_server',
      status: 'healthy' as const,
      lastCheck: Date.now(),
      metadata: { running: true },
    };
  };
}
