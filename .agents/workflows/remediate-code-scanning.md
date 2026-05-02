---
name: remediate-code-scanning
description: Audits, fixes, and documents all open GitHub Code Scanning (CodeQL) alerts.
---

1. Fetch Open Alerts
   // turbo
   `gh api /repos/cybaea/obsidian-vault-intelligence/code-scanning/alerts?state=open > open_alerts.json`

2. Analyze & Plan
   - Review `open_alerts.json`.
   - Create a task list in `.tasks/remediate-alerts.md`.
   - Identify CWE categories for documentation.

3. Fix & Verify (Batch Mode)
   - Apply fixes to files.
   - Run `npm run lint && npm run build && npm run test`.
   - If tests fail, revert and refine.

4. Update Changelog (Strict Integrity)
   - Add entries to `CHANGELOG.md` under `[Unreleased]`.
   - Categorize into `### Security` and `### Developer features`.
   - Use CWE tags.

5. Completion
   - Run `npm run docs:build` to ensure documentation remains valid.
   - Clean up temporary files like `open_alerts.json`.
