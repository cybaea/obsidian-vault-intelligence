---
description: Automates the process of creating a PR, waiting for checks, merging it, and cleaning up.
---

1. Detect the default branch and ensure you are NOT on it
   > [!WARNING]
   > This workflow is designed for feature branches. Running it on the default branch will cause errors.

   // turbo
   `export DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) && echo "Default branch is: $DEFAULT_BRANCH" && if [ "$(git branch --show-current)" = "$DEFAULT_BRANCH" ]; then echo "❌ Error: You are currently on the '$DEFAULT_BRANCH' branch. Please only run this workflow from a feature branch."; exit 1; fi`

2. Check if a PR already exists for the **current branch**.
   
   > [!NOTE]
   > `gh` automatically targets the PR associated with your current branch. The `if` check uses the exit code of `gh pr view` to skip creation if a PR is already open.

   // turbo
   `if gh pr view --json url > /dev/null 2>&1; then echo "✅ PR already exists for this branch. Skipping creation."; else echo "Creating new PR..." && gh pr create --title "<Title>" --body "<Summary>"; fi`

3. Watch the checks for the **current branch's PR**
   // turbo
   `gh pr checks --watch`

4. > [!IMPORTANT]
   > If the checks fail, **STOP**. Analyze the failure using `gh run view`, fix the issues, push updates, and re-run the checks. Only proceed to the next step if checks pass.

5. Merge the Pull Request (associated with the **current branch**)
   // turbo
   `gh pr merge --merge --delete-branch`

6. Switch to default branch and pull latest changes
   // turbo
   `export DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) && git checkout $DEFAULT_BRANCH && git pull origin $DEFAULT_BRANCH`

7. Delete the local feature branch
   `git branch -d <branch-name>`
