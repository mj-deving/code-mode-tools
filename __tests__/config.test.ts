import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadConfig, parseArgs } from '../src/config';

describe('config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-mcp-test-'));
  });

  afterEach(() => {
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

    test('auto-discovers tools.json in CWD when --config not provided', () => {
      // tools.json exists in project root, so parseArgs should succeed
      const config = parseArgs(['--timeout', '5000']);
      expect(config.timeout).toBe(5000);
      expect(config.toolSources).toBeDefined();
    });
  });
});
