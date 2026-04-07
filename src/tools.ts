import { z } from 'zod';

/**
 * Minimal engine interface — matches CodeModeEngine's public API.
 * Used for typing without importing the actual class (keeps tests mockable).
 */
export interface EngineInterface {
  execute(
    code: string,
    options?: Partial<{
      timeout: number;
      memoryLimit: number;
      enableTrace: boolean;
    }>,
  ): Promise<{
    result: unknown;
    logs: string[];
    error?: string;
    trace?: unknown[];
    stats?: { totalCalls: number; totalDurationMs: number; failures: number };
  }>;
  getToolDescription(): Promise<string>;
  close(): Promise<void>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Create the execute_code_chain handler (pure function for testability).
 */
export function createExecuteHandler(
  engine: EngineInterface,
): (args: {
  code: string;
  timeout?: number;
  memoryLimit?: number;
  enableTrace?: boolean;
}) => Promise<McpToolResult> {
  return async (args) => {
    const { code, timeout, memoryLimit, enableTrace } = args;

    const options: Partial<{
      timeout: number;
      memoryLimit: number;
      enableTrace: boolean;
    }> = {};
    if (timeout !== undefined) options.timeout = timeout;
    if (memoryLimit !== undefined) options.memoryLimit = memoryLimit;
    if (enableTrace !== undefined) options.enableTrace = enableTrace;

    const execResult = await engine.execute(code, options);

    const payload: Record<string, unknown> = {
      result: execResult.result,
      logs: execResult.logs,
    };

    if (execResult.error) {
      payload.error = execResult.error;
    }
    if (execResult.trace) {
      payload.trace = execResult.trace;
    }
    if (execResult.stats) {
      payload.stats = execResult.stats;
    }

    const response: McpToolResult = {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    };

    if (execResult.error) {
      response.isError = true;
    }

    return response;
  };
}

/**
 * Create the list_available_tools handler (pure function for testability).
 */
export function createListToolsHandler(
  engine: EngineInterface,
): (args: Record<string, unknown>) => Promise<McpToolResult> {
  return async () => {
    const description = await engine.getToolDescription();
    return {
      content: [{ type: 'text' as const, text: description }],
    };
  };
}

/**
 * Register both MCP tools on the server. Called after engine init
 * so the tool description is dynamic (includes registered tool interfaces).
 *
 * Uses `any` for server param to avoid MCP SDK's deep Zod type inference
 * (TS2589: "Type instantiation is excessively deep"). Runtime behavior is correct.
 */
export async function registerTools(
  server: any,
  engine: EngineInterface,
): Promise<void> {
  const toolDescription = await engine.getToolDescription();

  const executeHandler = createExecuteHandler(engine);
  const listHandler = createListToolsHandler(engine);

  server.registerTool(
    'execute_code_chain',
    {
      description:
        'Execute a TypeScript code chain in an isolated sandbox with pre-configured tools. ' +
        'Write TypeScript code that calls tools as synchronous functions. ' +
        'Use `return` to return the final result.\n\n' +
        toolDescription,
      inputSchema: {
        code: z.string().describe('TypeScript code to execute in the sandbox'),
        timeout: z
          .number()
          .optional()
          .describe('Execution timeout in milliseconds (default: 30000)'),
        memoryLimit: z
          .number()
          .optional()
          .describe('Memory limit in megabytes (default: 128)'),
        enableTrace: z
          .boolean()
          .optional()
          .describe('Enable execution tracing for tool call timing'),
      },
    },
    async (args: any) => executeHandler(args),
  );

  server.registerTool(
    'list_available_tools',
    {
      description:
        'List all tools available in the code-mode sandbox with their TypeScript interfaces.',
    },
    async () => listHandler({}),
  );
}
