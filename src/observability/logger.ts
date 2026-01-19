/**
 * Structured Logger
 *
 * JSON-formatted logging with correlation ID propagation.
 * Built on pino for high-performance structured logging.
 */

import pino from 'pino';

// -----------------------------------------------------------------------------
// Logger Configuration
// -----------------------------------------------------------------------------

export interface LoggerConfig {
  /** Log level */
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Pretty print for development */
  pretty: boolean;
  /** Base context to include in all logs */
  base?: Record<string, unknown>;
  /** Custom serializers */
  serializers?: Record<string, (value: unknown) => unknown>;
}

export const DEFAULT_LOGGER_CONFIG: LoggerConfig = {
  level: 'info',
  pretty: process.env['NODE_ENV'] !== 'production',
};

// -----------------------------------------------------------------------------
// Correlation Context
// -----------------------------------------------------------------------------

/**
 * Async local storage for correlation ID propagation.
 */
import { AsyncLocalStorage } from 'async_hooks';

interface LogContext {
  correlationId?: string;
  source?: string;
  [key: string]: unknown;
}

const logContext = new AsyncLocalStorage<LogContext>();

/**
 * Run a function with a specific logging context.
 */
export function withLogContext<T>(context: LogContext, fn: () => T): T {
  return logContext.run(context, fn);
}

/**
 * Get the current logging context.
 */
export function getLogContext(): LogContext | undefined {
  return logContext.getStore();
}

/**
 * Set correlation ID for the current context.
 */
export function setCorrelationId(correlationId: string): void {
  const store = logContext.getStore();
  if (store) {
    store.correlationId = correlationId;
  }
}

// -----------------------------------------------------------------------------
// Logger Factory
// -----------------------------------------------------------------------------

let rootLogger: pino.Logger | null = null;

/**
 * Initialise the root logger.
 */
export function initLogger(config: Partial<LoggerConfig> = {}): pino.Logger {
  const finalConfig = { ...DEFAULT_LOGGER_CONFIG, ...config };

  const options: pino.LoggerOptions = {
    level: finalConfig.level,
    base: {
      service: 'telemetry-bridge',
      ...finalConfig.base,
    },
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
      ...finalConfig.serializers,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Add correlation ID from context
    mixin() {
      const ctx = getLogContext();
      if (ctx) {
        return {
          correlationId: ctx.correlationId,
          source: ctx.source,
        };
      }
      return {};
    },
  };

  if (finalConfig.pretty) {
    rootLogger = pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
    });
  } else {
    rootLogger = pino(options);
  }

  return rootLogger;
}

/**
 * Get the root logger instance.
 */
export function getLogger(): pino.Logger {
  if (!rootLogger) {
    rootLogger = initLogger();
  }
  return rootLogger;
}

/**
 * Create a child logger with additional context.
 */
export function createLogger(bindings: pino.Bindings): pino.Logger {
  return getLogger().child(bindings);
}

// -----------------------------------------------------------------------------
// Convenience Exports
// -----------------------------------------------------------------------------

/**
 * Log at info level.
 */
export function info(msg: string, obj?: object): void {
  getLogger().info(obj, msg);
}

/**
 * Log at debug level.
 */
export function debug(msg: string, obj?: object): void {
  getLogger().debug(obj, msg);
}

/**
 * Log at warn level.
 */
export function warn(msg: string, obj?: object): void {
  getLogger().warn(obj, msg);
}

/**
 * Log at error level.
 */
export function error(msg: string, obj?: object): void {
  getLogger().error(obj, msg);
}

/**
 * Log at trace level.
 */
export function trace(msg: string, obj?: object): void {
  getLogger().trace(obj, msg);
}

/**
 * Log at fatal level.
 */
export function fatal(msg: string, obj?: object): void {
  getLogger().fatal(obj, msg);
}

// -----------------------------------------------------------------------------
// Scoped Loggers
// -----------------------------------------------------------------------------

/**
 * Logger for core components.
 */
export const coreLogger = () => createLogger({ component: 'core' });

/**
 * Logger for Companion adapter.
 */
export const companionLogger = () => createLogger({ component: 'companion' });

/**
 * Logger for Buttons adapter.
 */
export const buttonsLogger = () => createLogger({ component: 'buttons' });

/**
 * Logger for client transport.
 */
export const transportLogger = () => createLogger({ component: 'transport' });

/**
 * Logger for router.
 */
export const routerLogger = () => createLogger({ component: 'router' });
