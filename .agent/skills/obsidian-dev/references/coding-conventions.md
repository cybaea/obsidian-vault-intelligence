<!--
Source: Based on Obsidian Sample Plugin and TypeScript best practices
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian Sample Plugin repo for updates
Applicability: Plugin
-->

# Coding conventions

**Note**: This file is specific to plugin development (TypeScript). For theme development, see CSS/SCSS best practices in other files.

- TypeScript with `"strict": true` preferred.
- **Avoid `any` type**: Use proper types, `unknown`, or type assertions instead. `any` defeats TypeScript's type safety benefits.
- **Keep `main.ts` minimal**: Focus only on plugin lifecycle (onload, onunload, addCommand calls). Delegate all feature logic to separate modules.
- **Split large files**: If any file exceeds ~200-300 lines, consider breaking it into smaller, focused modules.
- **Use clear module boundaries**: Each file should have a single, well-defined responsibility.
- Bundle everything into `main.js` (no unbundled runtime deps).
- Avoid Node/Electron APIs if you want mobile compatibility; set `isDesktopOnly` accordingly.
- Prefer `async/await` over promise chains; handle errors gracefully.
