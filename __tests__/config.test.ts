import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, parseArgs, discoverConfig } from '../src/config';

describe('config', () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-mcp-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(filename: string, content: unknown): string {
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(content));
    return filePath;
  }

  describe('loadConfig', () => {
    test('loads valid config from file path', () => {
      const configPath = writeConfig('valid.json', {
        toolSources: [
          { name: 'fs', call_template_type: 'mcp', config: {} },
        ],
        timeout: 15000,
        memoryLimit: 64,
        enableTrace: true,
      });

      const config = loadConfig(configPath);
      expect(config.toolSources).toHaveLength(1);
      expect(config.toolSources[0].name).toBe('fs');
      expect(config.timeout).toBe(15000);
      expect(config.memoryLimit).toBe(64);
      expect(config.enableTrace).toBe(true);
    });

    test('throws on missing file', () => {
      expect(() => loadConfig('/nonexistent/path.json')).toThrow(/not found|ENOENT/i);
    });

    test('throws on invalid JSON', () => {
      const filePath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(filePath, '{ not valid json }}}');
      expect(() => loadConfig(filePath)).toThrow(/parse|JSON/i);
    });

    test('throws on missing toolSources field', () => {
      const configPath = writeConfig('no-sources.json', {
        timeout: 5000,
      });
      expect(() => loadConfig(configPath)).toThrow(/toolSources/i);
    });

    test('uses defaults for optional fields', () => {
      const configPath = writeConfig('minimal.json', {
        toolSources: [
          { name: 'test', call_template_type: 'mcp' },
        ],
      });

      const config = loadConfig(configPath);
      expect(config.timeout).toBe(30000);
      expect(config.memoryLimit).toBe(128);
      expect(config.enableTrace).toBe(false);
    });
  });

  describe('discoverConfig', () => {
    test('checks only ~/.config/code-mode-tools candidates', () => {
      try {
        jest.resetModules();
        const statSync = jest.fn(() => {
          throw new Error('ENOENT');
        });

        jest.doMock('fs', () => ({
          ...jest.requireActual('fs'),
          statSync,
        }));
        jest.doMock('os', () => ({
          ...jest.requireActual('os'),
          homedir: () => '/fake/home',
        }));

        let isolatedDiscoverConfig: typeof discoverConfig;
        jest.isolateModules(() => {
          ({ discoverConfig: isolatedDiscoverConfig } = require('../src/config'));
        });

        expect(isolatedDiscoverConfig!()).toBeUndefined();
        expect(statSync.mock.calls.map((call: any[]) => String(call[0]))).toEqual([
          '/fake/home/.config/code-mode-tools/tools.json',
          '/fake/home/.config/code-mode-tools/config.json',
        ]);
        expect(statSync).not.toHaveBeenCalledWith(path.resolve('tools.json'));
      } finally {
        jest.dontMock('fs');
        jest.dontMock('os');
        jest.resetModules();
      }
    });

    test('does not discover tools.json from CWD', () => {
      const configPath = path.join(tmpDir, 'tools.json');
      fs.writeFileSync(configPath, JSON.stringify({
        toolSources: [{ name: 'cwd', call_template_type: 'mcp' }],
      }));

      const originalCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        expect(discoverConfig()).toBeUndefined();
      } finally {
        process.chdir(originalCwd);
      }
    });

    test('skips directories that match candidate names', () => {
      // Create a directory named tools.json in tmpDir
      const dirPath = path.join(tmpDir, 'tools.json');
      fs.mkdirSync(dirPath);

      // A directory named tools.json in the CWD should not be returned.
      const originalCwd = process.cwd();
      process.chdir(tmpDir);
      try {
        const result = discoverConfig();
        // Should not return the directory path
        expect(result).not.toBe(dirPath);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('parseArgs', () => {
    test('--timeout overrides config timeout value', () => {
      const configPath = writeConfig('base.json', {
        toolSources: [{ name: 'x', call_template_type: 'mcp' }],
        timeout: 10000,
      });

      const config = parseArgs(['--config', configPath, '--timeout', '60000']);
      expect(config.timeout).toBe(60000);
    });

    test('--memory-limit overrides config memoryLimit value', () => {
      const configPath = writeConfig('base.json', {
        toolSources: [{ name: 'x', call_template_type: 'mcp' }],
        memoryLimit: 128,
      });

      const config = parseArgs(['--config', configPath, '--memory-limit', '256']);
      expect(config.memoryLimit).toBe(256);
    });

    test('--trace flag sets enableTrace to true', () => {
      const configPath = writeConfig('base.json', {
        toolSources: [{ name: 'x', call_template_type: 'mcp' }],
      });

      const config = parseArgs(['--config', configPath, '--trace']);
      expect(config.enableTrace).toBe(true);
    });

    test('throws when --config is omitted and no user config is present', () => {
      expect(() => parseArgs(['--timeout', '5000'])).toThrow(/Provide --config <path>/);
    });

    test('warns on unknown flags', () => {
      const configPath = writeConfig('base.json', {
        toolSources: [{ name: 'x', call_template_type: 'mcp' }],
      });
      const stderrChunks: string[] = [];
      const originalWrite = process.stderr.write;
      process.stderr.write = ((chunk: string) => {
        stderrChunks.push(chunk);
        return true;
      }) as any;

      try {
        parseArgs(['--config', configPath, '--bogus-flag']);
        const output = stderrChunks.join('');
        expect(output).toContain('Warning: unknown flag --bogus-flag');
      } finally {
        process.stderr.write = originalWrite;
      }
    });
  });
});
