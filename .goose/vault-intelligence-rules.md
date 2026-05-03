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
