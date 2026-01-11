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
   `if gh pr view --json url > /dev/null 2>&1; then echo "⚠️ PR already exists for this branch. Stopping workflow for safety. Please manage existing PRs manually."; exit 1; fi`

3. Analyze the changes compared to the default branch
   `export DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) && git log $DEFAULT_BRANCH..HEAD --oneline`
   `export DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) && git diff $DEFAULT_BRANCH...HEAD --stat`

4. Create the Pull Request with a descriptive title and body based on the analysis
   `gh pr create --title "<Title>" --body "<Summary>"`

5. Watch the checks
   // turbo
   `gh pr checks --watch`

6. > [!IMPORTANT]
   > If the checks fail, **STOP**. Analyze the failure using `gh run view`, fix the issues, push updates, and re-run the checks. Only proceed to the next step if checks pass.

7. Merge the Pull Request
   // turbo
   `gh pr merge --merge --delete-branch`

8. Switch back to the default branch, pull latest changes, and delete the local feature branch
   // turbo
   `export DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) && export BRANCH_TO_DELETE=$(git branch --show-current) && git checkout $DEFAULT_BRANCH && git pull origin $DEFAULT_BRANCH && git branch -d $BRANCH_TO_DELETE`
