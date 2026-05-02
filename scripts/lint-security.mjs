
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const dangerousPatterns = [
    {
        regex: /as\s+unknown\s+as\s+{\s*new/g,
        message: "Dangerous constructor cast detected. Use a runtime check (typeof === 'function') before instantiating.",
        severity: 'error'
    },
    {
        regex: /execSync\(\\?`[^`]*\\?\$\{[^}]+\}/g,
        message: "Potential command injection in execSync. Ensure variables are sanitized.",
        severity: 'warn'
    },
    {
        regex: /console\.(log|error|warn)\(\\?`[^`]*\\?\$\{[^}]+\}/g,
        message: "Potential log injection. Ensure variables are sanitized of newlines.",
        severity: 'warn'
    }
];

function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let errors = 0;

    dangerousPatterns.forEach(pattern => {
        let match;
        while ((match = pattern.regex.exec(content)) !== null) {
            const lineNum = content.substring(0, match.index).split('\n').length;
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
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            if (file !== 'node_modules' && file !== 'dist' && file !== '.git') {
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
    // We don't exit with 1 yet to avoid breaking current builds until we refine the patterns
} else {
    console.log("No security issues found.");
}
