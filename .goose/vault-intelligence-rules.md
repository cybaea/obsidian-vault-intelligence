# Vault Intelligence: Goose AI Rules

## 1. Research Protocol (Adversarial)

You possess advanced reasoning, but your training data is stale. You MUST verify the current state of the repository before suggesting changes.

### Recommended Research Tools

- **Analyze**: Use `Analyze.analyze` to get a structured summary of services and views.
- **Summarize**: Use `Summarize.summarize` on large core files (e.g. `SearchOrchestrator.ts`) to understand deep logic.
- **Grep**: Use `Developer.shell` with `grep -r` to find SDK usage patterns (e.g. `@google/genai`).

### High-Value Research Targets

- **SDK Signatures**: Search for `@google/genai` to see current unified SDK usage. **MANDATORY**: Use `grep` to find the current version and its available methods. Proposing a library (e.g. `pdf-lib`) when the SDK natively supports a modality is a REJECTABLE OFFENSE.
- **Search Integration**: Check `SearchOrchestrator.ts` to see how feature impacts the Dual-Loop.
- **Mobile Compatibility**: Search for `Platform.isMobile` and check for Node.js modules in services.

## 2. Implementation Planning Checklist (Adversarial)

You MUST perform a "Red-Team" evaluation. Speed-running this phase and ignoring existing capabilities will lead to rejected plans.

### Dependency Vetting (Adversarial)

Proposing new libraries is a high-risk action. You must favor native platform APIs (Obsidian/Web) or existing repository SDKs.

- **Banned Library Example**: `axios`. (Reason: Forbid using generic network libs; ALWAYS use Obsidian's `requestUrl` to bypass CORS and handle proxies).
- **Rule**: If a task falls within the primary domain of an existing SDK (e.g. `@google/genai`, `@orama/orama`), you are FORBIDDEN from adding a third-party library to handle a sub-task unless you provide a 'Grep Proof' that the SDK cannot do it.

### Tool Selection Tiering (Efficiency)

To reduce token-bloat and increase research quality, you MUST favor high-level discovery tools over raw shell commands:

- **Tier 1 (Broad Discovery)**: Use `Analyze.analyze` for mapping directories and finding 'Owner Services'. Use `Summarize.summarize` for understanding `package.json` or long documentation files.
- **Tier 2 (Precise Verification)**: Use `Developer.shell` (grep) or `Developer.read_file` ONLY for the final "Discovery Proof" to verify specific lines of code or SDK signatures.
- **Constraint**: Avoid `cat` or `read_file` on files larger than 100 lines for initial scans. Use `Summarize` first.

## 3. Historical Integrity & Safety (Hard Stop Protocol)

**CRITICAL**: Tool output (stdout) is often limited to 2000 lines or specific byte counts. Reading a file with `cat` or `read_file` and then writing it back with `write` IS THE LEADING CAUSE OF DATA LOSS.

### File Modification Rules
- **FORBIDDEN**: Using `Developer.write` on existing files over 50 lines. This leads to silent truncation.
- **MANDATORY**: Use `Developer.edit` with precise `before` and `after` blocks for all updates to existing files.
- **MANDATORY**: The "Verification Loop":
  1. Run `wc -l <file>` BEFORE the edit.
  2. Perform `Developer.edit`.
  3. Run `wc -l <file>` AFTER the edit.
  4. Compare the counts. If the count dropped significantly (more than your edit intended), run `git checkout <file>` immediately.
- **REPORTING**: You must report the line count delta (e.g., "Line count: 784 -> 787") in your final confirmation.

### Reading Strategy
- **FORBIDDEN**: Using `cat` or raw `read` on files larger than 100 lines to ingest content for a write operation.
- **MANDATORY**: Use `head`, `tail`, `sed`, or `grep` to extract only the context anchors you need for `Developer.edit`.

## 4. Quality Gate (Critical)

- **Grep Proof Requirement**: Proposing any new file, class, or dependency MUST be preceded by a `grep` proof showing that a similar capability does NOT currently exist.
- **Modality Rule**: For multimodal content, you MUST prioritize the identified Provider's native data structures.
- **Main-Thread Ban**: Processing binary blobs on the main thread is FORBIDDEN. Use Workers.
- **Golden Rules**: Does it violate SOA (logic in UI)? Does it use `Vault.read()` directly?
- **Mobile Check**: Does it use Node.js `fs` or `child_process` at the top level?

## 5. Communication Style

- **Status**: Report only significant research milestones.
- **Format**: Use sentence case. Avoid bold in headers. Use "and" over "&".
- **Tone**: Professional, adversarial, and engineering-focused.

## 6. Upstream CLI operations (GitHub and similar)

Incident reference (2026-10-20): three GitHub issues (#704, #705, #706 on this repository) were created with empty bodies after multi-line descriptions were piped to `gh issue create --body -` through a shell heredoc. Every command reported success and returned issue URLs while the stdin payload never arrived. This is the upstream equivalent of the Cat-Write anti-pattern: silent data loss across a tool boundary, with a green exit code.

- **Never deliver generated multi-line content through stdin.** Pipes and heredocs into CLI tools (`gh ... --body -`, API payloads, file uploads) are not reliable through the shell harness, and upstream tools may accept an empty or truncated payload as a silent success.
- **Author upstream-bound content as a durable file artifact first**, then hand it to the tool through a flag (for example `gh issue edit N --body-file .tasks/issue-N-slug.md`). Issue and PR descriptions are written to `.tasks/` with specific filenames before they are pushed upstream, so a delivery failure can never lose authorship.
- **Verify the upstream round-trip.** A returned URL or exit code 0 is not proof of delivery. After an upstream mutation, read the object back (for example `gh issue view N --json body --jq '.body | length'`) and sample interior content, not only the first line.
- **Generalisation**: the pattern applies to any command that receives bulk content through stdin — issue and PR bodies, review comments, CI dispatch payloads, and file uploads. Prefer file-flag interfaces, and confirm state after writing.
