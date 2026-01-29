<!--
Source: Based on Obsidian community troubleshooting
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Update as common issues are identified
-->

# Troubleshooting

**Source**: Based on common errors from developer docs, community patterns, and best practices.

- **Theme doesn't appear**: Ensure `manifest.json` and `theme.css` are at the top level of the theme folder under `<Vault>/.obsidian/themes/<theme-name>/`.
- **Theme not applying**: Check that `manifest.json` has correct `name` field matching the folder name.
- **CSS not loading**: Verify `theme.css` exists and is properly formatted.
- **SCSS compilation issues**: If using SCSS, ensure build process runs and outputs `theme.css`.
- **Mobile display issues**: Test CSS on mobile devices and check for viewport-specific styles.

## AI Agent Issues

### .ref Folder Not Found

**Problem**: AI agent can't find `.ref` folder when searching.

**Solution**:

- The `.ref` folder is gitignored and may be hidden
- Use `list_dir` with the project root to see hidden directories
- Use `glob_file_search` with pattern `.ref/**` to search recursively
- Try direct paths like `.ref/obsidian-api/README.md`
- See [sync-procedure.md](sync-procedure.md) for detailed search strategies

**For AI agents**: When user asks about `.ref`, actively search using multiple methods. Don't assume it doesn't exist if first search fails.

## Common Error Messages

### CSS Errors

- **"Invalid property value"**: Check CSS syntax, ensure all values are properly formatted.
- **"Unknown property"**: Verify CSS property names are correct and supported by Obsidian's rendering engine.
- **"Selector not working"**: Check CSS selector specificity and ensure you're targeting the correct Obsidian elements.

### SCSS Compilation Errors

- **"File to import not found"**: Check `@import` paths are correct relative to SCSS files.
- **"Undefined variable"**: Ensure all SCSS variables are defined before use.
- **"Syntax error"**: Verify SCSS syntax is correct (semicolons, brackets, etc.).

### Build Errors

- **"Command not found"**: Ensure build tools (Grunt, npm, sass) are installed.
- **"Build failed"**: Check build configuration files (`Gruntfile.js`, `package.json` scripts).
- **"Output file missing"**: Verify build process completed and `theme.css` was generated.

## Debugging Techniques

### Browser Console

Open browser console (Help → Toggle Developer Tools) to check for:

- CSS parsing errors
- Missing CSS variables
- Conflicting styles

### Inspect Theme CSS

In browser console, inspect the theme's CSS:

```javascript
// Check if theme CSS is loaded
document.querySelector('style[data-theme="your-theme-name"]')
```

### Verify CSS Variables

Check that Obsidian CSS variables are being used correctly:

```css
/* Use Obsidian's built-in variables */
color: var(--text-normal);
background: var(--background-primary);
```

### Check Manifest

Verify `manifest.json` has correct `name` field matching the theme folder name.

## SCSS Build Issues (Detailed)

### SCSS Not Compiling

**Causes**:

1. Build command not run
2. Build tool not installed
3. Incorrect build configuration

**Solution**: 

1. Run build command (`npx grunt build` or `npm run build`)
2. Verify `Gruntfile.js` or `package.json` scripts are correct
3. Check that `theme.css` is generated in root directory

### SCSS Import Errors

**Problem**: `@import` statements fail.

**Solution**: 

1. Check file paths are correct relative to importing file
2. Verify all imported files exist
3. Use relative paths: `@import "../variables.scss";`

### CSS Output Issues

**Problem**: Compiled CSS doesn't match expected output.

**Solution**:

1. Check SCSS source files for syntax errors
2. Verify build process completes without errors
3. Inspect generated `theme.css` for issues
