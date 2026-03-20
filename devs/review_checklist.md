# Codebase Review Checklist

## Obsidian Plugin Best Practices

-   [ ] **Vault Access**: Views should not access `app.vault` directly. They should use `VaultManager` or specific services.
-   [ ] **Event Handling**: `vault.on('modify')` and similar events should be debounced to prevent performance issues.
-   [ ] **Lifecycle**: `onunload` should properly clean up resources (intervals, event listeners, workers).
-   [ ] **Settings**: Settings should be persisted and loaded correctly.
-   [ ] **UI/Main Thread**: Heavy operations (indexing, search) must be offloaded to Web Workers.

## TypeScript & Modern JavaScript

-   [ ] **Type Safety**: Avoid `any`. Use interfaces, types, or `unknown` with narrowing.
-   [ ] **Asynchronous Code**: Use `async/await` instead of raw Promises (`.then`).
-   [ ] **Null Safety**: Use optional chaining (`?.`) and nullish coalescing (`??`) instead of verbose checks or bang (`!`) operator.
-   [ ] **Error Handling**: Proper `try/catch` blocks in async functions, especially at system boundaries (API calls, Worker messages).

## Architecture & Design Patterns

-   [ ] **Single Responsibility**: Classes should have a single purpose. Watch out for "God Objects" (e.g., a service doing too much).
-   [ ] **Dependency Injection**: Services should receive dependencies via constructor, making testing easier.
-   [ ] **DRY (Don't Repeat Yourself)**: Common logic should be extracted to utilities or base classes.
-   [ ] **Magic Values**: Strings and numbers should be constants in `src/constants.ts` or `src/settings/`.

## Performance & Security

-   [ ] **Memory Management**: Large objects (like the graph or index) should be managed carefully.
-   [ ] **Input Validation**: User inputs and external data (LLM responses) should be validated (e.g., using Zod).
-   [ ] **Sanitization**: Content rendered to HTML must be sanitized to prevent XSS.

## Specific Anti-Patterns to Scan

-   [ ] **Arrow Code**: deeply nested `if/else` blocks.
-   [ ] **Primitive Obsession**: Using strings/numbers where specific types/enums would be safer.
-   [ ] **Fragile Regex**: Complex regexes without comments or error handling.
-   [ ] **Console Logging**: Excessive `console.log` in production code (should use a Logger).
