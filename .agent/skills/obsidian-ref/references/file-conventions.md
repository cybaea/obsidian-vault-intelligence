<!--
Source: Based on Obsidian Sample Theme
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian Sample Theme repo for updates
-->

# File & folder conventions

- **Organize CSS/SCSS into logical files**: Split styles into separate files for maintainability.
- **Theme structure patterns**:
  - **Simple CSS theme** (recommended for simple themes): `theme.css` in project root, no build step required
  - **Complex theme with build tools** (for themes using SCSS, Grunt, etc.): `src/scss/` directory with SCSS source files that compile to `theme.css`
  - **CRITICAL**: Never have both `theme.css` as source AND `src/scss/` - choose one pattern

## Simple CSS Theme Structure

**Recommended for simple themes** (like the sample theme template):
```text
theme.css          # ✅ Source CSS file (edit directly)
manifest.json
package.json
```

- No build step required - just edit `theme.css` directly
- Changes take effect when Obsidian reloads the theme
- Perfect for learning and simple themes

## Complex Theme Structure (SCSS + Build Tools)

**For themes using SCSS, Grunt, npm scripts, or other build tools**:
```text
src/
  scss/            # ✅ SCSS source files
    index.scss
    variables.scss
    components/
  css/            # Compiled CSS (intermediate, not committed)
    main.css
theme.css         # ✅ Final compiled output (committed)
Gruntfile.js      # Build configuration (if using Grunt)
manifest.json
package.json
```

- Source files in `src/scss/` are compiled to `theme.css`
- Build tools (Grunt, npm scripts, etc.) handle compilation
- Run build command after making changes (see [build-workflow.md](build-workflow.md))
- **Example**: The `obsidian-oxygen` theme uses this pattern with Grunt

## Wrong Structure (Common Mistakes)

```text
theme.css         # ❌ DON'T have both
src/
  scss/          # ❌ This causes confusion about which is the source
    index.scss
```

**Best practice**: Choose one pattern and stick with it. Simple themes should use `theme.css` directly. Complex themes should use `src/scss/` and compile to `theme.css`.

- **Do not commit build artifacts**: Never commit `node_modules/`, intermediate compiled CSS files (like `src/css/main.css`), or other generated files. Only commit `theme.css` (the final output).
- Keep themes lightweight. Avoid complex build processes unless necessary.
- Release artifacts: `manifest.json` and `theme.css` must be at the top level of the theme folder in the vault.


