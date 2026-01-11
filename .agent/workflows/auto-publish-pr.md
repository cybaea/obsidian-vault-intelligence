---
description: Automates the process of creating a PR, waiting for checks, merging it, and cleaning up.
---

1. Analyze the changes to generate a PR body
   `git log main..HEAD --oneline`
   `git diff main...HEAD --stat`

2. Create the Pull Request with a descriptive title and body based on the analysis
   `gh pr create --title "<Title>" --body "<Summary>"`

3. Watch the checks
   // turbo
   `gh pr checks --watch`

4. > [!IMPORTANT]
   > If the checks fail, **STOP**. Analyze the failure using `gh run view`, inform the user, fix the issues, push updates, and re-run the checks. Only proceed to the next step if checks pass.

5. Merge the Pull Request
   // turbo
   `gh pr merge --merge --delete-branch`

6. Switch to main and pull latest changes
   // turbo
   `git checkout main && git pull origin main`

7. Delete the local feature branch
   `git branch -d <branch-name>`