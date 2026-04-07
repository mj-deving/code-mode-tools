/**
 * CLI mode — execute code or list tools from the command line.
 *
 * Thin layer over createExecuteHandler / createListToolsHandler.
 * Prints results to stdout and exits.
 */

import type { ServerConfig } from './config';
import type { EngineInterface } from './tools';
import { createExecuteHandler, createListToolsHandler } from './tools';

export type CliCommand = 'exec' | 'list-tools' | 'help' | 'mcp';

export interface CliParsed {
  command: CliCommand;
  /** For exec: the code string to execute */
  code?: string;
  /** Remaining args (after subcommand) for config parsing */
  configArgs: string[];
}

const USAGE = `code-mode-tools — Execute TypeScript code chains with pre-configured tools

USAGE:
  code-mode-tools [--config <path>]                   MCP server mode (stdio)
  code-mode-tools exec [--config <path>] "<code>"     Execute code and print result
  code-mode-tools list-tools [--config <path>]        List available tools
  code-mode-tools --help                              Show this help

OPTIONS:
  --config <path>       Path to tools.json config file (required)
  --timeout <ms>        Override execution timeout
  --memory-limit <mb>   Override memory limit
  --trace               Enable execution tracing

EXAMPLES:
  # MCP server mode (piped)
  echo '{}' | code-mode-tools --config tools.json

  # Execute code
  code-mode-tools exec --config tools.json "const x = 1 + 1; return x;"

  # List tools
  code-mode-tools list-tools --config tools.json
`;

/**
 * Parse CLI argv to detect subcommands vs MCP mode.
 * Returns the command type and remaining args for config parsing.
 */
export function parseCliCommand(argv: string[]): CliParsed {
  if (argv.length === 0) {
    return { command: 'mcp', configArgs: [] };
  }

  // Check for --help anywhere in args
  if (argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help', configArgs: [] };
  }

  const first = argv[0];

  if (first === 'exec') {
    const rest = argv.slice(1);
    // The code is the last non-flag argument
    // Collect flag args and find the code string
    // Flags that take no value (boolean flags)
    const BOOLEAN_FLAGS = new Set(['--trace']);

    const configArgs: string[] = [];
    let code: string | undefined;

    for (let i = 0; i < rest.length; i++) {
      if (rest[i].startsWith('--')) {
        configArgs.push(rest[i]);
        // Only consume next arg as value for non-boolean flags
        if (!BOOLEAN_FLAGS.has(rest[i]) && i + 1 < rest.length && !rest[i + 1].startsWith('--')) {
          configArgs.push(rest[++i]);
        }
      } else {
        // Non-flag argument — this is the code
        code = rest[i];
      }
    }

    if (!code) {
      throw new Error('exec command requires a code argument. Usage: exec [--config <path>] "<code>"');
    }

    return { command: 'exec', code, configArgs };
  }

  if (first === 'list-tools') {
    return { command: 'list-tools', configArgs: argv.slice(1) };
  }

  // No subcommand — MCP mode, pass all args through
  return { command: 'mcp', configArgs: argv };
}

/**
 * Print help text to stdout.
 */
export function printHelp(): void {
  process.stdout.write(USAGE);
}

/**
 * Run the exec command: create engine, execute code, print result, exit.
 */
export async function runExec(
  engine: EngineInterface,
  code: string,
  config: ServerConfig,
): Promise<void> {
  const handler = createExecuteHandler(engine);
  const result = await handler({
    code,
    timeout: config.timeout,
    memoryLimit: config.memoryLimit,
    enableTrace: config.enableTrace,
  });

  const text = result.content[0].text;
  const parsed = JSON.parse(text);

  // Pretty-print result to stdout
  process.stdout.write(JSON.stringify(parsed, null, 2) + '\n');

  if (result.isError) {
    process.exitCode = 1;
  }
}

/**
 * Run the list-tools command: create engine, get descriptions, print, exit.
 */
export async function runListTools(engine: EngineInterface): Promise<void> {
  const handler = createListToolsHandler(engine);
  const result = await handler({});
  process.stdout.write(result.content[0].text + '\n');
}

export { USAGE };
