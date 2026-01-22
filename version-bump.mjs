import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
    console.error("❌ npm_package_version is not set.");
    process.exit(1);
}

// 1. Update manifest.json
console.log(`📝 Updating manifest.json for version ${targetVersion}...`);
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// 2. Update versions.json
// We only add an entry if it's a major/minor release (ends in .0)
// OR if the minAppVersion has changed from the last entry.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
const currentVersions = Object.keys(versions);
const lastVersion = currentVersions[currentVersions.length - 1];
const lastMinAppVersion = versions[lastVersion];

const isMajorOrMinor = targetVersion.endsWith(".0");
const minAppVersionChanged = minAppVersion !== lastMinAppVersion;

if (isMajorOrMinor || minAppVersionChanged) {
    console.log(`📝 Updating versions.json for version ${targetVersion}...`);
    versions[targetVersion] = minAppVersion;
    writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
} else {
    console.log(`ℹ️ Skipping versions.json update for patch release ${targetVersion} (minAppVersion unchanged).`);
}

// 3. Update CHANGELOG.md
console.log(`📝 Updating CHANGELOG.md for version ${targetVersion}...`);
try {
    execSync(`node scripts/update-changelog.mjs ${targetVersion}`, { stdio: 'inherit' });
} catch (e) {
    console.error("❌ Failed to update CHANGELOG.md");
    process.exit(1);
}

console.log("✅ All version files updated successfully.");
