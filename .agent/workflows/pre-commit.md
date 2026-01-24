---
description: quality gates to verify before completing a task
---

Before marking a task as DONE or asking the user to commit, you MUST perform these checks:

1. **Lint Check**: Ensure code quality standards.
// turbo
```bash
npm run lint
```
*Goal: 0 errors, 0 warnings.*

2. **Build Verification**: Ensure strict TypeScript compilation.
// turbo
```bash
npm run build
```
*Goal: Build completes successfully with no errors.*

4. **Automated tests**: Ensure tests run
// turbo
```bash
npm run test
```
*Goal: Tests run with all Tests passed.*

3. **Runtime Safety**: Check for console errors in a running Obsidian instance (Vault: **Allan-Dev**).
   - Use the `/debug-obsidian` workflow if Obsidian is not running.
   - **Critical**: Verify the correct vault ('Allan-Dev') is active before checking logs.
   - If running, verify no red errors from `[VaultIntelligence]` appear in the console.