const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Sanitizes a string for logging to prevent log injection.
 * @param {unknown} s The value to sanitize.
 * @returns {string} The sanitized string.
 */
function sanitize(s) {
    return String(s)
        .replace(/[\r\n]+/g, ' ')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');
}

async function getLatestVersion() {
    return new Promise((resolve, reject) => {
        https.get('https://registry.npmjs.org/@xenova/transformers/latest', (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (!json || typeof json.version !== 'string') {
                        throw new Error("Invalid response from NPM registry");
                    }
                    resolve(json.version);
                } catch (e) {
                    reject(new Error("Failed to parse NPM registry response"));
                }
            });
        }).on('error', (err) => reject(err));
    });
}

function getPackageVersion() {
    const pkgPath = path.join(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const version = pkg.dependencies['@xenova/transformers'];
    if (typeof version !== 'string') throw new Error("Could not find @xenova/transformers in package.json");
    return version;
}

async function run() {
    console.log("--- Transformers.js Upgrade Automation ---");

    try {
        console.log("Fetching latest version from NPM...");
        const rawLatest = await getLatestVersion();
        
        const match = String(rawLatest).match(/^(\d+)\.(\d+)\.(\d+)$/);
        if (!match) {
            throw new Error("Invalid version format received from NPM");
        }
        
        // Break taint flow by re-constructing the string from validated parts
        const latest = `${parseInt(match[1], 10)}.${parseInt(match[2], 10)}.${parseInt(match[3], 10)}`;
        const current = getPackageVersion();

        console.log(`Current pinned version: ${sanitize(current)}`);
        console.log(`Latest available version: ${sanitize(latest)}`);

        if (current === latest) {
            console.log("No update required. Already at latest version.");
            return;
        }

        console.log(`Update found! Upgrading ${sanitize(current)} -> ${sanitize(latest)}...`);

        // 1. Update package.json using JSON object to avoid string manipulation risks
        const pkgPath = path.join(__dirname, '../package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        pkg.dependencies['@xenova/transformers'] = latest;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        console.log("OK: package.json updated.");

        // 2. Update src/constants.ts
        const constantsPath = path.join(__dirname, '../src/constants.ts');
        const constantsContent = fs.readFileSync(constantsPath, 'utf8');

        // Use line-by-line replacement with validated version string
        const updatedConstants = constantsContent.split('\n').map(line => {
            if (line.includes('WASM_VERSION:')) {
                return line.replace(/['"].*?['"]/, `'${latest}'`);
            }
            if (line.includes('WASM_CDN_URL:')) {
                // Ensure we only replace the version part and keep the rest intact
                return line.replace(/@(\d+\.\d+\.\d+)\/dist/, `@${latest}/dist`);
            }
            return line;
        }).join('\n');

        fs.writeFileSync(constantsPath, updatedConstants);
        console.log("OK: src/constants.ts updated.");

        // 3. Run npm install
        console.log("Running npm install...");
        execFileSync('npm', ['install'], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
        console.log("OK: node_modules updated.");

        // 4. Run verification
        console.log("Running final verification...");
        execFileSync('node', ['scripts/validate-dependencies.cjs'], { stdio: 'inherit', cwd: path.join(__dirname, '..') });

        console.log("\nSUCCESS: Transformers.js upgraded and verified.");
    } catch (error) {
        const errorMessage = error && typeof error === 'object' && 'message' in error
            ? error.message
            : String(error);
        const safeErrorMessage = sanitize(errorMessage);
        console.error("FAILED: Upgrade process encountered an error.");
        process.exit(1);
    }
}

run();
