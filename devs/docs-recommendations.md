# VitePress documentation improvements

## Overview

This document analyzes recommended improvements for the project's documentation site. The goal is to balance user value, maintenance overhead, and technical complexity.

## Recommendations

### 1. Mermaid diagram support

**Status**: **Adopt**

**Reasoning**:
The `devs/ARCHITECTURE.md` file contains complex mermaid diagrams (flowcharts, sequence diagrams, and C4 context diagrams). Currently, these render as raw code blocks on the documentation site, which degrades readability and utility. Adding first-class support for Mermaid is critical for properly displaying our architectural documentation.

**Implementation**:
-   Install `vitepress-plugin-mermaid`.
-   Configure in `config.mts`.

### 2. Local search

**Status**: **Adopt**

**Reasoning**:
Search is a fundamental expectation for documentation users. VitePress includes a high-performance, privacy-friendly local search engine (MiniSearch) that requires zero external dependencies or configuration beyond enabling it. This provides immense UX value with negligible overhead.

**Implementation**:
-   Add `search: { provider: 'local' }` to `themeConfig`.

### 3. GitHub integration (Edit links & timestamps)

**Status**: **Adopt**

**Reasoning**:
For an open-source project, encouraging community contributions is vital.
-   **Edit links**: Reduce friction for users to fix typos or improve docs.
-   **Last updated**: Builds trust by showing that documentation is current.

**Implementation**:
-   Add `editLink` configuration.
-   Enable `lastUpdated`.
-   **Note**: Requires updating the GitHub Action workflow to `fetch-depth: 0` to ensure accurate timestamps.

### 4. Sitemap generation

**Status**: **Adopt**

**Reasoning**:
A seamless, zero-config addition that improves SEO and discoverability for the documentation.

**Implementation**:
-   Add `sitemap` configuration to `config.mts`.

### 5. Automated social images (Open Graph)

**Status**: **Adopt (Optional/Nice-to-have)**

**Reasoning**:
Dynamic Open Graph images make shared links look professional on platforms like X (Twitter), Discord, and LinkedIn. While not strictly "functional", it adds a layer of polish expected from high-quality open-source projects. The specific plugin `@nolebase/vitepress-plugin-og-image` is widely used and effective.

**Implementation**:
-   Install and configure the plugin.
-   Remove hardcoded static meta tags where redundant.

---

## Rejected / Defer

### 6. Obsidian syntax support (Callouts, Wikilinks)

**Status**: **Reject**

**Reasoning**:
The project documentation is authored directly in standard Markdown/VitePress Markdown, not maintained in an Obsidian vault.
-   **Callouts**: VitePress native `::: info` syntax is functionally equivalent to Obsidian's `> [!INFO]`. Supporting Obsidian syntax adds parsing overhead and dependency risk without improving the authoring workflow.
-   **Wikilinks**: We rely on standard file paths and links. Adding a wikilink parser introduces complexity (ambiguity resolution) that is unnecessary for a standard static site generator workflow.

### 7. Auto-generated sidebar

**Status**: **Reject (Use existing solution)**

**Reasoning**:
The current `config.mts` already contains a custom `getSidebarItems` function that dynamically generates the sidebar.
-   It works correctly for our current scale (~10-20 files).
-   It handles specific overrides (e.g. `ARCHITECTURE` -> "Architecture").
-   Switching to `vitepress-sidebar` would introduce a new dependency and require configuration migration for marginal benefit. We should stick with the current custom implementation until it becomes unmanageable.
