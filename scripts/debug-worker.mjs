import WebSocket from 'ws';

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

async function connectToDebugger() {
    try {
        const response = await fetch('http://localhost:9223/json');
        const rawTargets = await response.json();

        if (!Array.isArray(rawTargets)) throw new Error("Invalid response from debugger");
        
        const targets = rawTargets.map(t => ({
            type: String(t.type).replace(/[^a-z]/g, ''),
            url: String(t.url).replace(/[^\w.:/ -]/g, ''),
            webSocketDebuggerUrl: validateDebuggerUrl(String(t.webSocketDebuggerUrl)),
            title: String(t.title).replace(/[^\w.:/ -]/g, '')
        }));

        const workerTarget = targets.find(t => t.type === 'worker' && t.url.includes('blob:'));

        if (!workerTarget) {
            console.error("Worker target not found! Is the plugin running and a task triggered?");
            return;
        }

        console.log(`Connecting to worker: ${sanitize(workerTarget.title)}`);
        const ws = new WebSocket(workerTarget.webSocketDebuggerUrl);

        ws.on('open', () => {
            console.log("Connected to worker debugger.");
            ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
            ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
        });

        ws.on('message', (data) => {
            const message = JSON.parse(data);
            if (message.method === "Runtime.consoleAPICalled") {
                const args = message.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
                console.log(`[Worker Console] ${sanitize(args)}`);
            }
        });

        ws.on('error', (err) => {
            console.error(`WebSocket error: ${sanitize(err.message || err)}`);
        });

    } catch (e) {
        console.error(`Failed to connect: ${sanitize(e.message || e)}`);
    }
}

connectToDebugger();
