# code-mode-tools

MCP server that exposes [code-mode](https://github.com/mj-deving/n8n-nodes-utcp-codemode) sandbox execution as tools for any MCP-compatible client.

LLMs write TypeScript code that chains tool calls in an isolated sandbox — achieving **96% token savings** vs sequential tool calling.

## Quickstart

```bash
# Install globally
npm install -g code-mode-tools

# Create a config file with your tool sources
cat > tools.json << 'EOF'
{
  "toolSources": [
    {
      "name": "fs",
      "call_template_type": "mcp",
      "config": {
        "mcpServers": {
          "filesystem": {
            "transport": "stdio",
            "command": "node",
            "args": ["/path/to/server-filesystem/dist/index.js", "/allowed/dir"]
          }
        }
      }
    }
  ],
  "timeout": 30000,
  "memoryLimit": 128
}
EOF

# Run the server
code-mode-tools --config ./tools.json
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `execute_code_chain` | Execute TypeScript code in the sandbox with pre-configured tools |
| `list_available_tools` | List available sandbox tools with TypeScript interfaces |

The `execute_code_chain` tool description dynamically includes TypeScript interfaces for all registered tools, so the LLM knows what's available.

## CLI Options

```
--config <path>      Path to config JSON file (required)
--timeout <ms>       Override execution timeout (default: 30000)
--memory-limit <mb>  Override sandbox memory limit (default: 128)
--trace              Enable execution tracing
```

## Config Format

```json
{
  "toolSources": [
    {
      "name": "source-name",
      "call_template_type": "mcp",
      "config": {
        "mcpServers": {
          "server-name": {
            "transport": "stdio",
            "command": "node",
            "args": ["path/to/server.js", "arg1"]
          }
        }
      }
    }
  ],
  "timeout": 30000,
  "memoryLimit": 128,
  "enableTrace": false
}
```

## Client Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "code-mode": {
      "command": "code-mode-tools",
      "args": ["--config", "/path/to/tools.json"]
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "code-mode": {
      "command": "code-mode-tools",
      "args": ["--config", "./tools.json"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "code-mode": {
      "command": "code-mode-tools",
      "args": ["--config", "./tools.json"]
    }
  }
}
```

## Requirements

- Node.js >= 22 (required by isolated-vm)
- Build toolchain for native modules (node-gyp)

## Architecture

```
MCP Client → stdio → code-mode-tools
                        ├── McpServer (2 tools)
                        ├── CodeModeEngine (persisted)
                        │   └── Tool sources (MCP servers, HTTP APIs)
                        └── isolated-vm sandbox
```

## Related

- **[n8n-nodes-utcp-codemode](https://github.com/mj-deving/n8n-nodes-utcp-codemode)** — n8n community node (same engine, for n8n workflows)
- **[code-mode-core](https://www.npmjs.com/package/code-mode-core)** — Platform-agnostic SDK powering both packages

## License

MPL-2.0
