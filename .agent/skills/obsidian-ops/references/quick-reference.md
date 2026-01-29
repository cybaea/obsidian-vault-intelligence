<!--
Source: Condensed from all reference documentation
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Update as workflows evolve
-->

# Quick Reference

One-page cheat sheet for common Obsidian theme development tasks.

## Quick Commands

**One-word or short commands that trigger automatic actions:**

| Command | Action |
|---------|--------|
| `build` | Run build command (varies by theme: `npx grunt build`, `npm run build`, etc.) |
| `sync` or `quick sync` | Pull latest changes from all 6 core `.ref` repos |
| `what's the latest` or `check updates` | Check what's new in reference repos (read-only, then ask to pull) |
| `release ready?` or `is my theme ready for release?` | Run comprehensive release readiness checklist |
| `summarize` | Generate git commit message from all changed files |
| `summarize for release` | Generate markdown release notes for GitHub |
| `bump the version` or `bump version` | Bump version by 0.0.1 (patch) by default, or specify: `patch`, `minor`, `major`, or exact version |
| `add ref [name]` | Add a reference project (external URL or local path) |
| `check API [feature]` | Look up a feature in `.ref/obsidian-api/obsidian.d.ts` |

**Usage examples:**

- `build` → Runs build command automatically
- `sync` → Pulls latest from all core repos automatically
- `bump the version` → Bumps version by 0.0.1 (patch) in manifest.json
- `bump version minor` → Bumps minor version (e.g., 1.0.0 → 1.1.0)
- `bump version major` → Bumps major version (e.g., 1.0.0 → 2.0.0)
- `add ref my-plugin https://github.com/user/my-plugin.git` → Clones external repo
- `add ref ../my-local-plugin` → Creates symlink to local project
- `check API [feature]` → Searches obsidian.d.ts for feature (for theme CSS variables, etc.)

**Note**: These commands are interpreted by AI agents and execute the corresponding workflows automatically. See detailed documentation in [AGENTS.md](../../AGENTS.md) for full workflows.

## Build Commands

**Simple CSS themes**: No build step required - just edit `theme.css` directly.

**Complex themes with build tools**:

```powershell
npx grunt build  # For themes using Grunt
npm run build    # For themes using npm scripts
npx grunt        # Watch mode (auto-rebuild on changes)
```

**Always run build after making changes** to catch errors early. See [build-workflow.md](build-workflow.md).

## File Paths

**Theme location** (in vault):

```
<Vault>/.obsidian/themes/<theme-name>/
  ├── theme.css        # Compiled theme CSS
  └── manifest.json    # Theme manifest
```

**Build output**: Must be at top level of theme folder in vault.

## CSS Patterns

**CSS Variables** (for theming):

```css
:root {
  --color-base-00: #ffffff;
  --color-base-10: #f7f6f3;
  --color-text-normal: #383a42;
}
```

**Dark Mode**:

```css
.theme-dark {
  --color-base-00: #1e1e1e;
  --color-base-10: #252525;
  --color-text-normal: #dcddde;
}
```

See Obsidian's CSS variables documentation for complete variable list.

## Git Workflow

**Commit message format** (from [summarize-commands.md](summarize-commands.md)):

```
[Summary of changes]
- [detailed item 1]
- [detailed item 2]
```

**Release notes format** (markdown):

```markdown
### Release v1.2.0 - Title

### Features
- Feature description

### Improvements
- Improvement description
```

## Release Preparation

**Before releasing**:

- Run release readiness check: See [release-readiness.md](release-readiness.md)
- Verify all checklist items (platform testing, files, policies, etc.)
- Ensure LICENSE file exists and third-party code is properly attributed

See [versioning-releases.md](versioning-releases.md) for release process.

## Sync Reference Repos

**Quick pull all 6 core repos** (from [quick-sync-guide.md](quick-sync-guide.md)):

```bash
# Navigate to central .ref location (adjust path as needed)
cd ../.ref/obsidian-dev  # or cd ~/Development/.ref/obsidian-dev

# Pull all repos
cd obsidian-api && git pull && cd ..
cd obsidian-sample-plugin && git pull && cd ..
cd obsidian-developer-docs && git pull && cd ..
cd obsidian-plugin-docs && git pull && cd ..
cd obsidian-sample-theme && git pull && cd ..
cd eslint-plugin && git pull && cd ..
```

**Note**: If using symlinks, navigate to the actual target location (usually `..\.ref\obsidian-dev`) before running git commands. See [quick-sync-guide.md](quick-sync-guide.md) for setup detection.

## Reference Materials

**Check `.ref/obsidian-api/obsidian.d.ts`** for CSS variable definitions and Obsidian's internal structure (useful for advanced theming).

## Testing

**Manual installation**:

1. Build theme (if using build tools) or ensure `theme.css` is ready
2. Copy `manifest.json` and `theme.css` to vault `.obsidian/themes/<theme-name>/`
3. Select theme in Obsidian: **Settings → Appearance → Themes**
4. Reload Obsidian (Ctrl+R / Cmd+R) to see changes

See [testing.md](testing.md) for details.

## Common File Structure

**Simple CSS theme**:

```
theme.css          # Source CSS (edit directly)
manifest.json
package.json
```

**Complex theme with build tools**:

```
src/
  scss/
    index.scss
    variables.scss
    components/
theme.css          # Compiled output
manifest.json
package.json
Gruntfile.js       # Build configuration (if using Grunt)
```

See [file-conventions.md](file-conventions.md) for details.
