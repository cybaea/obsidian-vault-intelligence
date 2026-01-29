---
description: Cleans up local branches that have been merged or deleted on the remote
---

1. Safety First
   - Switch to main and update it to ensure we have the latest state.
   > [!IMPORTANT]
   > We sync main first so we don't accidentally delete something that looks "gone" just because we are outdated.

   // turbo
   `git checkout main && git pull`

2. Prune Remotes
   - Tell git to forget about remote branches that no longer exist on GitHub.
   
   // turbo
   `git fetch --prune`

3. Delete "Gone" Branches
   - Identify local branches that track a deleted remote branch (marked as "gone") and delete them.
   - We use `xargs` to handle the list efficiently.
   
   // turbo
   `git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -I {} git branch -D {}`

4. Report Status
   - Show the remaining branches so the user knows the cleanup worked.
   
   // turbo
   `echo "✅ Cleanup complete. Remaining local branches:" && git branch`
