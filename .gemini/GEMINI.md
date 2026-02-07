# Project Context: Vault Intelligence

You are working on **Vault Intelligence**, an Obsidian plugin powered by Gemini 3.

Use **search grounding** for all technical decisions.

## CRITICAL INSTRUCTIONS

At the start of every session, you **MUST**:

1.  **Read and Internalize**: `devs/ARCHITECTURE_AND_STANDARDS.md`. This is the authoritative source of truth for this project.
2.  **Adhere to SOA**: Strictly follow the Service-Oriented Architecture defined in that document. No business logic in Views.
3.  **Verification**: Always run `npm run lint`, `npm run build`, `npm run test` and `npm run docs:build` before marking a coding task as complete.

## Key constraints

*   **API**: Use `SecretStorage` for keys. Use `SettingGroup` for settings.
*   **Style**: Strongly prefer Obsidian CSS variables (e.g. `--color-red`); use custom variables only when necessary and with proper justification.
*   **Docs**: Reference `devs/REFERENCE_LINKS.md` for external resources.
*   **Linting**: **Never** disable linting with eslint directives unless explicitly authorized by the user. Fix the problem, not the symptom.

## Writing style

*   Prefer sentence case headers.
*   Use emojis sparingly and only when they add value.
*   Use bold text sparingly and only when it adds value.
    *   Do not use bold text in markdown headers; if emphasis is needed, use italics (`_text_`).
*   Prefer 'and' over '&' in text.

## Changelog

*   Always add new entries to the `[Unreleased]` section.
