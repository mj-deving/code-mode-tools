import { parseCliCommand, runExec, runListTools, USAGE } from '../src/cli';

describe('CLI', () => {
  describe('parseCliCommand', () => {
    test('no args returns mcp mode', () => {
      const result = parseCliCommand([]);
      expect(result.command).toBe('mcp');
      expect(result.configArgs).toEqual([]);
    });

    test('--help returns help command', () => {
      const result = parseCliCommand(['--help']);
      expect(result.command).toBe('help');
    });

    test('-h returns help command', () => {
      const result = parseCliCommand(['-h']);
      expect(result.command).toBe('help');
    });

    test('--help anywhere in args returns help', () => {
      const result = parseCliCommand(['exec', '--config', 'tools.json', '--help']);
      expect(result.command).toBe('help');
    });

    test('exec parses code and config args', () => {
      const result = parseCliCommand([
        'exec', '--config', 'tools.json', 'const x = 1; return x;',
      ]);
      expect(result.command).toBe('exec');
      expect(result.code).toBe('const x = 1; return x;');
      expect(result.configArgs).toEqual(['--config', 'tools.json']);
    });

    test('exec with --timeout passes flags to configArgs', () => {
      const result = parseCliCommand([
        'exec', '--config', 'tools.json', '--timeout', '5000', 'return 42;',
      ]);
      expect(result.command).toBe('exec');
      expect(result.code).toBe('return 42;');
      expect(result.configArgs).toContain('--timeout');
      expect(result.configArgs).toContain('5000');
    });

    test('exec with --trace flag (no value)', () => {
      const result = parseCliCommand([
        'exec', '--config', 'tools.json', '--trace', 'return 1;',
      ]);
      expect(result.command).toBe('exec');
      expect(result.code).toBe('return 1;');
      expect(result.configArgs).toContain('--trace');
    });

    test('exec throws when no code argument provided', () => {
      expect(() => parseCliCommand(['exec', '--config', 'tools.json'])).toThrow(
        /code argument/i,
      );
    });

    test('list-tools passes remaining args as configArgs', () => {
      const result = parseCliCommand(['list-tools', '--config', 'tools.json']);
      expect(result.command).toBe('list-tools');
      expect(result.configArgs).toEqual(['--config', 'tools.json']);
    });

    test('unrecognized first arg falls through to mcp mode', () => {
      const result = parseCliCommand(['--config', 'tools.json']);
      expect(result.command).toBe('mcp');
      expect(result.configArgs).toEqual(['--config', 'tools.json']);
    });
  });

  describe('runExec', () => {
    let stdoutChunks: string[];
    const originalWrite = process.stdout.write;

    beforeEach(() => {
      stdoutChunks = [];
      process.stdout.write = ((chunk: string) => {
        stdoutChunks.push(chunk);
        return true;
      }) as any;
      process.exitCode = undefined;
    });

    afterEach(() => {
      process.stdout.write = originalWrite;
      process.exitCode = undefined;
    });

    function createMockEngine(overrides: Partial<{
      execute: jest.Mock;
      getToolDescription: jest.Mock;
      close: jest.Mock;
    }> = {}) {
      return {
        execute: overrides.execute ?? jest.fn().mockResolvedValue({
          result: 42,
          logs: ['done'],
        }),
        getToolDescription: overrides.getToolDescription ?? jest.fn().mockResolvedValue('tools'),
        close: overrides.close ?? jest.fn().mockResolvedValue(undefined),
      };
    }

    test('prints pretty-printed JSON result to stdout', async () => {
      const engine = createMockEngine();
      await runExec(engine as any, 'return 42;', {
        toolSources: [],
        timeout: 30000,
        memoryLimit: 128,
        enableTrace: false,
      });

      const output = stdoutChunks.join('');
      const parsed = JSON.parse(output);
      expect(parsed.result).toBe(42);
      expect(parsed.logs).toEqual(['done']);
    });

    test('sets exitCode 1 on execution error', async () => {
      const engine = createMockEngine({
        execute: jest.fn().mockResolvedValue({
          result: null,
          logs: [],
          error: 'ReferenceError: x is not defined',
        }),
      });

      await runExec(engine as any, 'return x;', {
        toolSources: [],
        timeout: 30000,
        memoryLimit: 128,
        enableTrace: false,
      });

      expect(process.exitCode).toBe(1);
      const output = stdoutChunks.join('');
      const parsed = JSON.parse(output);
      expect(parsed.error).toContain('ReferenceError');
    });

    test('passes timeout, memoryLimit, and enableTrace from config', async () => {
      const engine = createMockEngine();
      await runExec(engine as any, 'return 1;', {
        toolSources: [],
        timeout: 5000,
        memoryLimit: 256,
        enableTrace: true,
      });

      expect(engine.execute).toHaveBeenCalledWith(
        'return 1;',
        expect.objectContaining({
          timeout: 5000,
          memoryLimit: 256,
          enableTrace: true,
        }),
      );
    });
  });

  describe('runListTools', () => {
    let stdoutChunks: string[];
    const originalWrite = process.stdout.write;

    beforeEach(() => {
      stdoutChunks = [];
      process.stdout.write = ((chunk: string) => {
        stdoutChunks.push(chunk);
        return true;
      }) as any;
    });

    afterEach(() => {
      process.stdout.write = originalWrite;
    });

    test('prints tool description to stdout', async () => {
      const engine = {
        execute: jest.fn(),
        getToolDescription: jest.fn().mockResolvedValue(
          'declare function fs_read_file(args: { path: string }): string;',
        ),
        close: jest.fn(),
      };

      await runListTools(engine as any);

      const output = stdoutChunks.join('');
      expect(output).toContain('fs_read_file');
      expect(output).toContain('declare function');
    });
  });

  describe('USAGE', () => {
    test('contains all subcommands', () => {
      expect(USAGE).toContain('exec');
      expect(USAGE).toContain('list-tools');
      expect(USAGE).toContain('--help');
      expect(USAGE).toContain('--config');
    });
  });
});
