const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
        const latest = await getLatestVersion();
        const current = getPackageVersion();

        console.log(`Current pinned version: ${current}`);
        console.log(`Latest available version: ${latest}`);

        if (current === latest) {
            console.log("No update required. Already at latest version.");
            return;
        }

        console.log(`Update found! Upgrading ${current} -> ${latest}...`);

        // 1. Update package.json
        const pkgPath = path.join(__dirname, '../package.json');
        let pkgContent = fs.readFileSync(pkgPath, 'utf8');
        pkgContent = pkgContent.replace(
            `"@xenova/transformers": "${current}"`,
            `"@xenova/transformers": "${latest}"`
        );
        fs.writeFileSync(pkgPath, pkgContent);
        console.log("OK: package.json updated.");

        // 2. Update src/constants.ts
        const constantsPath = path.join(__dirname, '../src/constants.ts');
        let constantsContent = fs.readFileSync(constantsPath, 'utf8');

        // Update WASM_VERSION
        constantsContent = constantsContent.replace(
            /WASM_VERSION:\s*['"](.+?)['"]/,
            `WASM_VERSION: '${latest}'`
        );

        // Update WASM_CDN_URL (specifically the version part)
        constantsContent = constantsContent.replace(
            /WASM_CDN_URL:\s*['"](.+?@)(.+?)(\/.+?)['"]/,
            `WASM_CDN_URL: '$1${latest}$3'`
        );

        fs.writeFileSync(constantsPath, constantsContent);
        console.log("OK: src/constants.ts updated.");

        // 3. Run npm install
        console.log("Running npm install...");
        execSync('npm install', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
        console.log("OK: node_modules updated.");

        // 4. Run verification
        console.log("Running final verification...");
        execSync('node scripts/validate-dependencies.cjs', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

        console.log("\nSUCCESS: Transformers.js upgraded and verified.");
        console.log("Please review the changes and commit.");

    } catch (error) {
        console.error(`\nFAILED: ${error.message}`);
        process.exit(1);
    }
}

run();
