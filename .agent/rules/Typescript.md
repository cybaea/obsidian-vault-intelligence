---
trigger: glob
globs: src/**/*.ts
---

# Typescript rules

- For Typescript, use strict typing. Note that the `any` type is never allowed.
- Always check that `npm run lint` completes without errors or warnings.
- Resolve lint messages in code without resorting to disabling the linter with `eslint` comments.
- For "sentence case" lint errors, try to resolve the language. If difficult:
    - If due to brand names, use variables as a workaround.
    - If you can't resolve, stop and ask user for help.
