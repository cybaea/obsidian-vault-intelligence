---
description: how to start Obsidian with remote debugging and connect to agent DevTools
---

To debug the Obsidian plugin using the agent's browser and DevTools interface:

1. **Find an Unused Port**: Identify an available port for debugging.
```bash
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("", 0)); print(s.getsockname()[1]); s.close()') && echo "Using port: $PORT"
```

2. **Launch Obsidian**: Execute the following command in the terminal using the detected port.
// turbo
```bash
flatpak run md.obsidian.Obsidian --remote-debugging-port=$PORT --remote-allow-origins="*" &
```

3. **Wait for Startup**: Wait a few seconds for Obsidian to fully initialize and open the port.

4. **Check Port**: Verify the port is listening (replace `$PORT` with the actual value).
```bash
nc -zv 127.0.0.1 $PORT
```

5. **Connect via Browser Subagent**: Use the `browser_subagent` tool to connect to `http://localhost:$PORT`.
   - Identify the Obsidian window target.
   - Connect to its WebSocket (found in `http://localhost:$PORT/json`).
   - Enable `Runtime` and `Log` domains to capture console output.

6. **Verify Target Vault**: Ensure you are debugging the 'Allan-Dev' vault.
   - Look for the text **Allan-Dev** in the bottom-left corner of the Obsidian window (visible even if Settings are open).
   - **If incorrect**:
     1. Dismiss any open modals (Settings, etc).
     2. Click the vault name in the bottom-left to open the switcher.
     3. Select **Allan-Dev**.
     4. **Note**: This opens a NEW window. You must locate the new window/process to debug.
     5. If 'Allan-Dev' is not in the list, **STOP** and ask the user for help.

7. **Monitor Logs**: specifically look for `[VaultIntelligence]` prefixed logs.
   - **Success**: "Vault Intelligence loaded", "Index loaded", "Worker initialized".
   - **Failure**: Any red text or stack traces associated with the plugin ID.

> [!WARNING]
> DO NOT use `pkill` or similar commands to restart Obsidian, as this may also terminate the agent process. If you need to restart, ask the user or close the Obsidian window manually.
