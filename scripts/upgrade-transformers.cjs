const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

async function getLatestVersion() {
    return new Promise((resolve, reject) => {
        https.get('https://registry.npmjs.org/@xenova/transformers/latest', (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
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
    return pkg.dependencies['@xenova/transformers'];
}

async function run() {
    console.log("--- Transformers.js Upgrade Automation ---");

    try {
        console.log("Fetching latest version from NPM...");
        const rawLatest = await getLatestVersion();
        
        const match = String(rawLatest).match(/^(\d+)\.(\d+)\.(\d+)$/);
        if (!match) {
            throw new Error(`Invalid version format received from NPM: ${rawLatest}`);
        }
        // Force conversion to numbers and back to string to break taint flow completely
        const latest = `${parseInt(match[1], 10)}.${parseInt(match[2], 10)}.${parseInt(match[3], 10)}`;
        const current = getPackageVersion();

        console.log(`Current pinned version: ${current.replace(/[\n\r]/g, '')}`);
        console.log(`Latest available version: ${latest.replace(/[\n\r]/g, '')}`);

        if (current === latest) {
            console.log("No update required. Already at latest version.");
            return;
        }

        console.log(`Update found! Upgrading ${current.replace(/[\n\r]/g, '')} -> ${latest.replace(/[\n\r]/g, '')}...`);

        // 1. Update package.json using JSON object to avoid string manipulation risks
        const pkgPath = path.join(__dirname, '../package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        pkg.dependencies['@xenova/transformers'] = latest;
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        console.log("OK: package.json updated.");

        // 2. Update src/constants.ts
        const constantsPath = path.join(__dirname, '../src/constants.ts');
        let constantsContent = fs.readFileSync(constantsPath, 'utf8');

        // Use line-by-line replacement with validated version string
        constantsContent = constantsContent.split('\n').map(line => {
            if (line.includes('WASM_VERSION:')) {
                return line.replace(/['"].*?['"]/, `'${latest}'`);
            }
            if (line.includes('WASM_CDN_URL:')) {
                // Ensure we only replace the version part and keep the rest intact
                return line.replace(/@(\d+\.\d+\.\d+)\/dist/, `@${latest}/dist`);
            }
            return line;
        }).join('\n');

        fs.writeFileSync(constantsPath, constantsContent);
        console.log("OK: src/constants.ts updated.");

        // 3. Run npm install
        console.log("Running npm install...");
        execFileSync('npm', ['install'], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
        console.log("OK: node_modules updated.");

        // 4. Run verification
        console.log("Running final verification...");
        execFileSync('node', ['scripts/validate-dependencies.cjs'], { stdio: 'inherit', cwd: path.join(__dirname, '..') });

        console.log("\nSUCCESS: Transformers.js upgraded and verified.");
        console.log("Please review the changes and commit.");

    } catch (error) {
        const sanitizedError = String(error.message).replace(/[\r\n]/g, ' ');
        console.error(`\nFAILED: ${sanitizedError}`);
        process.exit(1);
    }
}

run();