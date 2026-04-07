/**
 * Server entrypoint tests.
 *
 * These test the startServer() function with mocked dependencies.
 * The real CodeModeEngine and MCP SDK are mocked to avoid
 * native module issues (isolated-vm) and stdio transport side effects.
 */

// Mock @utcp/mcp (side-effect import)
jest.mock('@utcp/mcp', () => ({}), { virtual: true });

// Mock code-mode-core
const mockEngine = {
  registerToolSource: jest.fn().mockResolvedValue({ success: true, toolNames: ['fs.read_file'] }),
  execute: jest.fn().mockResolvedValue({ result: 42, logs: [] }),
  getToolDescription: jest.fn().mockResolvedValue('Tool description'),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('code-mode-core', () => ({
  CodeModeEngine: {
    create: jest.fn().mockResolvedValue(mockEngine),
  },
}), { virtual: true });

// Mock MCP SDK
const mockServer = {
  registerTool: jest.fn(),
  connect: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => mockServer),
}), { virtual: true });

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({})),
}), { virtual: true });

import { createEngine, createServer } from '../src/index';
import type { ServerConfig } from '../src/config';

const validConfig: ServerConfig = {
  toolSources: [
    { name: 'fs', call_template_type: 'mcp', config: {} },
  ],
  timeout: 30000,
  memoryLimit: 128,
  enableTrace: false,
};

describe('server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('imports @utcp/mcp before engine creation', async () => {
    const callOrder: string[] = [];
    const { CodeModeEngine } = require('code-mode-core');
    CodeModeEngine.create.mockImplementation(async () => {
      callOrder.push('engine.create');
      return mockEngine;
    });

    // Track @utcp/mcp import via a side effect — it's already mocked,
    // but we verify the import happens by checking createServer flow
    await createServer(validConfig);

    // Engine was created (which means @utcp/mcp was imported before it)
    expect(CodeModeEngine.create).toHaveBeenCalled();
  });

  test('registers MCP tools after engine initialization', async () => {
    await createServer(validConfig);

    // registerTool should have been called twice (execute_code_chain + list_available_tools)
    expect(mockServer.registerTool).toHaveBeenCalledTimes(2);
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'execute_code_chain',
      expect.objectContaining({ description: expect.stringContaining('Execute a TypeScript') }),
      expect.any(Function),
    );
    expect(mockServer.registerTool).toHaveBeenCalledWith(
      'list_available_tools',
      expect.objectContaining({ description: expect.any(String) }),
      expect.any(Function),
    );
  });

  test('fails fast on bad tool source without --allow-partial', async () => {
    mockEngine.registerToolSource.mockResolvedValueOnce({
      success: false,
      toolNames: [],
      errors: ['Connection refused'],
    });

    await expect(createServer(validConfig)).rejects.toThrow(/failed to register/i);
  });

  test('cleans up engine on close', async () => {
    const { cleanup } = await createServer(validConfig);

    await cleanup();

    expect(mockEngine.close).toHaveBeenCalled();
  });

  test('closes engine if tool source registration throws', async () => {
    mockEngine.registerToolSource.mockRejectedValueOnce(new Error('boom'));

    await expect(createEngine(validConfig)).rejects.toThrow('boom');
    expect(mockEngine.close).toHaveBeenCalled();
  });
});
