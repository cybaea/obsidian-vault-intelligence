---
description: Automates the process of creating a PR, waiting for checks, merging it, and cleaning up.
---

0. IMPORTANT: ONLY run this workflow if EXPLICITLY REQUESTED BY THE USER. If you are running this as part of your own plan that has been auto-approved or which does not EXPLICITLY state that you will run this workflow THEN STOP NOW. This workflow is potentially destructive.

1. Detect the parent branch and ensure you are NOT on it
   > [!WARNING]
   > This workflow is designed for feature branches. Running it on a default or parent branch will cause errors.

   // turbo
   `export CURRENT_BRANCH=$(git branch --show-current) && export PARENT_BRANCH=$(git show-branch -a 2>/dev/null | grep '\*' | grep -v "$CURRENT_BRANCH" | head -n1 | sed 's/.*\[\(.*\)\].*/\1/' | sed 's/[\^~].*//' | sed 's|origin/||') && if [ -z "$PARENT_BRANCH" ]; then export PARENT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name); fi && echo "Parent branch is: $PARENT_BRANCH" && if [ "$CURRENT_BRANCH" = "$PARENT_BRANCH" ]; then echo "❌ Error: You are currently on the parent branch '$PARENT_BRANCH'. Please only run this workflow from a feature branch."; exit 1; fi`

2. Check if a PR already exists. If it does, STOP to prevent accidental merges of existing PRs.
   // turbo
   `if gh pr view --json url > /dev/null 2>&1; then echo "⚠️ PR already exists for this branch. Stopping workflow for safety. Please manage existing PRs manually."; exit 1; fi`

3. Analyze the changes compared to the parent branch
   `export CURRENT_BRANCH=$(git branch --show-current) && export PARENT_BRANCH=$(git show-branch -a 2>/dev/null | grep '\*' | grep -v "$CURRENT_BRANCH" | head -n1 | sed 's/.*\[\(.*\)\].*/\1/' | sed 's/[\^~].*//' | sed 's|origin/||') && if [ -z "$PARENT_BRANCH" ]; then export PARENT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name); fi && git log $PARENT_BRANCH..HEAD --oneline && git diff $PARENT_BRANCH...HEAD --stat`

4. Create the Pull Request with a descriptive title and body based on the analysis
   `export CURRENT_BRANCH=$(git branch --show-current) && export PARENT_BRANCH=$(git show-branch -a 2>/dev/null | grep '\*' | grep -v "$CURRENT_BRANCH" | head -n1 | sed 's/.*\[\(.*\)\].*/\1/' | sed 's/[\^~].*//' | sed 's|origin/||') && if [ -z "$PARENT_BRANCH" ]; then export PARENT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name); fi && gh pr create --base "$PARENT_BRANCH" --title "<Title>" --body "<Summary>"`

5. Watch the checks
   // turbo
   `gh pr checks --watch`

6. > [!IMPORTANT]
   > If the checks fail, **STOP**. Analyze the failure using `gh run view`, fix the issues, push updates, and re-run the checks. Only proceed to the next step if checks pass.

7. Merge the Pull Request
   // turbo
   `gh pr merge --merge --delete-branch`

8. Switch back to the parent branch, pull latest changes, and delete the local feature branch
   // turbo
   `export CURRENT_BRANCH=$(git branch --show-current) && export PARENT_BRANCH=$(git show-branch -a 2>/dev/null | grep '\*' | grep -v "$CURRENT_BRANCH" | head -n1 | sed 's/.*\[\(.*\)\].*/\1/' | sed 's/[\^~].*//' | sed 's|origin/||') && if [ -z "$PARENT_BRANCH" ]; then export PARENT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name); fi && git checkout $PARENT_BRANCH && git pull origin $PARENT_BRANCH && git branch -d $CURRENT_BRANCH`
