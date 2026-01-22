import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const changelogPath = join(process.cwd(), 'CHANGELOG.md');
const version = process.argv[2];

if (!version) {
    console.error('Usage: node scripts/update-changelog.mjs <version>');
    process.exit(1);
}

try {
    const content = readFileSync(changelogPath, 'utf8');
    const date = new Date().toISOString().split('T')[0];

    // We strictly look for "## [Unreleased]" to replace it.
    const unreleasedHeader = '## [Unreleased]';

    if (!content.includes(unreleasedHeader)) {
        throw new Error(`Could not find "${unreleasedHeader}" section in CHANGELOG.md`);
    }

    // New structure:
    // 1. Fresh [Unreleased] section with empty placeholders
    // 2. The new version header taking ownership of the existing content
    const newSection = `## [Unreleased]

### User features

### Developer features

## [${version}] - ${date}`;

    // replace only the first occurrence (which should be the one at the top)
    const newContent = content.replace(unreleasedHeader, newSection);

    writeFileSync(changelogPath, newContent);
    console.log(`✅ Updated CHANGELOG.md for version ${version}`);

} catch (error) {
    console.error(`❌ Failed to update CHANGELOG.md: ${error.message}`);
    process.exit(1);
}
