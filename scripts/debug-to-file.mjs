import WebSocket from 'ws';
import fs from 'fs';

const LOG_FILE = 'debug_worker.log';
fs.writeFileSync(LOG_FILE, 'Starting log capture...\n');

async function captureLogs() {
    try {
        const res = await fetch('http://localhost:9223/json');
        const rawTargets = await res.json();
        
        // Explicitly sanitize and validate input from network before writing to file
        if (!Array.isArray(rawTargets)) throw new Error("Invalid response from debugger");
        const targets = rawTargets.map(t => ({
            type: String(t.type).replace(/[^a-z]/g, ''),
            url: String(t.url).replace(/[^\w.:/ -]/g, ''),
            webSocketDebuggerUrl: String(t.webSocketDebuggerUrl).replace(/[^\w.:/ -]/g, '')
        }));

        fs.appendFileSync(LOG_FILE, `Found ${String(targets.length).replace(/[\n\r]/g, '')} targets\n`);

        const blobWorkers = targets.filter(t => t.type === 'worker' && t.url.includes('blob:'));
        fs.appendFileSync(LOG_FILE, `Found ${String(blobWorkers.length).replace(/[\n\r]/g, '')} blob workers\n`);

        blobWorkers.forEach((worker, index) => {
            fs.appendFileSync(LOG_FILE, `Connecting to worker ${index}: ${worker.url.replace(/[\n\r]/g, '')}\n`);
            const ws = new WebSocket(worker.webSocketDebuggerUrl);

            ws.on('open', () => {
                fs.appendFileSync(LOG_FILE, `WS Open for worker ${index}\n`);
                ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
                ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
            });

            ws.on('message', (data) => {
                const msg = JSON.parse(data);
                if (msg.method === "Runtime.consoleAPICalled") {
                    const text = msg.params.args.map(a => String(a.value || a.description || JSON.stringify(a))).join(' ').replace(/[\n\r]/g, ' ');
                    fs.appendFileSync(LOG_FILE, `[Worker ${index}] ${text.replace(/[\n\r]/g, ' ')}\n`);
                }
            });

            ws.on('error', (err) => {
                const sanitizedError = String(err.message).replace(/[\n\r]/g, ' ');
                fs.appendFileSync(LOG_FILE, `WS Error for worker ${index}: ${sanitizedError}\n`);
            });
        });

    } catch (err) {
        const sanitizedError = String(err.message).replace(/[\n\r]/g, ' ');
        fs.appendFileSync(LOG_FILE, `Error: ${sanitizedError}\n`);
    }

    setTimeout(() => {
        fs.appendFileSync(LOG_FILE, 'Stopping log capture after 60s...\n');
        process.exit(0);
    }, 60000);
}

captureLogs();