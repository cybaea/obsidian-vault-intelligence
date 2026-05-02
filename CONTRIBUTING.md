# Contributing

Thanks for your interest in contributing to this Obsidian plugin. This project relies on modern tooling (Node.js 22+, Vitest, ESLint Flat Config) and follows an "Agentic AI" architecture.

To view or raise a bug or feature request, please use the [GitHub Issues](https://github.com/cybaea/obsidian-vault-intelligence/issues) page.

## Getting started

### Prerequisites

-   **Node.js**: v22.x or higher (Verified in `.github/workflows/release.yml`)
-   **npm**: v10+

### Installation

Use `npm ci` to install dependencies deterministically.

```bash
npm ci
```

## Development

Read [devs/ARCHITECTURE_AND_STANDARDS.md](devs/ARCHITECTURE_AND_STANDARDS.md) FIRST before doing any work on the plugin: it contains detailed information on the development process and architecture.

### Running locally

To start the development build in watch mode:

```bash
npm run dev
```

*This uses `esbuild` to compile changes instantly._

### Hot reload (recommended)

To test your changes in Obsidian:

1.  Install the [Hot Reload plugin](https://github.com/pjeby/hot-reload) in a test vault.
2.  Symlink this repository into your vault's `.obsidian/plugins/` directory.
3.  Add an empty `.hotreload` file to the root of this repo.

## Linting and testing

We maintain high code quality standards. Please run these before pushing:

### Linting

We use **ESLint** with a flat config (`eslint.config.mts`).

```bash
npm run lint
```

*Fixes can often be applied automatically with `--fix`._

### Testing

We use **Vitest** for unit and UI testing.

```bash
# Run all tests
npm test

# Run tests with UI
npm run test:ui
```

## Project structure

-   **`src/`**: Source code (modularized, avoiding a monolithic `main.ts`).
-   **`devs/`**: Developer documentation and guides.
    -   **`devs/adr/`**: **Architecture Decision Records**. Please review these to understand key design choices.
    -   **`devs/RELEASE_WORKFLOW.md`**: Details on our automated release process.
-   **`manifest.json`**: Plugin metadata.

## Merge process

All changes should be done on branches and then a pull request **must** be raised to merge the changes into the main branch. The pull request should be reviewed by at least one other developer and should be updated to address any feedback from the reviewer. Merging to main branch is disabled in GitHub and must be done using the release process.

## Release process

We use a "Zero Memory" automated workflow. **Do not manually tag releases.**

To prepare a release:

```bash
npm run release:prep <patch|minor|major>
```

See [devs/RELEASE_WORKFLOW.md](devs/RELEASE_WORKFLOW.md) for the complete guide.

## Agentic architecture

This plugin uses sophisticated agent patterns. If you are modifying the agents (Gardener, Researcher, etc.), please refer to:

-   `AGENTS.md` (Root)
-   `devs/ARCHITECTURE.md`

## Security and privacy

-   **Local first**: The plugin must function offline.
-   **Consent**: No network calls without explicit user action.
-   **Secrets**: Securely handle API keys; warn users about where they are stored.

Thank you for helping us build specific, intelligent tools for Obsidian!
