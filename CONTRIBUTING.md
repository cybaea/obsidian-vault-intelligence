# Contributing

Thanks for your interest in contributing to this Obsidian plugin. This document outlines the process for development, testing, linting, and releasing updates.

## Getting started

- **Prerequisites:** Node.js (Active LTS or v18+), npm.
- **Install dependencies:**

    ```bash
    npm install
    ```

## Development

- **Run the dev/watch build:**
  This will compile your code automatically whenever you save a file.

    ```bash
    npm run dev
    ```

- **Build for production:**
  Run this before opening a PR to ensure the build is clean.

    ```bash
    npm run lint
    npm run build
    ```

- **Code Structure:** Keep `main.ts` minimal; put feature code in `src/` modules.

## Linting and formatting

- We use ESLint as configured in the repo. To run linting locally:

    ```bash
    npm run lint
    ```
- Please ensure your code is formatted (e.g. no mixed tabs/spaces) before committing to keep diffs clean.

## Testing in Obsidian

To test your changes, you need to run the plugin inside an actual Obsidian vault.

**Option A: The "Hot Reload" Method (Recommended)**

1. Install the [Hot Reload plugin](https://github.com/pjeby/hot-reload) in your test vault.
2. Place a file named `.hotreload` in your plugin's root directory (or just symlink your repo folder into the vault's `.obsidian/plugins/` folder).
3. Obsidian will automatically reload your plugin whenever you save a change.

**Option B: Manual Install**

1. Copy `main.js`, `manifest.json`, and `styles.css` into your test vault:
   `path/to/vault/.obsidian/plugins/obsidian-vault-intelligence/`
2. Reload Obsidian (Cmd/Ctrl + R) to see changes.

## Commit & PR guidelines

- **Branches:** Create a feature branch per change (e.g., `feature/add-api-setting`).
- **Commits:** Keep commits small and focused. Use clear, imperative messages (e.g., "Fix API key storage bug," not "fixed it").
- **Pull Requests:** Open a PR against the `main` branch. Describe the change, motivation, and manual test steps.
- **Visuals:** Include screenshots or GIFs for any UI changes.

## Release & versioning

When preparing a release:

1. **Update Version Numbers:**
   - Update `version` in `manifest.json`.
   - Update `package.json` (via `npm version x.y.z --no-git-tag-version`).
   - Update `versions.json` (add the new version key mapped to the minimum Obsidian version required).
2. **Tagging:**
   - Create a git tag matching the version number exactly (e.g., `1.0.1`, prefer no leading `v` for simplicity with Obsidian tools).
3. **GitHub Release:**
   - Push the tag to GitHub.
   - Create a Release from that tag.
   - **Important:** You must manually attach the compiled `main.js`, `manifest.json`, and `styles.css` as binary assets to the release.
4. **Clean Repo:** Do not commit built artifacts (like `main.js`) to the git repository itself; they only belong in the Release assets.

## Manifest and packaging rules

- Ensure `manifest.json` contains valid `id`, `name`, `version`, `minAppVersion`, `description`.
- Keep `minAppVersion` accurate—only bump it if you use a new Obsidian API feature that breaks older versions.

## Security & privacy

- **Default to Local:** The plugin should work offline by default.
- **Network Calls:** Only add network calls (like API requests) with clear user opt-in and documentation.
- **Data Safety:** Never transmit vault content without explicit consent. Protect secrets (like API keys) by masking inputs and warning users about storage risks.

## Development Notes

1. **TypeScript:** Pinned to `~5.8.3`. Do not update to v5.9+ until `eslint-plugin-obsidianmd` adds support for it.

Other notes, conventions, and detailed developer guidance can be found in `AGENTS.md` at the project root.

Thank you for contributing — your improvements make the plugin better for everyone.