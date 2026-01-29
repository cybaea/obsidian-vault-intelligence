<!--
Source: Based on Obsidian Sample Theme
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian Sample Theme repo for updates
-->

# Versioning & releases

**Before releasing**: Use the comprehensive [release-readiness.md](release-readiness.md) checklist to verify your project is ready for release.

- Bump `version` in `manifest.json` (SemVer).
- Create a GitHub release whose tag exactly matches `manifest.json`'s `version`. Do not use a leading `v`.

### Theme Releases

- Attach `manifest.json` and `theme.css` to the release as individual assets.
- After the initial release, follow the process to add/update your theme in the community catalog as required.

### Plugin Releases

- Attach `main.js`, `manifest.json`, and `styles.css` to the release as individual assets.
- Follow the plugin submission process to add/update your plugin in the community catalog.

> [!NOTE]
> Themes and plugins have different asset requirements and submission paths. Ensure you follow the correct flow for your project type.
