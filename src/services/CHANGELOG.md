# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

This will become version 1.4.0, ie a minor release.

- New features, including code execution support and greedy packing for context.
- New settings.



### 🚀 Users

* **New Feature:** Added **Computational Solver** tool. The agent can now execute Python code to solve math problems, data analysis tasks, and logic puzzles (e.g., "Calculate the 102nd prime number").
* **Context Engine:** Removed the 50,000-character limit per note. The agent now uses a "Greedy Packing" strategy to read entire documents whenever possible, only clipping files if they threaten to starve other search results.
* **Settings:** Added **Enable code execution** toggle to the Models settings tab. (Default: off)
* **Settings:** Added **Context window budget** setting (default: 200,000 tokens) to allow users to balance performance against API rate limits.

### 🛠 Developers

* **Refactor:** Updated `AgentService` to dynamically construct the `tools` array. This fixes a bug where conditional tools (like the solver) were defined but not passed to the model.
* **Refactor:** Updated `GeminiService` to manually parse multi-part responses (`text`, `executableCode`, `codeExecutionResult`), resolving SDK warnings about mixed content.
* **Fix:** Replaced hardcoded context limits (`MAX_TOTAL_CONTEXT`) with dynamic calculations based on the new `contextWindowTokens` setting.
* The agent can now use a new computational_solver tool to address math problems, complex logic, and data analysis through code execution.
* This feature is configurable via new settings: enableCodeExecution (toggle) and codeModel (model selection).
* AgentService has been updated to dynamically register and execute the computational_solver based on these settings.
* GeminiService now includes a solveWithCode method, responsible for invoking the Gemini API's code execution capabilities and parsing its structured responses.
* The default system prompt has been adjusted to instruct the agent on when and how to utilise the new code execution tool.
* Removed outdated comments in GeminiService.ts related to grounding model optimisations and embedding dimensionality.



## Older versions

Older changes can be found in the repository's [GitHub releases](https://github.com/cybaea/obsidian-vault-intelligence/releases)