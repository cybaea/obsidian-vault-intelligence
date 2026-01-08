import WebSocket from 'ws';

async function captureLogs() {
    const res = await fetch('http://localhost:9223/json');
    const targets = await res.json();
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
            const text = msg.params.args.map(a => a.value || a.description).join(' ');
            console.log(`[CDP LOG] ${text}`);
        }
    });

    ws.on('error', (err) => {
        console.error("WS Error:", err);
    });

    // Keep running for 10 seconds to catch initial burst
    setTimeout(() => {
        console.log("Closing logger...");
        ws.close();
        process.exit(0);
    }, 10000);
}

captureLogs();
