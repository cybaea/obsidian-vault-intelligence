# Contributing

Thanks for your interest in contributing to this Obsidian plugin. This project relies on modern tooling (Node.js 22+, Vitest, ESLint Flat Config) and follows an "Agentic AI" architecture.

To view or raise a bug or feature request, please use the [GitHub Issues](https://github.com/cybaea/obsidian-vault-intelligence/issues) page.

## Iterative development

We follow an **Open Development** model. All development work is conducted iteratively in public feature branches. This means:

-   We push "interim" work as it happens (granular commits), rather than giant monolithic dumps.
-   All code is available for collaborative review throughout the development cycle, not just at release time.
-   This approach ensures maximum transparency and security auditing.

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

_This uses `esbuild` to compile changes instantly._

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

_Fixes can often be applied automatically with `--fix`._

### Testing

We use **Vitest** for unit and UI testing.

```bash
# Run all tests
npm test

# Run tests with UI
npm run test:ui
```

## Testing policy

We follow a strict **Test-Driven Development (TDD) friendly** policy:

-   **New Functionality**: All major new features **must** be accompanied by automated tests in the `tests/` directory.
-   **Bug Fixes**: Every bug fix should include a regression test to ensure the issue does not return.
-   **Continuous Verification**: All tests must pass before a Pull Request is merged. Our CI pipeline enforces this automatically.

## Project structure

-   **`src/`**: Source code (modularized, avoiding a monolithic `main.ts`).
-   **`devs/`**: Developer documentation and guides.
    -   **`devs/adr/`**: **Architecture Decision Records**. Please review these to understand key design choices.
    -   **`devs/RELEASE_WORKFLOW.md/`**: Details on our automated release process.
-   **`manifest.json`**: Plugin metadata.

## Publishing changes

All changes **must** be submitted via Pull Request. Direct pushes to the `main` branch are disabled by branch protection rules.

1. Create a feature branch for your work.
2. Push your branch frequently to allow for "interim" feedback.
3. When ready, use our automation script to publish your PR:

    ```bash
    npm run publish-pr
    ```

    _This script handles CI verification and follows the project's security policies._

### Code review

All PRs must be reviewed by at least one maintainer. We look for:

-   Adherence to [Architecture and Standards](devs/ARCHITECTURE_AND_STANDARDS.md).
-   Passing CI checks (Lint, Build, Test).
-   Meaningful commit messages and signed commits (where possible).

## Release process

We use a \"Zero Memory\" automated workflow. **Do not manually tag releases.**

To prepare a release:

```bash
npm run release:prep <patch|minor|major>
```

See [devs/RELEASE_WORKFLOW.md](devs/RELEASE_WORKFLOW.md) for the complete guide.

## Security and privacy

We take security seriously. Please refer to our [SECURITY.md](SECURITY.md) for our full security policy and instructions on how to report a vulnerability.

-   **Local first**: The plugin must function offline.
-   **Consent**: No network calls without explicit user action.
-   **Secrets**: Securely handle API keys; warn users about where they are stored.

Thank you for helping us build specific, intelligent tools for Obsidian!
