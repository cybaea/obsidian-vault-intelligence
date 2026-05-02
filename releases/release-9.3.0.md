# 9.3.0 — Connectivity & Modernisation

This release focuses on enhancing connectivity for local AI environments and modernising our core development foundations. We've introduced custom headers for Ollama, giving users greater control over their private infrastructure, while upgrading to TypeScript 6.0 and ESLint 10 to ensure the plugin remains robust and future-proof.

## Custom Headers for Ollama

You can now configure custom HTTP headers for Ollama requests. This is particularly useful if you are running Ollama behind a proxy that requires authentication tokens or specific routing headers.

*   **Flexibility**: Connect to remote Ollama instances that require `Authorization` or custom headers.
*   **Privacy**: Maintain secure connections to your private infrastructure without sacrificing ease of use.

## Developer Foundations

We've invested in our toolchain to ensure Vault Intelligence remains at the forefront of the Obsidian ecosystem.

*   **TypeScript 6.0**: The plugin is now built using the latest version of the TypeScript compiler, bringing improved performance and stricter type safety.
*   **ESLint 10 Migration**: We've fully adopted the mandatory flat configuration system for ESLint 10, ensuring compatibility with modern Node.js environments and better linting performance.
*   **Ecosystem Alignment**: Updated the Obsidian Linter and other core dependencies to their latest versions, resolving minor linting discrepancies and hardening the build process.

## The Polish

*   Updated various internal packages for security and performance.
*   Resolved minor linting errors identified by the new ESLint 10 ruleset.
