# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]


## [1.4.0] - 2026-01-03

### 🚀 Added

- **Computational Solver:** The agent can now write and execute Python code to analyze data from your vault (e.g., *"Read @Monthly Expenses and forecast next month's spend"*).
- **Settings:** New **Enable code execution** toggle for the Computational Solver above(Default: Off) and corresponding **Code model** selector in the Models tab.
- **Settings:** New **Context window budget** setting (Default: 200,000 tokens). This allows users to control how much "memory" the agent uses per request, balancing deep context against API rate limits.

### ⚡ Changed

- **Context Engine:** Replaced the static 50,000-character limit per note with a "Greedy Packing" strategy. The agent now reads entire documents whenever the token budget allows, **significantly improving** its ability to understand long reports and avoiding arbitrary cut-offs.

### 🛠 Developers

- **Dynamic Tools:** Updated `AgentService` to dynamically construct the `tools` array at runtime. This resolves an issue where conditional tools (like the solver) were defined but not correctly passed to the model if disabled.
- **Response Parsing:** Refactored `GeminiService` to manually parse multi-part responses (`text`, `executableCode`, `codeExecutionResult`), resolving SDK warnings about mixed content types.
- **Context Limits:** Removed hardcoded `MAX_TOTAL_CONTEXT` constants. Context limits are now calculated dynamically based on the user's `contextWindowTokens` setting.
- **System Prompt:** Updated the default system prompt to include specific instructions on when and how to utilize the `computational_solver` tool.

## Older versions

Older changes can be found in the repository's [GitHub releases](https://github.com/cybaea/obsidian-vault-intelligence/releases).