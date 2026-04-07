import { registerTools, createExecuteHandler, createListToolsHandler } from '../src/tools';

// Mock engine that mimics CodeModeEngine's public API
function createMockEngine(overrides: Partial<{
  execute: jest.Mock;
  getToolDescription: jest.Mock;
  close: jest.Mock;
}> = {}) {
  return {
    execute: overrides.execute ?? jest.fn().mockResolvedValue({
      result: { files: ['a.txt', 'b.txt'] },
      logs: ['executed successfully'],
    }),
    getToolDescription: overrides.getToolDescription ?? jest.fn().mockResolvedValue(
      'Execute a TypeScript code block with access to registered UTCP tools.\n' +
      'Available tool interfaces:\n' +
      'declare function fs_read_file(args: { path: string }): string;',
    ),
    close: overrides.close ?? jest.fn().mockResolvedValue(undefined),
  };
}

describe('tool handlers', () => {
  describe('execute_code_chain', () => {
    test('returns MCP content array on success', async () => {
      const engine = createMockEngine();
      const handler = createExecuteHandler(engine as any);

      const result = await handler({
        code: 'return fs.read_file({ path: "/tmp/test" })',
      });

      expect(result.content).toBeDefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
      expect(parsed.result).toEqual({ files: ['a.txt', 'b.txt'] });
      expect(parsed.logs).toEqual(['executed successfully']);
      expect(result.isError).toBeUndefined();
    });

    test('returns isError true on sandbox error', async () => {
      const engine = createMockEngine({
        execute: jest.fn().mockResolvedValue({
          result: null,
          logs: [],
          error: 'ReferenceError: x is not defined',
        }),
      });
      const handler = createExecuteHandler(engine as any);

      const result = await handler({ code: 'return x' });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
      expect(parsed.error).toBe('ReferenceError: x is not defined');
    });

    test('respects timeout override parameter', async () => {
      const engine = createMockEngine();
      const handler = createExecuteHandler(engine as any);

      await handler({ code: 'return 1', timeout: 5000 });

      expect(engine.execute).toHaveBeenCalledWith(
        'return 1',
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    test('respects memoryLimit override parameter', async () => {
      const engine = createMockEngine();
      const handler = createExecuteHandler(engine as any);

      await handler({ code: 'return 1', memoryLimit: 256 });

      expect(engine.execute).toHaveBeenCalledWith(
        'return 1',
        expect.objectContaining({ memoryLimit: 256 }),
      );
    });

    test('respects enableTrace parameter', async () => {
      const engine = createMockEngine({
        execute: jest.fn().mockResolvedValue({
          result: 42,
          logs: [],
          trace: [{ toolName: 'fs.read', args: {}, result: 'ok', durationMs: 12 }],
          stats: { totalCalls: 1, totalDurationMs: 12, failures: 0 },
        }),
      });
      const handler = createExecuteHandler(engine as any);

      await handler({ code: 'return 42', enableTrace: true });

      expect(engine.execute).toHaveBeenCalledWith(
        'return 42',
        expect.objectContaining({ enableTrace: true }),
      );
    });

    test('result uses MCP content array with type text', async () => {
      const engine = createMockEngine();
      const handler = createExecuteHandler(engine as any);

      const result = await handler({ code: 'return 1' });

      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toEqual(
        expect.objectContaining({ type: 'text' }),
      );
      // Verify the text is valid JSON
      expect(() => JSON.parse((result.content[0] as any).text)).not.toThrow();
    });
  });

  describe('list_available_tools', () => {
    test('returns tool description string', async () => {
      const engine = createMockEngine();
      const handler = createListToolsHandler(engine as any);

      const result = await handler({});

      expect(result.content).toHaveLength(1);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Execute a TypeScript code block');
      expect(text).toContain('fs_read_file');
    });
  });

  describe('registerTools', () => {
    test('tool description includes TypeScript interfaces', async () => {
      const engine = createMockEngine();
      const toolDescription = await engine.getToolDescription();

      // The description should be used in the MCP tool definition
      expect(toolDescription).toContain('declare function');
      expect(toolDescription).toContain('fs_read_file');
    });

    test('registers memoryLimit as an optional inputSchema parameter', async () => {
      const engine = createMockEngine();
      const server = {
        registerTool: jest.fn(),
      };

      await registerTools(server, engine as any);

      expect(server.registerTool).toHaveBeenCalledWith(
        'execute_code_chain',
        expect.objectContaining({
          inputSchema: expect.objectContaining({
            memoryLimit: expect.any(Object),
          }),
        }),
        expect.any(Function),
      );
    });
  });
});
