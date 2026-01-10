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

6. **Monitor Logs**: Specifically look for `[VaultIntelligence]` prefixed logs to track plugin behavior and errors.
