---
trigger: glob
globs: "*.ts, *.tsx"
---
# TypeScript Coding Rules

When editing or generating TypeScript files for Vault Intelligence, adhere to these constraints:

1. **Strict Typing:** Never use `any`. Always provide explicit types or interfaces.
2. **Linting Compliance:** **Never** disable linting with eslint directives unless explicitly authorized by the user. Fix the underlying problem.
3. **Magic Numbers/Strings:** Do not use hardcoded magic numbers or strings in logic code. Use defined constants.
4. **Error Handling:** Check HTTP status codes as numbers, not by parsing error strings.
5. **Separation of Concerns:**
   - Never import UI components (Views, Modals) into Service classes.
   - Always use constructor-based Dependency Injection.
