<!--
Source: Based on Obsidian Sample Plugin and TypeScript best practices
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian Sample Plugin repo for updates
Applicability: Plugin
-->

# Coding conventions

**Note**: This file is specific to plugin development (TypeScript). For theme development, see CSS/SCSS best practices in other files.

## TypeScript Guidelines

- TypeScript with `"strict": true` preferred.
- **Avoid `any` type**: Use proper types, `unknown`, or type assertions instead. `any` defeats TypeScript's type safety benefits.
- **Keep `main.ts` minimal**: Focus only on plugin lifecycle (onload, onunload, addCommand calls). Delegate all feature logic to separate modules.
- **Split large files**: If any file exceeds ~200-300 lines, consider breaking it into smaller, focused modules.
- **Use clear module boundaries**: Each file should have a single, well-defined responsibility.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Avoid Node/Electron APIs if you want mobile compatibility; set `isDesktopOnly` accordingly.
- Prefer `async/await` over promise chains; handle errors gracefully.

## Plugin CSS Guidelines

Plugins that add visual elements should use `styles.css` for styling. This is important for theme compatibility.

### Use `styles.css`
Place your plugin's CSS in a `styles.css` file at the project root. Obsidian automatically loads this file when the plugin is enabled.

### Prefer Obsidian CSS Variables
Use Obsidian's built-in CSS variables instead of hardcoded values:

```css
/* Good - theme-compatible */
.my-plugin-container {
  background-color: var(--background-primary);
  color: var(--text-normal);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
}

/* Avoid - breaks theme compatibility */
.my-plugin-container {
  background-color: #ffffff;
  color: #333333;
  border: 1px solid #cccccc;
}
```

### Avoid Inline Styles
Do not use inline styles or hardcoded values in your TypeScript/JavaScript:

```typescript
// Avoid - theme devs cannot override this
element.style.backgroundColor = '#ffffff';
element.style.color = '#333';

// Better - use CSS classes
element.addClass('my-plugin-container');
```

When plugins use inline styles, theme developers are forced to use `!important` overrides, which is poor practice for everyone.

### Prefix Your Classes
Prefix CSS classes with your plugin name to avoid conflicts:

```css
.my-plugin-sidebar { }
.my-plugin-button { }
.my-plugin-modal { }
```

### Document Styleable Elements
If your plugin creates complex UI, consider documenting the CSS classes in your README so theme developers can style them.


