---
description: Carefully review, research, and verify a Renovate dependency pull request.
---

1. Check for uncommitted changes and switch to the PR branch
   > [!IMPORTANT]
   > Replace `<PR_NUMBER>` in the command below with the actual number provided by the user (e.g., if user types `/review-pr 101`, replace `<PR_NUMBER>` with `101`).
   > Ensure your workspace is clean before running this workflow.

   // turbo
   `if [ -n "$(git status --porcelain)" ]; then echo "❌ Error: You have uncommitted changes. Please stash or commit them before running this workflow."; exit 1; fi && export PR_NUMBER=<PR_NUMBER> && export PR_BRANCH=$(gh pr view $PR_NUMBER --json headRefName -q .headRefName) && git fetch origin $PR_BRANCH && git checkout $PR_BRANCH && git pull origin $PR_BRANCH`

2. Rebase on main to ensure compatibility
   > [!WARNING]
   > This rebase is for local verification only. **DO NOT PUSH** the rebased branch to origin unless you intend to "take over" the PR and stop Renovate updates.

   // turbo
   `git fetch origin main && git rebase origin/main`

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
   - **Do NOT create artifacts** (like implementation_plan.md).
   - Summarize your research and verification results directly in the chat.
   - Post the summary as a comment on the PR using `gh pr comment`.

   `gh pr comment <PR_NUMBER> --body "## Review Summary\n\n- **Research**: <SUMMARY>\n- **Verification**: <VERIFICATION_RESULTS>"`

8. Cleanup (Optional)
   - If the review is successful and you are NOT merging immediately, switch back to main.
   - `git checkout main && git branch -D $PR_BRANCH`
