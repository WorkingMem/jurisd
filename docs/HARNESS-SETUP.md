# Coding-harness setup

jurisd is a stdio Model Context Protocol (MCP) server. Every MCP-capable
coding agent launches it the same way — over standard input/output. Only the
**config file location** and **wrapper format** differ per harness. This page
gives a copy-paste config for each popular harness.

## The one command that never changes

Whatever the harness, the server is launched by one of these:

| Form                                  | When to use                                      |
| ------------------------------------- | ------------------------------------------------ |
| `npx -y jurisd`                       | Published npm package, 0.4.0 and later.          |
| `npx -y github:russellbrenner/jurisd` | Pre-publish or branch-specific GitHub install.   |
| `node /path/to/jurisd/dist/index.js`  | A local clone you build yourself.                |

Every snippet below uses `npx -y jurisd`. Pre-publish, substitute
`github:russellbrenner/jurisd` for `jurisd` in the `args`; nothing else
changes. For a local clone, set `command` to `node` and `args` to the absolute
path of `dist/index.js`.

All env vars are optional (jurisd answers offline with no key). To pass one
— e.g. your jade.io subscription cookie — add an `env` block to the server
entry. See [INSTALL.md](INSTALL.md) for the full env-var reference.

---

## Claude Code

CLI (fastest):

```bash
claude mcp add jurisd -- npx -y jurisd
```

`--scope` controls visibility: `local` (default, private to you in this
project), `project` (written to a committed `.mcp.json`, shared with the
team), `user` (available in all your projects):

```bash
claude mcp add --scope project jurisd -- npx -y jurisd
```

Or edit a project `.mcp.json` directly:

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "npx",
      "args": ["-y", "jurisd"]
    }
  }
}
```

## Claude Desktop

Edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "npx",
      "args": ["-y", "jurisd"],
      "env": { "JADE_SESSION_COOKIE": "" }
    }
  }
}
```

Restart Claude Desktop after editing. (Remove the `env` block if you are not
setting a jade.io cookie.)

## Cursor

Project: `.cursor/mcp.json`. Global: `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "npx",
      "args": ["-y", "jurisd"]
    }
  }
}
```

## Windsurf

Edit `~/.codeium/windsurf/mcp_config.json` (or use Cascade →
Plugins/MCP → "Manage" → "View raw config"):

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "npx",
      "args": ["-y", "jurisd"]
    }
  }
}
```

## VS Code (GitHub Copilot agent mode)

VS Code uses a **`servers`** key (not `mcpServers`) and requires an explicit
`type`. Project: `.vscode/mcp.json`. You can also run **MCP: Add Server** from
the Command Palette.

```json
{
  "servers": {
    "jurisd": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "jurisd"]
    }
  }
}
```

## Cline (VS Code extension)

Open the Cline panel → **MCP Servers** → **Configure MCP Servers**, which opens
`cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "npx",
      "args": ["-y", "jurisd"]
    }
  }
}
```

## Continue

Edit `~/.continue/config.yaml` (global) or a project `.continue/config.yaml`.
Continue's YAML uses an `mcpServers` **list**:

```yaml
mcpServers:
  - name: jurisd
    type: stdio
    command: npx
    args:
      - "-y"
      - jurisd
```

## OpenAI Codex CLI

Edit `~/.codex/config.toml` (or a project `.codex/config.toml`). MCP servers
are TOML tables keyed by name:

```toml
[mcp_servers.jurisd]
command = "npx"
args = ["-y", "jurisd"]
```

Add an env table if needed: `env = { JADE_SESSION_COOKIE = "" }`.

## Zed

Edit `settings.json` (Command Palette → **zed: open settings**). Zed uses a
`context_servers` object keyed by name:

```json
{
  "context_servers": {
    "jurisd": {
      "command": "npx",
      "args": ["-y", "jurisd"],
      "env": {}
    }
  }
}
```

You can also add it via the Agent Panel settings → **Add Custom Server**.

## Gemini CLI

Edit `~/.gemini/settings.json` (global) or a project `.gemini/settings.json`:

```json
{
  "mcpServers": {
    "jurisd": {
      "command": "npx",
      "args": ["-y", "jurisd"]
    }
  }
}
```

## JetBrains AI Assistant / Junie

JetBrains accepts the standard `mcpServers` JSON. **Settings → Tools → AI
Assistant → Model Context Protocol (MCP) → Add**, then either fill in
`command` = `npx`, `args` = `-y jurisd`, or paste the same JSON block used for
Claude Desktop above.

## Any other MCP client

The lowest common denominator is a stdio server with:

- **command**: `npx`
- **args**: `["-y", "jurisd"]`
- **env**: optional, all keys optional (see [INSTALL.md](INSTALL.md))

---

## Verify it works

After wiring it up, confirm the 15-tool surface is live. From a clone you can
run the stdio handshake check directly:

```bash
node scripts/docker-handshake.mjs    # or: npm run build && npm start
```

In your agent, ask it to list its tools or call `list_data_modules` — jurisd
answers from the offline module layer even with no key and no network. If the
agent reports zero jurisd tools, check that `npx` is on the PATH the harness
launches with, and that the harness was restarted after editing its config.

See also: [INSTALL.md](INSTALL.md) (install paths + env vars),
[MCP-COMPATIBILITY.md](MCP-COMPATIBILITY.md) (the stable tool surface),
[DOCKER.md](DOCKER.md) (container wiring).
