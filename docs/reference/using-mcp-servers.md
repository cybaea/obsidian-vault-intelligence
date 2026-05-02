# Using MCP Servers

Vault Intelligence supports the **Model Context Protocol (MCP)**, allowing you to connect local or remote tools to your AI agents. This is an advanced feature primarily used to extend the capabilities of local models (like Ollama).

## Transport Types

Vault Intelligence supports three connection methods:

1. **`stdio`**: Runs the server locally as a child process of Obsidian.
2. **`sse`** & **`streamable_http`**: Connects to a server hosted elsewhere (useful for remote execution or mobile devices).

> [!WARNING] Mobile Limitations
> Due to iOS and Android OS restrictions, Obsidian cannot spawn local background processes. **`stdio` servers will automatically fail on Mobile.** If you use Vault Intelligence on mobile, you must host your MCP servers externally and connect via `sse` or `streamable_http`.

---

## The Electron & Obsidian Environment (Crucial Gotchas)

When configuring a `stdio` server, the command is executed by the Obsidian Electron app, _not_ your interactive terminal.

**The `$PATH` Problem (macOS & Linux):**
When you launch Obsidian from your dock/launcher, it does not inherit the `$PATH` from your `.bashrc` or `.zshrc`. This means commands like `node`, `npx`, `python`, or `uvx` will often fail with "command not found" even if they work perfectly in your terminal.

**The Solution:**
Vault Intelligence attempts to mitigate this by automatically injecting common bin paths (`/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin`) into the server's environment.

However, if you use version managers like **NVM (Node)** or **Pyenv (Python)**, you must explicitly configure your Server Command to use **absolute paths**.

* **Failing Command**: `npx` (Args: `-y`, `@modelcontextprotocol/server-postgres`)
* **Fix (Absolute Path)**: `/Users/yourname/.nvm/versions/node/v20.0.0/bin/npx` (Args: `-y`, `@modelcontextprotocol/server-postgres`)

Windows Users: Vault Intelligence handles path resolution better natively via `;`, but ensure your executable is globally available in your System Environment Variables.

---

## Secure Secret Injection

Never paste raw API keys into the Environment (Env) or Headers fields of your MCP configuration. Those fields are synced in plain text via Obsidian Sync.

Instead, use Vault Intelligence's secure secret manager:

1. Go to the **Advanced Settings** tab in Vault Intelligence.
2. Add a new secret (e.g., Key: `brave_api`, Value: `your-real-key`).
3. In your MCP Server configuration, reference the secret using the `vi-secret:` prefix.
    * Example Env Config: `{"BRAVE_API_KEY": "vi-secret:brave_api"}`

When the server launches, Vault Intelligence will securely inject the real key directly into memory.

---

## Recommended Servers (For Local/Ollama Users)

If you use Gemini, Vault Intelligence already provides native Web Search and Computational Solver tools. However, if you run entirely locally with **Ollama**, you forfeit these built-in tools.

To regain feature parity using local models, we heavily recommend installing the following MCP servers:

1. **Web Search**: `brave-search-mcp-server` or `duckduckgo-mcp`. This allows your local Ollama agent to browse the live web and pull current information into your offline vault.
2. **Computational Solver**: An MCP server that supports **Python Execution** or a REPL environment. This allows the agent to write and execute scripts to answer complex math or logic queries. _Note: Always run code execution MCPs within a designated secure environment or container._

---

## Note for Flatpak Users (Linux)

If Obsidian is installed using flatpak, like the default on Fedora Linux, then you should use `flatpak-spawn` to run the MCP server.

First, enable D-bus access for Obsidian (you only need to do this once):

```bash
flatpak override --user --talk-name=org.freedesktop.Flatpak md.obsidian.Obsidian
```

Make sure you restart Obsidian after running this command. It is not sufficient to reload it: you must exit completely.

Then, in the MCP Tools settings, use `flatpak-spawn` as the command. For the arguments, place each one on separate lines, for example:

```
--host
uvx
--from
git+https://github.com/rhel-lightspeed/linux-mcp-server.git
linux-mcp-server
```
