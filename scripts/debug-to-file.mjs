import WebSocket from 'ws';
import fs from 'fs';

const LOG_FILE = 'debug_worker.log';

/**
 * Sanitizes a string for logging to prevent log injection.
 * @param {string} s The string to sanitize.
 * @returns {string} The sanitized string.
 */
function sanitize(s) {
    return String(s).replace(/\r?\n|\r/g, ' ');
}

/**
 * Validates a WebSocket URL to prevent SSRF.
 * @param {string} urlStr The URL string to validate.
 * @returns {string} The validated URL string.
 */
function validateDebuggerUrl(urlStr) {
    const url = new URL(urlStr);
    if (url.protocol !== 'ws:') throw new Error('Invalid protocol');
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('Invalid host');
    if (url.port !== '9223') throw new Error('Invalid port');
    return url.href;
}

async function captureLogs() {
    fs.writeFileSync(LOG_FILE, 'Starting log capture...\n');
    try {
        const res = await fetch('http://localhost:9223/json');
        const rawTargets = await res.json();
        
        if (!Array.isArray(rawTargets)) throw new Error("Invalid response from debugger");
        
        const targets = rawTargets.map(t => ({
            type: String(t.type).replace(/[^a-z]/g, ''),
            url: String(t.url).replace(/[^\w.:/ -]/g, ''),
            webSocketDebuggerUrl: validateDebuggerUrl(String(t.webSocketDebuggerUrl))
        }));

        fs.appendFileSync(LOG_FILE, `Found ${sanitize(targets.length)} targets\n`);

        const blobWorkers = targets.filter(t => t.type === 'worker' && t.url.includes('blob:'));
        fs.appendFileSync(LOG_FILE, `Found ${sanitize(blobWorkers.length)} blob workers\n`);

        blobWorkers.forEach((worker, index) => {
            fs.appendFileSync(LOG_FILE, `Connecting to worker ${sanitize(index)}: ${sanitize(worker.url)}\n`);
            const ws = new WebSocket(worker.webSocketDebuggerUrl);

            ws.on('open', () => {
                fs.appendFileSync(LOG_FILE, `WS Open for worker ${sanitize(index)}\n`);
                ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
                ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
            });

            ws.on('message', (data) => {
                const msg = JSON.parse(data);
                if (msg.method === "Runtime.consoleAPICalled") {
                    const text = msg.params.args.map(a => String(a.value || a.description || JSON.stringify(a))).join(' ');
                    fs.appendFileSync(LOG_FILE, `[Worker ${sanitize(index)}] ${sanitize(text)}\n`);
                }
            });

            ws.on('error', (err) => {
                fs.appendFileSync(LOG_FILE, `WS Error for worker ${sanitize(index)}: ${sanitize(err.message)}\n`);
            });
        });

    } catch (err) {
        fs.appendFileSync(LOG_FILE, `Error: ${sanitize(err.message)}\n`);
    }

    setTimeout(() => {
        fs.appendFileSync(LOG_FILE, 'Stopping log capture after 60s...\n');
        process.exit(0);
    }, 60000);
}

captureLogs();
