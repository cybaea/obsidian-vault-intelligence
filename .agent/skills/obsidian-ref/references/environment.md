<!--
Source: Based on Obsidian Sample Theme
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian Sample Theme repo for updates
-->

# Environment & tooling

- **Optional**: Node.js and npm if using SCSS/Sass preprocessors or build tools.
- **Simple themes**: Can be developed with just CSS and `manifest.json` (no build tools required).
- **SCSS themes**: Use Sass/SCSS compiler (e.g., `sass`, `node-sass`, or build tools like Vite).
- No TypeScript or bundler required for basic themes.

## Simple Theme Setup

No build tools needed - just edit `theme.css` directly.

## SCSS Theme Setup

```bash
npm install -D sass
npm run build  # Compile SCSS to CSS
```

## Theme Build Tools (Optional)

Simple themes with just CSS don't need build tools. More complex themes might use Grunt, npm scripts, or other build tools for tasks like SCSS compilation, minification, or preprocessing:

```bash
# For themes using Grunt
npx grunt build

# For themes using npm scripts
npm run build
```

Only use build commands if your theme has a `Gruntfile.js`, `package.json` with build scripts, or other build configuration files.

## Linting (Optional)

- Use `stylelint` for CSS/SCSS linting: `npm install -D stylelint`
- Configure stylelint for Obsidian theme conventions
- **Quick Setup**: Run `node scripts/setup-stylelint.mjs` to set up Stylelint with helpful success messages
- **Run Stylelint**:

  ```bash
  npm run lint        # Uses lint-wrapper.mjs for helpful success messages
  npm run lint:fix    # Auto-fix issues where possible
  ```

**Note**: The setup script automatically creates `scripts/lint-wrapper.mjs` which adds helpful success messages when linting passes. The wrapper is included in the template and copied during setup.
