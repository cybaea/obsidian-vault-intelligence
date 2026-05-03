import WebSocket from 'ws';

async function connectToDebugger() {
    try {
        const response = await fetch('http://localhost:9223/json');
        const rawTargets = await response.json();

        if (!Array.isArray(rawTargets)) throw new Error("Invalid response from debugger");
        const targets = rawTargets.map(t => ({
            type: String(t.type).replace(/[^a-z]/g, ''),
            url: String(t.url).replace(/[^\w.:/ -]/g, ''),
            webSocketDebuggerUrl: String(t.webSocketDebuggerUrl).replace(/[^\w.:/ -]/g, ''),
            title: String(t.title).replace(/[^\w.:/ -]/g, '')
        }));

        // Find the worker target
        const workerTarget = targets.find(t => t.type === 'worker' && t.url.includes('blob:'));

        if (!workerTarget) {
            console.error("Worker target not found! Is the plugin running and a task triggered?");
            return;
        }

        console.log(`Connecting to worker: ${workerTarget.title}`);
        const ws = new WebSocket(workerTarget.webSocketDebuggerUrl);

        ws.on('open', () => {
            console.log("Connected to worker debugger.");
            // Enable console events
            ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
            ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
        });

        ws.on('message', (data) => {
            const message = JSON.parse(data);
            if (message.method === "Runtime.consoleAPICalled") {
                const args = message.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ').replace(/[\r\n]/g, ' ');
                const sanitizedArgs = String(args).replace(/[\r\n]/g, ' ');
                console.log(`[Worker Console] ${sanitizedArgs}`);
            }
        });

        ws.on('error', (err) => {
            console.error("WebSocket error:", err);
        });

    } catch (e) {
        console.error("Failed to connect:", e);
    }
}

connectToDebugger();