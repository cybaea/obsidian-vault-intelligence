import WebSocket from 'ws';

/**
 * Sanitizes a string for logging to prevent log injection.
 * @param {string} s The string to sanitize.
 * @returns {string} The sanitized string.
 */
function sanitize(s) {
    return String(s)
        // Remove CR/LF and Unicode line separators used for log forging
        .replace(/[\r\n\u2028\u2029]/g, ' ')
        // Remove remaining ASCII control chars (except tab) that can affect log rendering
        .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
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
    try {
        const res = await fetch('http://localhost:9223/json');
        const rawTargets = await res.json();

        if (!Array.isArray(rawTargets)) {
            console.error("Invalid response from debugger");
            process.exit(1);
        }

        const targets = rawTargets.map(t => ({
            type: String(t.type).replace(/[^a-z]/g, ''),
            url: String(t.url).replace(/[^\w.:/ -]/g, ''),
            webSocketDebuggerUrl: validateDebuggerUrl(String(t.webSocketDebuggerUrl))
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
                const text = msg.params.args.map(a => String(a.value || a.description)).join(' ');
                console.log(`[CDP LOG] ${sanitize(text)}`);
            }
        });

        ws.on('error', (err) => {
            console.error(`WS Error: ${sanitize(err.message || err)}`);
        });

        // Keep running for 10 seconds to catch initial burst
        setTimeout(() => {
            console.log("Closing logger...");
            ws.close();
            process.exit(0);
        }, 10000);
    } catch (err) {
        console.error(`Failed to capture logs: ${sanitize(err.message || err)}`);
        process.exit(1);
    }
}

captureLogs();
