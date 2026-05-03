import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const dangerousPatterns = [
    {
        regex: /as\s+unknown\s+as\s+\{\s*new/g,
        message: "Dangerous constructor cast detected. Use a runtime check (typeof === 'function') before instantiating.",
        severity: 'error'
    },
    {
        // Use hex codes for backticks and dollar signs
        regex: /execSync\(\x60[^\x24\x60]*\x24\{(?![^}]*\.replace)[^}]+\}[^\x60]*\x60/g,
        message: "Potential command injection in execSync. Ensure variables are sanitized.",
        severity: 'warn'
    },
    {
        // Catch direct process.env usage in execSync
        regex: /execSync\([^)]*process\.env/g,
        message: "Direct use of process.env in execSync is dangerous. Sanitize into a variable first.",
        severity: 'error'
    }
];

function scanFile(filePath) {
    if (filePath.includes('lint-security.mjs')) return 0;
    
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const lines = fileContent.split('\n');
    let errors = 0;

    dangerousPatterns.forEach(pattern => {
        let match;
        pattern.regex.lastIndex = 0;
        while ((match = pattern.regex.exec(fileContent)) !== null) {
            const lineNum = fileContent.substring(0, match.index).split('\n').length;
            const line = lines[lineNum - 1];
            
            if (line && line.includes('security-disable-line')) continue;

            console.log(`[${pattern.severity.toUpperCase()}] ${filePath}:${lineNum}: ${pattern.message}`);
            errors++;
        }
    });

    return errors;
}

function walkDir(dir) {
    let errors = 0;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath, { throwIfNoEntry: false });
        if (!stat) continue;

        if (stat.isDirectory()) {
            if (file !== 'node_modules' && file !== 'dist' && file !== '.git' && file !== '.tasks' && file !== '.agents' && file !== '.tmp') {
                errors += walkDir(filePath);
            }
        } else if (file.endsWith('.ts') || file.endsWith('.mjs') || file.endsWith('.cjs')) {
            errors += scanFile(filePath);
        }
    }
    return errors;
}

console.log("Running Security Lint...");
const totalErrors = walkDir(rootDir);
if (totalErrors > 0) {
    console.log(`\nFound ${totalErrors} security potential issues.`);
} else {
    console.log("No security issues found.");
}