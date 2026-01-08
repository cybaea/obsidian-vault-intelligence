import WebSocket from 'ws';
import fs from 'fs';

const LOG_FILE = 'debug_worker.log';
fs.writeFileSync(LOG_FILE, 'Starting log capture...\n');

async function captureLogs() {
    try {
        const res = await fetch('http://localhost:9223/json');
        const targets = await res.json();
        fs.appendFileSync(LOG_FILE, `Found ${targets.length} targets\n`);

        const blobWorkers = targets.filter(t => t.type === 'worker' && t.url.includes('blob:'));
        fs.appendFileSync(LOG_FILE, `Found ${blobWorkers.length} blob workers\n`);

        blobWorkers.forEach((worker, index) => {
            fs.appendFileSync(LOG_FILE, `Connecting to worker ${index}: ${worker.url}\n`);
            const ws = new WebSocket(worker.webSocketDebuggerUrl);

            ws.on('open', () => {
                fs.appendFileSync(LOG_FILE, `WS Open for worker ${index}\n`);
                ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
                ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
            });

            ws.on('message', (data) => {
                const msg = JSON.parse(data);
                if (msg.method === "Runtime.consoleAPICalled") {
                    const text = msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
                    fs.appendFileSync(LOG_FILE, `[Worker ${index}] ${text}\n`);
                }
            });

            ws.on('error', (err) => {
                fs.appendFileSync(LOG_FILE, `WS Error for worker ${index}: ${err.message}\n`);
            });
        });

    } catch (err) {
        fs.appendFileSync(LOG_FILE, `Error: ${err.message}\n`);
    }

    setTimeout(() => {
        fs.appendFileSync(LOG_FILE, 'Stopping log capture after 60s...\n');
        process.exit(0);
    }, 60000);
}

captureLogs();
