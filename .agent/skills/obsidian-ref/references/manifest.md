<!--
Source: Based on Obsidian community guidelines for Plugins
Last synced: 2026-01-25
-->

# Manifest rules (`manifest.json`)

## Required Fields

All **plugins** must include these fields in `manifest.json`:

- **`id`** (string, required) - unique ID. **Must not change after release**. For local dev, matches folder name.
- **`name`** (string, required) - Human readable name.
- **`version`** (string, required) - Semantic Versioning `x.y.z` (e.g., `"1.0.0"`). **Do not use a 'v' prefix**.
- **`minAppVersion`** (string, required) - Minimum Obsidian version required.
- **`description`** (string, required) - Brief description shown in settings.
- **`isDesktopOnly`** (boolean, required) - `true` if it uses Node.js/Electron APIs, `false` otherwise.

## Optional Fields

- **`author`** (string, optional)
- **`authorUrl`** (string, optional)
- **`fundingUrl`** (string, optional) - For "Buy me a coffee" or GitHub Sponsors.

## Validation Checklist

- [ ] `id` is stable and globally unique.
- [ ] `version` matches the GitHub Release tag (without 'v').
- [ ] `isDesktopOnly` is actively set.
- [ ] `minAppVersion` matches the API version used.

## Important Notes

- **Never change `id`** after release. This breaks updates for all users.
- **Themes vs Plugins**: Themes do not use `id` or `isDesktopOnly`. This file documents **Plugin** rules.
