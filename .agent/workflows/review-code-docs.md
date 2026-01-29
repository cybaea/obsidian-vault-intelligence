---
description: Review code, architecture, and developer documentation
---

# 1. Review code and architecture

Adopt roles as systems architect and senior developer. Review the code base for this Obsidian plugin. Consider best architecture and coding practices for Node.js, Electron, and Obsidian plugins to produce a comprehensive review and an implementation plan for any changes that are needed. Don’t just change things for the sake of changing them: change what is material and what will have an impact on ongoing maintenance and future developments.

In addition to the broad review, consider carefully these points:

- Scan the code for any instances where we disable lint checks: if possible, we want to avoid this to keep our code clean.
- Does the code adhere to the don’t-repeat-yourself (DRY) principles? Are there any duplicated code that could usefully be refactored?
- Does the code have any “magic numbers”, “magic strings”, or other constants in the code that could and should be replaced with a named constant (e.g. in `src/constants.ts`) or, perhaps better, replace with a user setting (in the existing files or a new file in `src/settings/`)?
   	- A _magic number_ is a unique value with unexplained meaning or multiple occurrences which could (and should) be replaced with a named constant.
- Review the code for other common anti-patterns, e.g.:
   	- The `any` abuse. We don’t permit the use of `any`. Ideally, find or define the interface type; if you truly don’t know it, use `unknown`.
   	- The "Bang" (`!`) operator overuse: forcing a type to exist rather than handling the null case. Consider using optional chaining (`?.`) or nullish coalescing (`??`).
   	- The God Object: A single class or file that knows too much or does too much. It violates the Single Responsibility Principle. Where appropriate, break logic into smaller, focused modules.
   	- Primitive obsession: Using primitive types (`string`, `number`) to represent complex domain concepts. This is related to “magic numbers" but specifically about _types_. Consider using "Branded Types" or specific interfaces to distinguish them.
   	- Arrow Code (Nested `If`s): Code that looks like an arrow (`>`) because it is heavily indented with nested `if/else` statements. Consider return early ("Guard Clauses").
   	- Promise Hell (Nested `.then()`): Nesting `.then()` calls creates a pyramid structure that is hard to read and debug.  Consider: Use `async/await`.
- Review the code for unnessesary abstractions.
   	- Quote: "Abstractions are not your enemy but they are a dangerous temptation".

# 2. Review developer documentation

Adopt roles as systems architect and systems analyst. Carefully analyse the code to **update** the markdown document `devs/ARCHITECTURE.md` as a detailed reference of the system architecture. This document is complemented by `devs/adr/`.

**Target Audience:** Developers, Collaborators, Systems Analysts, Maintainers.
**Format:** GitHub Markdown with embedded Mermaid.js diagrams.

In addition to the detailed descriptions, be sure to include:

- Detailed Mermaid.js diagrams of the Data Flows in the system.
- Detailed Mermaid.js diagrams of the Control Flows and interfaces in the system.
- Strict documentation on all Service interfaces.
   	- Where missing, update sources with Inline JSDoc.

Does the documentation adhere to our markdown formatting rules (`.agent/rules/Markdown.md`)?

# 3. Review user documentation

Adopt role as an expert in user experience and documentation. Carefully review the user documentation in `README.md` and `docs/` to assess:

- if anything needs updating due to our recent changes
- if the documentation is still clear and helpful
- if the documentation serves our ambition of gaining more users.

**Target Audience:** New and exsisting users. Content creators for Obsidian who want to showcase our plugin.
**Format:** GitHub Markdown with linked images in `public/images/` and, where useful, embedded Mermaid.js diagrams.

Does the documentation adhere to our markdown formatting rules (`.agent/rules/Markdown.md`)?
