<!--
Source: Based on Obsidian community best practices
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Review periodically for AI agent-specific guidance
-->

# Agent do/don't

## Do

- **.ref folder setup**: When user asks to add a reference, check if it already exists first. For external repos:
    - **Clone directly** into the target folder: `../.ref/obsidian-dev/plugins/<name>/` (for plugins), `../.ref/obsidian-dev/themes/<name>/` (for themes), or `../.ref/obsidian-dev/<name>/` (for other projects)
    - **DO NOT** create a `.ref` subfolder inside the plugins/themes folder - clone the repo directly there
    - Then create symlink in project's `.ref/` folder pointing to the global location
    - For local projects, symlink directly in project's `.ref/` (don't clone to global)
    - See [ref-instructions.md](ref-instructions.md) for details.
- Add commands with stable IDs (don't rename once released).
- Provide defaults and validation in settings.
- Write idempotent code paths so reload/unload doesn't leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.
- **Always run `pnpm build` after making changes** to catch build errors early. Only check for pnpm installation if the build fails. See [build-workflow.md](build-workflow.md) for details.
- **Summarize commands**: When user requests "Summarize" or "Summarize for release", follow the workflow in [summarize-commands.md](summarize-commands.md). Always read actual file changes, not just chat history.
- **Release preparation**: When user asks "is my plugin ready for release?" or similar, use [release-readiness.md](release-readiness.md) checklist. Run automated checks where possible, ask user interactively for items requiring their input (like platform testing).

## Don't

- Introduce network calls without an obvious user-facing reason and documentation.
- Ship features that require cloud services without clear disclosure and explicit opt-in.
- Store or transmit vault contents unless essential and consented.
- **File structure**: Never have `main.ts` in both root AND `src/` - this causes build confusion. For simple plugins, `main.ts` in root is acceptable. For plugins with multiple files, place `main.ts` in `src/` (recommended). See [file-conventions.md](file-conventions.md) and [common-pitfalls.md](common-pitfalls.md#maints-file-location).
- **Git operations**: Never automatically commit, push, or perform any git operations. All git operations must be left to the user.
- **Git updates**: When checking for updates to repos in `.ref`, you can use read-only commands like `git fetch` and `git log` to check what's new, but **never automatically pull** - always ask the user first. See [ref-instructions.md](ref-instructions.md) for how to check for updates.

## Fixing Linting Errors

**DO**:

- Read the error message carefully - note the exact line and column
- Understand what the error is actually complaining about
- Check the [linting-fixes-guide.md](linting-fixes-guide.md) for the specific error type
- Fix the root cause, not the symptom
- Test with `pnpm lint` after each fix
- Verify `pnpm build` still works

**DON'T**:

- Add eslint-disable comments without understanding why
- Put disable comments on the wrong line
- Try the same fix multiple times without understanding why it failed
- Suppress errors as a shortcut
- Assume the error location matches where you think the problem is
- Skip reading the documentation for the specific error type

**When Stuck**:

1. Read the error message - what line/column is it complaining about?
2. Check [linting-fixes-guide.md](linting-fixes-guide.md) for that specific error type
3. Understand the type signature - what does the function expect?
4. Fix the actual type mismatch, not just suppress the warning
5. If you've tried the same thing 3 times, stop and re-read the error message
