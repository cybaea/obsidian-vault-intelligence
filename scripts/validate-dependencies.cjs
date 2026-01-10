const https = require('https');
const fs = require('fs');
const path = require('path');

// Helper to check URL
function checkUrl(url) {
    return new Promise((resolve) => {
        https.get(url, (res) => {
            if (res.statusCode >= 200 && res.statusCode < 400) {
                resolve({ url, status: 'OK', code: res.statusCode });
            } else {
                resolve({ url, status: 'FAILED', code: res.statusCode });
            }
        }).on('error', (err) => {
            resolve({ url, status: 'ERROR', message: err.message });
        });
    });
}

async function validate() {
    console.log("--- Starting Dependency Validation ---");
    let allOk = true;

    // 1. Check Constants
    const constantsPath = path.join(__dirname, '../src/constants.ts');
    if (!fs.existsSync(constantsPath)) {
        console.error("FAILED: src/constants.ts mission");
        allOk = false;
    } else {
        const content = fs.readFileSync(constantsPath, 'utf8');
        // Extract CDN URL
        const m = content.match(/WASM_CDN_URL:\s*['"](.+?)['"]/);
        if (m && m[1]) {
            const url = m[1];
            console.log(`Checking CDN: ${url}...`);
            const res = await checkUrl(url + 'ort-wasm.wasm');
            if (res.status !== 'OK') {
                console.error(`FAILED: CDN asset not reachable: ${res.url} (Score: ${res.code || res.message})`);
                allOk = false;
            } else {
                console.log(`OK: CDN asset reachable.`);
            }
        }
    }

    // 2. Check Model Registry
    const registryPath = path.join(__dirname, '../src/services/ModelRegistry.ts');
    if (fs.existsSync(registryPath)) {
        const content = fs.readFileSync(registryPath, 'utf8');
        // Simple sanity check for Gemini models
        if (!content.includes('gemini-2.0-flash') && !content.includes('gemini-3.0')) {
            console.warn("WARNING: ModelRegistry doesn't seem to contain latest Gemini models.");
        }
        console.log("OK: ModelRegistry exists.");
    }

    // 3. Check for obvious magic numbers in AgentService (sampling)
    const agentPath = path.join(__dirname, '../src/services/AgentService.ts');
    if (fs.existsSync(agentPath)) {
        const content = fs.readFileSync(agentPath, 'utf8');
        const magicNumbers = [
            /score:\s*1\.2/,
            /score:\s*0\.85/,
            /Math\.floor\(totalTokens\s*\*\s*4\b/
        ];
        magicNumbers.forEach(re => {
            if (re.test(content)) {
                console.warn(`WARNING: Possible magic number match in AgentService: ${re}`);
                allOk = false;
            }
        });
    }

    console.log("--- Validation Finished ---");
    if (!allOk) {
        process.exit(1);
    }
}

validate();
