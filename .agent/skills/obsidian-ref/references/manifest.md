<!--
Source: Based on Obsidian community guidelines
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian releases repo for validation requirements
-->

# Manifest rules (`manifest.json`)

### Required Fields

All themes must include these fields in `manifest.json`:

- **`name`** (string, required) - Theme name
- **`version`** (string, required) - Semantic Versioning format `x.y.z` (e.g., `"1.0.0"`)
- **`minAppVersion`** (string, required) - Minimum Obsidian version required
- **`author`** (string, required) - Author name (required for themes)

### Optional Fields

- **`authorUrl`** (string, optional) - URL to author's website or profile
- **`fundingUrl`** (string, optional) - URL for funding/support

### Important Notes

- Themes do **not** use `id` or `isDesktopOnly` fields.
- Canonical requirements: <https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-theme-entry.yml>

## Validation Checklist

When reviewing or creating a `manifest.json` file, ensure:

- [ ] All required fields are present (`name`, `version`, `minAppVersion`, `author`)
- [ ] `version` follows semantic versioning (x.y.z)
- [ ] `minAppVersion` is set appropriately
- [ ] JSON syntax is valid (proper quotes, commas, brackets)
- [ ] All string values are properly quoted
- [ ] No plugin-specific fields (`id`, `isDesktopOnly`) are present
