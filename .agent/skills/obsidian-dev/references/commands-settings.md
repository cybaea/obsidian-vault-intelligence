<!--
Source: Based on Obsidian Sample Plugin and community plugin guidelines
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian Sample Plugin repo for updates
Applicability: Plugin
-->

# Commands & settings

**Note**: This file is specific to plugin development. Themes do not have commands or settings.

- Any user-facing commands should be added via `this.addCommand(...)`.
- If the plugin has configuration, provide a settings tab and sensible defaults.
- Persist settings using `this.loadData()` / `this.saveData()`.
- Use stable command IDs; avoid renaming once released.

## Version Considerations

When using newer API features (e.g., `SettingGroup` since API 1.11.0), consider backward compatibility:

- **For new plugins**: You can set `minAppVersion: "1.11.0"` in `manifest.json` and use the feature directly
- **For existing plugins**: Use version checking with `requireApiVersion()` to support both newer and older Obsidian versions
- See [code-patterns.md](code-patterns.md) for backward compatibility patterns, including a complete example for `SettingGroup`
