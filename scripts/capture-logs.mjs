import WebSocket from 'ws';

async function captureLogs() {
    const res = await fetch('http://localhost:9223/json');
    const rawTargets = await res.json();

    if (!Array.isArray(rawTargets)) {
        console.error("Invalid response from debugger");
        process.exit(1);
    }

    const targets = rawTargets.map(t => ({
        type: String(t.type).replace(/[^a-z]/g, ''),
        url: String(t.url).replace(/[^\w.:/ -]/g, ''),
        webSocketDebuggerUrl: String(t.webSocketDebuggerUrl).replace(/[^\w.:/ -]/g, '')
    }));

    const worker = targets.find(t => t.type === 'worker' && t.url.includes('blob:'));

    if (!worker) {
        console.log("No worker found");
        process.exit(1);
    }

    const ws = new WebSocket(worker.webSocketDebuggerUrl);
    ws.on('open', () => {
        ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data);
        if (msg.method === "Runtime.consoleAPICalled") {
            const text = msg.params.args.map(a => String(a.value || a.description)).join(' ').replace(/[\n\r]/g, ' ');
            console.log(`[CDP LOG] ${text.replace(/[\n\r]/g, ' ')}`);
        }
    });

    ws.on('error', (err) => {
        const sanitizedError = String(err.message || err).replace(/[\n\r]/g, ' ');
        console.error(`WS Error: ${sanitizedError}`);
    });

    // Keep running for 10 seconds to catch initial burst
    setTimeout(() => {
        console.log("Closing logger...");
        ws.close();
        process.exit(0);
    }, 10000);
}

captureLogs();