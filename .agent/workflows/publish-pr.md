---
description: Automates creating, verifying, and merging a PR into the default branch.
---

0. SAFETY GUARDRAIL
   > [!IMPORTANT]
   > **ONLY run this workflow if EXPLICITLY REQUESTED BY THE USER.**
   > If you are running this as part of a larger plan (e.g., "fix bug and finish"), you must **STOP** and ask for confirmation before executing this specific workflow.
   > This workflow merges code and deletes branches. It is destructive.

1. Safety Check & Push
   - Ensure we are not on the default branch.
   - Push the current branch to origin (required before creating a PR).
   
   // turbo
   `export DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) && export CURRENT=$(git branch --show-current) && if [ "$DEFAULT" = "$CURRENT" ]; then echo "❌ Error: You are on the default branch ($DEFAULT). Switch to a feature branch first."; exit 1; fi && git push -u origin HEAD`

2. Check for existing PR
   - If a PR already exists, stop. (We don't want to accidentally merge a work-in-progress PR).
   
   // turbo
   `if gh pr view --json url > /dev/null 2>&1; then echo "⚠️ PR already exists. Stopping workflow to avoid accidental merge of WIP."; exit 1; fi`

3. Create Pull Request
   - Create the PR targeting the default branch.
   > [!TIP]
   > We use `--fill` to use the commit message as the PR title/body.
   > We explicitly set `--base` to the default branch to avoid "Stacked Branch" confusion.

   // turbo
   `export DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) && gh pr create --base "$DEFAULT" --fill`

4. Watch Checks
   - Wait for GitHub Actions (CI) to pass.
   > [!NOTE]
   > If you do not have CI checks enabled, this step will exit immediately (which is fine).
   
   // turbo
   `gh pr checks --watch`

5. Merge & Delete Remote
   - Squash and merge the PR, then delete the branch on GitHub.
   
   // turbo
   `gh pr merge --squash --delete-branch`

6. Cleanup Local Branch
   - Switch to default, pull the new changes, and delete the local feature branch.
   
   // turbo
   `export DEFAULT=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name) && export CURRENT=$(git branch --show-current) && git checkout "$DEFAULT" && git pull origin "$DEFAULT" && git branch -D "$CURRENT"`
