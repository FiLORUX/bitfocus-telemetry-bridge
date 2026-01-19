#!/usr/bin/env node

/**
 * Telemetry Bridge CLI
 *
 * Command-line interface for running the telemetry bridge.
 */

import { TelemetryBridge } from './bridge.js';
import { loadConfig, validateConfig } from './config/loader.js';
import { getLogger } from './observability/logger.js';

// -----------------------------------------------------------------------------
// CLI Arguments
// -----------------------------------------------------------------------------

interface CliArgs {
  configPath?: string;
  validate?: boolean;
  help?: boolean;
  version?: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case '-c':
      case '--config':
        result.configPath = args[++i];
        break;

      case '--validate':
        result.validate = true;
        break;

      case '-h':
      case '--help':
        result.help = true;
        break;

      case '-v':
      case '--version':
        result.version = true;
        break;
    }
  }

  return result;
}

// -----------------------------------------------------------------------------
// Help & Version
// -----------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
Bitfocus Telemetry Bridge

Usage: telemetry-bridge [options]

Options:
  -c, --config <path>   Path to configuration file
  --validate            Validate configuration and exit
  -h, --help            Show this help message
  -v, --version         Show version number

Environment Variables:
  BRIDGE_CONFIG_PATH    Path to configuration file
  BRIDGE_*              Configuration overrides (see documentation)

Examples:
  telemetry-bridge                        Start with default config
  telemetry-bridge -c ./my-config.json    Start with custom config
  telemetry-bridge --validate             Validate config and exit

Documentation: https://github.com/thast/bitfocus-telemetry-bridge
`);
}

function printVersion(): void {
  console.log('0.1.0');
}

// -----------------------------------------------------------------------------
// Validation Mode
// -----------------------------------------------------------------------------

function runValidation(configPath?: string): void {
  try {
    const config = loadConfig({ configPath });
    const result = validateConfig(config);

    if (result.valid) {
      console.log('✓ Configuration is valid');
      console.log('\nLoaded configuration:');
      console.log(JSON.stringify(config, null, 2));
      process.exit(0);
    } else {
      console.error('✗ Configuration is invalid:');
      for (const error of result.errors ?? []) {
        console.error(`  - ${error}`);
      }
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Failed to load configuration:');
    console.error(`  ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    printVersion();
    process.exit(0);
  }

  if (args.validate) {
    runValidation(args.configPath);
    return;
  }

  // Create and start bridge
  const bridge = new TelemetryBridge();

  // Handle shutdown signals
  const shutdown = async (signal: string) => {
    getLogger().info({ signal }, 'Received shutdown signal');
    await bridge.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    getLogger().fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    getLogger().fatal({ reason }, 'Unhandled rejection');
    process.exit(1);
  });

  try {
    await bridge.start();

    // Print startup information
    const config = bridge.getConfig();
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║             Bitfocus Telemetry Bridge v0.1.0                 ║
╠══════════════════════════════════════════════════════════════╣
║  Client API:   ws://${config.clientTransport.host}:${config.clientTransport.port.toString().padEnd(25)}  ║
║  Metrics:      http://localhost:${config.metrics.port.toString().padEnd(26)}  ║
║  Health:       http://localhost:${config.health.port.toString().padEnd(26)}  ║
║  Companion:    ${config.companion.host}:${config.companion.port.toString().padEnd(28)}  ║
╚══════════════════════════════════════════════════════════════╝
`);
  } catch (error) {
    console.error('Failed to start bridge:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
