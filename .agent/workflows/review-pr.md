---
description: Carefully review, research, and verify a Renovate dependency pull request.
---

1. Check for uncommitted changes and switch to the PR branch
   > [!IMPORTANT]
   > Replace `<PR_NUMBER>` in the command below with the actual number provided by the user (e.g., if user types `/review-pr 101`, replace `<PR_NUMBER>` with `101`).
   > Ensure your workspace is clean before running this workflow.

   // turbo
   `if [ -n "$(git status --porcelain)" ]; then echo "❌ Error: You have uncommitted changes. Please stash or commit them before running this workflow."; exit 1; fi && gh pr checkout <PR_NUMBER> && git pull origin $(git branch --show-current)`

2. Rebase on main (Local verification only)
   > [!WARNING]
   > This rebase is for local verification only. **DO NOT PUSH** the rebased branch to origin unless you intend to "take over" the PR and stop Renovate updates.
   > If rebase fails due to conflicts, we abort immediately to keep the workspace clean.
   > [!TIP]
   > If this step fails with a "_Merge Conflict detected!_", you should go to the Renovate Dependency Dashboard in GitHub and tick the checkbox to rebase/retry the PR.

   // turbo
   `git fetch origin main && (git rebase origin/main || (echo "❌ Merge Conflict detected! Aborting rebase to clean up..." && git rebase --abort && exit 1))`

3. Identify changed dependencies
   - Parse the PR body or `package.json` diff to identify exactly which packages are being upgraded.

4. Research release notes and breaking changes
   - Use `search_web` to find changelogs. Look for "breaking changes", "migration guide", or security fixes.

5. Codebase impact analysis
   - Use `grep_search` to find usage of affected APIs if breaking changes are suspected.

6. Automated Verification Suite
   > [!TIP]
   > Use `npm ci` to respect the lockfile and avoid unnecessary changes.

   // turbo
   `npm ci && npm run build && npm test && npm run lint`

7. Report Findings
   - **Do NOT create artifacts** in the repository.
   - Summarize your research and verification results explicitly in the chat.
   - Post the summary as a comment on the PR using `gh pr comment`.
   > [!IMPORTANT]
   > Do NOT use shell variables for the PR number (e.g., $PR_NUMBER) as they do not persist between steps. Use the explicit number provided by the user (e.g., `101`).
   > To avoid shell quoting errors, write the summary to a temporary file first using the `write_to_file` tool (NOT echo), then use `--body-file`.

   1. Call `write_to_file` to create `pr_summary.txt` with your detailed finding. 
      - Include a section: "**Manual Verification**: Please manually load the plugin in Obsidian to check for UI regressions, as automated tests cannot cover this."
   // turbo
   2. `gh pr comment <PR_NUMBER> --body-file pr_summary.txt && rm pr_summary.txt`

8. Cleanup (Optional)
   - If the review is successful and you are NOT merging immediately, switch back to main.
   - `git checkout main && git branch -D -`
