import * as fs from 'fs';
import type { ToolSourceConfig } from 'code-mode-core';

export type { ToolSourceConfig };

export interface ServerConfig {
  toolSources: ToolSourceConfig[];
  timeout: number;
  memoryLimit: number;
  enableTrace: boolean;
}

const DEFAULTS = {
  timeout: 30000,
  memoryLimit: 128,
  enableTrace: false,
} as const;

/**
 * Load and validate config from a JSON file.
 */
export function loadConfig(filePath: string): ServerConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Config file not found: ${filePath} (${msg})`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Failed to parse JSON in config file: ${filePath}`);
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).toolSources)
  ) {
    throw new Error(
      'Config must have a "toolSources" array field',
    );
  }

  const obj = parsed as Record<string, unknown>;
  return {
    toolSources: obj.toolSources as ToolSourceConfig[],
    timeout: typeof obj.timeout === 'number' ? obj.timeout : DEFAULTS.timeout,
    memoryLimit:
      typeof obj.memoryLimit === 'number'
        ? obj.memoryLimit
        : DEFAULTS.memoryLimit,
    enableTrace:
      typeof obj.enableTrace === 'boolean'
        ? obj.enableTrace
        : DEFAULTS.enableTrace,
  };
}

import * as path from 'path';
import * as os from 'os';

/**
 * Auto-discover config file. Search order:
 * 1. ./tools.json (CWD)
 * 2. ~/.config/code-mode-tools/tools.json
 * 3. ~/.config/code-mode-tools/config.json
 * Returns the first path that exists, or undefined.
 */
export function discoverConfig(): string | undefined {
  const candidates = [
    path.resolve('tools.json'),
    path.join(os.homedir(), '.config', 'code-mode-tools', 'tools.json'),
    path.join(os.homedir(), '.config', 'code-mode-tools', 'config.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Parse CLI arguments and load config. Returns merged ServerConfig.
 * If --config is not provided, auto-discovers from CWD or ~/.config/.
 */
export function parseArgs(argv: string[]): ServerConfig {
  let configPath: string | undefined;
  let timeoutOverride: number | undefined;
  let memoryLimitOverride: number | undefined;
  let traceOverride = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--config':
        configPath = argv[++i];
        break;
      case '--timeout':
        timeoutOverride = parseInt(argv[++i], 10);
        break;
      case '--memory-limit':
        memoryLimitOverride = parseInt(argv[++i], 10);
        break;
      case '--trace':
        traceOverride = true;
        break;
    }
  }

  // Auto-discover config if --config not provided
  if (!configPath) {
    configPath = discoverConfig();
  }
  if (!configPath) {
    throw new Error(
      'No config found. Provide --config <path>, or place tools.json in CWD or ~/.config/code-mode-tools/',
    );
  }

  const config = loadConfig(configPath);

  if (timeoutOverride !== undefined && !isNaN(timeoutOverride)) {
    config.timeout = timeoutOverride;
  }
  if (memoryLimitOverride !== undefined && !isNaN(memoryLimitOverride)) {
    config.memoryLimit = memoryLimitOverride;
  }
  if (traceOverride) {
    config.enableTrace = true;
  }

  return config;
}
