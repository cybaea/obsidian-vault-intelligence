# Goose AI Rules: Vault Intelligence

These rules are specific to the Goose AI agent when working on the Vault Intelligence plugin.

## 1. Research Protocol (Pre-Planning)

Goose does not possess a permanent index of the codebase. You MUST build your own context for every task.

### Recommended Research Tools
- **Analyze**: Use `Analyze.analyze` to get a structured summary of services and views.
- **Summarize**: Use `Summarise.summarise` on large core files (e.g. `SearchOrchestrator.ts`) to understand deep logic.
- **Grep**: Use `Developer.shell` with `grep -r` to find SDK usage patterns (e.g. `@google/genai`).

### High-Value Research Targets
- **SDK Signatures**: Search for `@google/genai` to see current unified SDK usage. **MANDATORY**: Verify if the SDK version supports the requested feature (e.g. multimodal) before proposing new libraries.
- **Search Integration**: Check `SearchOrchestrator.ts` to see how feature impacts the Dual-Loop.
- **Mobile Compatibility**: Search for `Platform.isMobile` and check for Node.js modules in services.

## 2. Implementation Planning Checklist (Adversarial)

Before finalizing any `.tasks/plan-*.md`, you must perform a "Red-Team" evaluation:

### Quality Gate (Critical)
- **Dependency Audit**: If you propose `npm install`, you MUST provide a `grep` proof that the capability is NOT available in our current `@google/genai` SDK or the Obsidian API.
- **Modality Rule**: Multimodal work MUST use the Gemini native API (`Part`/`inlineData`) rather than main-thread JS libraries (like `pdf-lib` or `Canvas`).
- **Main-Thread Ban**: Processing binary blobs (PDF split, Image resize) on the main thread is FORBIDDEN. Use Workers or offload to the Gemini API.
- **Golden Rules**: Does it violate SOA (logic in UI)? Does it use `Vault.read()` directly?
- **Mobile Check**: Does it use Node.js `fs` or `child_process` at the top level? Does it have a graceful mobile fallback?
- **Privacy Check**: Does it propose background uploads without explicit folder/file whitelisting?
- **Rate Limits**: How does it handle Gemini AI 429 errors? Does it implement backoff?
- **Memory (Mobile)**: Does it read massive files (PDFs/Images) into memory without streaming or chunking?

### Architectural Alignment
- **Dual-Loop**: Does data flow into both Orama (keyword) and Vector (semantic) stores?
- **Slim-Sync**: Does it attempt to sync binary data, or does it follow the Hot/Cold split architecture?
- **Dependencies**: Is the added library necessary? Can the task be solved using Gemini's native multimodal API (Summary -> MD)?

## 3. Deployment / Release
- Always run `npm run lint`, `npm run build`, and `npm run test`.
- Add entries to `CHANGELOG.md` under the `[Unreleased]` section.
