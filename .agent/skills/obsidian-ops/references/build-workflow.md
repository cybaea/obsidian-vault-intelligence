<!--
Source: Project-specific workflow
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Update as build process evolves
-->

# Build Workflow

**CRITICAL**: Always run the build command after making changes to catch errors early.

After making any changes to theme code:

### Simple CSS Themes

If your theme is simple with just `theme.css` in the root and no build tools:

- **No build step required** - just edit `theme.css` directly
- Changes take effect immediately when Obsidian reloads the theme (reload Obsidian with Ctrl+R / Cmd+R)
- **Linting**: Run `npm run lint` to check CSS quality (optional but recommended)

**How to detect**: If you have `theme.css` in root and no `src/scss/` directory, you have a simple CSS theme.

### Complex Themes (SCSS + Build Tools)

If your theme uses build tools (Grunt, npm scripts, SCSS compiler, etc.) and has `src/scss/` directory:

1. **Run the build** (assume npm is already installed):

   ```powershell
   # For themes using Grunt (like obsidian-oxygen)
   npx grunt build
   
   # For themes using npm scripts
   npm run build
   
   # For themes using Grunt watch mode (auto-rebuild on changes)
   npx grunt
   
   # Or whatever build command your theme uses
   ```

2. **If the build fails with npm/node errors**, then check if npm is installed:

   ```powershell
   npm --version
   ```

   - If npm is not found, inform the user that Node.js (which includes npm) needs to be installed
   - Do not automatically install npm - let the user handle installation

3. **Check for errors** and fix any build issues before proceeding. See [troubleshooting.md](troubleshooting.md) for common build issues.

4. **Linting**: Run `npm run lint` to check SCSS/CSS quality. The lint wrapper automatically detects SCSS files in `src/scss/` and lints them appropriately.

**How to detect**: If you have a `src/scss/` directory, you have a complex theme with build tools. Check for `Gruntfile.js`, `package.json` scripts, or other build configuration files.

**Common build tools**:

- **Grunt**: Look for `Gruntfile.js` → Run `npx grunt build` or `npx grunt` (watch mode)
- **npm scripts**: Check `package.json` for `build` script → Run `npm run build`
- **Sass CLI**: Some themes use `sass` directly → Check `package.json` scripts

## Why This Matters

- **Catches errors early**: Build errors are easier to fix immediately after making changes
- **Prevents broken code**: Ensures the project always builds successfully
- **Saves time**: Fixing build errors right away is faster than discovering them later
- **Maintains quality**: Keeps the codebase in a working state

## Automated Workflow

When making changes:

1. Make the code change
2. **Immediately run the build command**
3. If build fails, fix errors
4. Repeat until build succeeds
5. Then proceed with testing or other tasks
