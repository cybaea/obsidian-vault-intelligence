---
description: Automates the process of creating a PR, waiting for checks, merging it, and cleaning up.
---

1. Detect the default branch and ensure you are NOT on it
   > [!WARNING]
   > This workflow is designed for feature branches. Running it on the default branch will cause errors.

   // turbo
   `export DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) && echo "Default branch is: $DEFAULT_BRANCH" && if [ "$(git branch --show-current)" = "$DEFAULT_BRANCH" ]; then echo "❌ Error: You are currently on the '$DEFAULT_BRANCH' branch. Please only run this workflow from a feature branch."; exit 1; fi`

2. Check if a PR already exists. If it does, STOP to prevent accidental merges of existing PRs.
   // turbo
   `if gh pr view --json url > /dev/null 2>&1; then echo "⚠️ PR already exists for this branch. Stopping workflow for safety. Please manage existing PRs manually."; exit 1; else echo "Creating new PR..." && gh pr create --title "<Title>" --body "<Summary>"; fi`

   > [!NOTE]
   > If creating a new PR, you will need to replace `<Title>` and `<Summary>` with a descriptive title and body based on `git log` and `git diff` analysis.

3. Watch the checks
   // turbo
   `gh pr checks --watch`

4. > [!IMPORTANT]
   > If the checks fail, **STOP**. Analyze the failure using `gh run view`, fix the issues, push updates, and re-run the checks. Only proceed to the next step if checks pass.

5. Merge the Pull Request
   // turbo
   `gh pr merge --merge --delete-branch`

6. Switch to default branch and pull latest changes
   // turbo
   `export DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) && git checkout $DEFAULT_BRANCH && git pull origin $DEFAULT_BRANCH`

7. Delete the local feature branch
   `git branch -d <branch-name>`
