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

function getPackageVersion() {
    const pkgPath = path.join(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.dependencies['@xenova/transformers'];
}

function getInstalledVersion() {
    try {
        const pkgPath = path.join(__dirname, '../node_modules/@xenova/transformers/package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return pkg.version;
    } catch (e) {
        return null;
    }
}

async function validate() {
    console.log("--- Starting Dependency Validation ---");
    let allOk = true;

    const expectedVersion = getPackageVersion();
    const installedVersion = getInstalledVersion();

    console.log(`Expected Version (package.json): ${expectedVersion}`);
    console.log(`Installed Version (node_modules): ${installedVersion || 'NOT INSTALLED'}`);

    if (installedVersion && expectedVersion !== installedVersion) {
        console.error(`FAILED: Version mismatch! package.json expects ${expectedVersion} but node_modules has ${installedVersion}. Run 'npm install'.`);
        allOk = false;
    }

    // 1. Check Constants
    const constantsPath = path.join(__dirname, '../src/constants.ts');
    if (!fs.existsSync(constantsPath)) {
        console.error("FAILED: src/constants.ts missing");
        allOk = false;
    } else {
        const content = fs.readFileSync(constantsPath, 'utf8');

        // Check WASM_VERSION
        const versionMatch = content.match(/WASM_VERSION:\s*['"](.+?)['"]/);
        if (versionMatch && versionMatch[1]) {
            const actualVersion = versionMatch[1];
            if (actualVersion !== expectedVersion) {
                console.error(`FAILED: src/constants.ts WASM_VERSION (${actualVersion}) does not match package.json (${expectedVersion})`);
                allOk = false;
            } else {
                console.log(`OK: WASM_VERSION matches.`);
            }
        } else {
            console.error("FAILED: Could not find WASM_VERSION in src/constants.ts");
            allOk = false;
        }

        // Check CDN URL
        const cdnMatch = content.match(/WASM_CDN_URL:\s*['"](.+?)['"]/);
        if (cdnMatch && cdnMatch[1]) {
            const url = cdnMatch[1];
            if (!url.includes(`@${expectedVersion}/`)) {
                console.error(`FAILED: WASM_CDN_URL does not contain version ${expectedVersion}: ${url}`);
                allOk = false;
            } else {
                console.log(`OK: WASM_CDN_URL version matches.`);

                console.log(`Checking CDN reachability: ${url}...`);
                const res = await checkUrl(url + 'ort-wasm.wasm');
                if (res.status !== 'OK') {
                    console.error(`FAILED: CDN asset not reachable: ${res.url} (Code: ${res.code || res.message})`);
                    allOk = false;
                } else {
                    console.log(`OK: CDN asset reachable.`);
                }
            }
        }
    }

    // 2. Check Model Registry
    const registryPath = path.join(__dirname, '../src/services/ModelRegistry.ts');
    if (fs.existsSync(registryPath)) {
        const content = fs.readFileSync(registryPath, 'utf8');
        if (!content.includes('gemini-2.0-flash')) {
            console.warn("WARNING: ModelRegistry doesn't seem to contain latest Gemini models.");
        }
        console.log("OK: ModelRegistry contents verified.");
    }

    console.log("--- Validation Finished ---");
    if (!allOk) {
        process.exit(1);
    }
}

validate();
