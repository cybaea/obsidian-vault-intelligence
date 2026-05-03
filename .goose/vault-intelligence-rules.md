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

### Quality Gate (Critical)

- **Grep Proof Requirement**: Proposing any new file, class, or dependency MUST be preceded by a `grep` proof showing that a similar capability does NOT currently exist in `src/services/` or `src/utils/`.
- **Modality Rule**: For multimodal content, you MUST prioritize the identified Provider's native data structures (e.g. binary parts, image arrays, or base64 fields) over external binary processing libraries. Proposing an external library requires a `grep` proof that the provider SDK lacks the capability.
- **Main-Thread Ban**: Processing binary blobs on the main thread is FORBIDDEN. Use Workers or offload to the Provider's native API.
- **Golden Rules**: Does it violate SOA (logic in UI)? Does it use `Vault.read()` directly?
- **Mobile Check**: Does it use Node.js `fs` or `child_process` at the top level? Does it have a graceful mobile fallback?
- **Privacy Check**: Does it propose background uploads without explicit folder/file whitelisting?

## 4. Historical Integrity & Safety (Hard Stop Protocol)

### File Modification Rules
- **FORBIDDEN**: Using `Developer.write` on existing files over 100 lines. This leads to silent truncation and data loss.
- **MANDATORY**: Use `Developer.edit` with precise `before` and `after` blocks for all updates to large files (e.g., `CHANGELOG.md`, `ARCHITECTURE.md`).
- **MANDATORY**: Run `wc -l <file>` immediately BEFORE and AFTER any edit. You MUST report the line count delta in your response.
- **MANDATORY**: If an unintended truncation is detected (unexpected line count drop), you MUST immediately run `git checkout <file>` to restore the file before taking any further action.

### Reading Strategy
- **FORBIDDEN**: Using `cat` or raw `read` on files larger than 100 lines. The tool output will be truncated, leading to "split-brain" reasoning.
- **MANDATORY**: Use `head`, `tail`, `sed`, or `grep` to extract only the context you need to perform an `edit`.

## 5. Communication Style

- **Status**: Report only significant research milestones.
- **Format**: Use sentence case. Avoid bold in headers. Use "and" over "&".
- **Tone**: Professional, adversarial, and engineering-focused.

## 4. Historical Integrity & Hard Stop Protocol

To prevent unintended data loss in large files (like `CHANGELOG.md`), you MUST follow these constraints:

### Constraints
- **Forbidden**: Never use `Developer.write` or `Developer.write_file` to update an existing file that is likely to be large (>100 lines).
- **Mandatory**: Use `Developer.edit` for targeted search-and-replace.
- **Verification**: Always run `wc -l <path>` before and after any modification to ensure no unintended truncation occurred.
- **Read Strategy**: Do NOT use `cat` or `read_file` on large files. Use `sed`, `grep`, or `head/tail` to find the specific anchors for editing.

### Failure Condition
Truncating a file (e.g. dropping historical changelog entries) is defined as an **Architectural Failure**. If this occurs, immediately run `git checkout <path>` to restore the state.
