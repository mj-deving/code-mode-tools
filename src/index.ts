#!/usr/bin/env node

/**
 * code-mode-tools — MCP server and CLI for code-mode sandbox execution.
 *
 * Modes:
 *   - MCP server: stdio transport (default, when piped or no subcommand)
 *   - CLI exec:   execute code and print result
 *   - CLI list:   list available tools
 *   - CLI help:   show usage
 *
 * All logging goes to stderr. Stdout is reserved for output (MCP JSON-RPC or CLI results).
 */

import { parseArgs, type ServerConfig, type ToolSourceConfig } from './config';
import { registerTools, type EngineInterface } from './tools';
import { parseCliCommand, printHelp, runExec, runListTools } from './cli';

/** Extended engine interface including registration (used during init). */
interface FullEngine extends EngineInterface {
  registerToolSource(config: ToolSourceConfig): Promise<{
    success: boolean;
    toolNames: string[];
    errors?: string[];
  }>;
}

function log(msg: string): void {
  process.stderr.write(`[code-mode-tools] ${msg}\n`);
}

/**
 * Create and initialize the engine with tool sources registered.
 * Shared by both MCP and CLI modes. Exported for testing.
 */
export async function createEngine(config: ServerConfig): Promise<{
  engine: FullEngine;
  cleanup: () => Promise<void>;
}> {
  // Side-effect: register MCP transport plugin (must be before engine.create)
  await import('@utcp/mcp');

  // Create engine
  const { CodeModeEngine } = await import('code-mode-core');
  const engine: FullEngine = await CodeModeEngine.create();

  let registrations: Array<{
    source: ToolSourceConfig;
    result: Awaited<ReturnType<FullEngine['registerToolSource']>>;
  }>;

  try {
    // Register tool sources in parallel — fail fast on any failure
    registrations = await Promise.all(
      config.toolSources.map(async (source) => {
        log(`Registering tool source: ${source.name} (${source.call_template_type})`);
        const result = await engine.registerToolSource(source);
        return { source, result };
      }),
    );
  } catch (error) {
    await engine.close();
    throw error;
  }

  for (const { source, result } of registrations) {
    if (!result.success) {
      await engine.close();
      throw new Error(
        `Tool source "${source.name}" failed to register: ${(result as any).errors?.join(', ') ?? 'unknown error'}`,
      );
    }
    log(`  Registered tools: ${result.toolNames.join(', ')}`);
  }

  const cleanup = async () => {
    log('Shutting down...');
    await engine.close();
    log('Cleanup complete.');
  };

  return { engine, cleanup };
}

/**
 * Create and initialize the MCP server. Exported for testing.
 * Does NOT connect to transport — caller decides when to connect.
 */
export async function createServer(config: ServerConfig): Promise<{
  server: any; // McpServer — typed as any due to TS2589 (MCP SDK Zod recursion)
  engine: EngineInterface;
  cleanup: () => Promise<void>;
}> {
  const { engine, cleanup: engineCleanup } = await createEngine(config);

  // Create MCP server
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const server = new McpServer({
    name: 'code-mode-tools',
    version: '0.2.0',
  });

  // Register tools (uses dynamic tool descriptions from engine)
  await registerTools(server, engine);
  log('MCP tools registered: execute_code_chain, list_available_tools');

  const cleanup = async () => {
    await server.close();
    await engineCleanup();
  };

  return { server, engine, cleanup };
}

/**
 * Main entry point — detect mode from CLI args, route accordingly.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const parsed = parseCliCommand(argv);

  // Help — print and exit immediately (no config needed)
  if (parsed.command === 'help') {
    printHelp();
    return;
  }

  // Parse config from remaining args
  const config = parseArgs(parsed.configArgs);
  log(`Config loaded: ${config.toolSources.length} tool source(s), timeout=${config.timeout}ms`);

  if (parsed.command === 'exec') {
    const { engine, cleanup } = await createEngine(config);
    try {
      await runExec(engine, parsed.code!, config);
    } finally {
      await cleanup();
    }
    return;
  }

  if (parsed.command === 'list-tools') {
    const { engine, cleanup } = await createEngine(config);
    try {
      await runListTools(engine);
    } finally {
      await cleanup();
    }
    return;
  }

  // Default: MCP server mode
  const { server, cleanup } = await createServer(config);

  // Connect stdio transport
  const { StdioServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/stdio.js'
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('MCP server running on stdio. Waiting for messages...');

  // Clean shutdown on signals
  const onSignal = async () => {
    await cleanup();
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}

// Only run main() when executed directly (not imported in tests)
if (require.main === module) {
  main().catch((err) => {
    log(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
