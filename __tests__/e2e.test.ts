/**
 * E2E integration test — spawns the server as a child process
 * and communicates via MCP JSON-RPC over stdin/stdout.
 *
 * Tests the full MCP protocol flow: initialize → tools/list.
 * Uses empty toolSources to avoid needing real MCP sub-servers.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const SERVER_PATH = path.resolve(__dirname, '../dist/index.js');

/** Send a JSON-RPC message as newline-delimited JSON. */
function sendMessage(proc: ChildProcess, msg: Record<string, unknown>): void {
  proc.stdin!.write(JSON.stringify(msg) + '\n');
}

/**
 * Wait for a JSON-RPC response matching the given request id.
 * Parses newline-delimited JSON from stdout.
 */
function waitForResponse(proc: ChildProcess, expectedId: number, timeoutMs = 10000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for response id=${expectedId}`)),
      timeoutMs,
    );
    let buffer = '';

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();

      // Process complete lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (line.length === 0) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === expectedId) {
            clearTimeout(timer);
            proc.stdout!.removeListener('data', onData);
            resolve(parsed);
            return;
          }
        } catch {
          // Not JSON (e.g. leaked console.log from deps) — skip
        }
      }
    };

    proc.stdout!.on('data', onData);
  });
}

describe('E2E: MCP server protocol', () => {
  let tmpDir: string;
  let configPath: string;
  let proc: ChildProcess;

  beforeAll(() => {
    if (!fs.existsSync(SERVER_PATH)) {
      throw new Error(`Server not built. Run "npm run build" first. Expected: ${SERVER_PATH}`);
    }

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-mcp-e2e-'));
    configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      toolSources: [],
      timeout: 5000,
    }));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
    }
  });

  test('server responds to MCP initialize with server info', async () => {
    proc = spawn('node', [SERVER_PATH, '--config', configPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stderr!.on('data', () => {}); // drain

    await new Promise(r => setTimeout(r, 1500));

    sendMessage(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });

    const resp = await waitForResponse(proc, 1);
    expect(resp.jsonrpc).toBe('2.0');
    expect(resp.id).toBe(1);
    expect(resp.result.serverInfo.name).toBe('code-mode-tools');
    expect(resp.result.capabilities.tools).toBeDefined();

    proc.kill('SIGTERM');
  }, 15000);

  test('tools/list includes execute_code_chain and list_available_tools', async () => {
    proc = spawn('node', [SERVER_PATH, '--config', configPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    proc.stderr!.on('data', () => {}); // drain

    await new Promise(r => setTimeout(r, 1500));

    // Initialize
    sendMessage(proc, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    });
    await waitForResponse(proc, 1);

    // Initialized notification
    sendMessage(proc, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    await new Promise(r => setTimeout(r, 200));

    // List tools
    sendMessage(proc, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    const resp = await waitForResponse(proc, 2);
    expect(resp.result.tools).toBeDefined();

    const toolNames = resp.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('execute_code_chain');
    expect(toolNames).toContain('list_available_tools');

    // Verify execute_code_chain schema
    const execTool = resp.result.tools.find((t: any) => t.name === 'execute_code_chain');
    expect(execTool.inputSchema.properties).toHaveProperty('code');
    expect(execTool.description).toContain('Execute a TypeScript');

    proc.kill('SIGTERM');
  }, 15000);
});
