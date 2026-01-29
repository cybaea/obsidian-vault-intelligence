<!--
Source: Project-specific quick reference
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Update as needed
-->

# Quick Sync Guide

This is a quick reference for pulling the latest changes from reference repositories. For detailed sync procedures, see [sync-procedure.md](sync-procedure.md).

## Determine Your Setup First

**IMPORTANT**: Before syncing, check if `.ref` contains symlinks or actual repos. Git operations must be performed on the **actual target location**, not on symlinks.

**Windows (PowerShell)**:

```powershell
Get-Item .ref/obsidian-api | Select-Object LinkType, Target
# If LinkType shows "Junction" or "SymbolicLink", you're using symlinks
# The Target property shows where the symlink points (usually ..\.ref\obsidian-dev)
```

**macOS/Linux**:

```bash
ls -la .ref/obsidian-api
# If it shows "->" with a path, it's a symlink
# Use readlink to see the target: readlink -f .ref/obsidian-api
```

**If using symlinks**: Navigate to the central location (usually `..\.ref\obsidian-dev` or `~/Development/.ref/obsidian-dev`) before running git commands.

**If using local clones**: Run commands from project root, navigating to each `.ref/` subdirectory.

## What Does `git pull` Do?

When you run `git pull` in a reference repository:

1. **Fetches** the latest commits from the remote repository (GitHub)
2. **Merges** those changes into your local copy
3. **Updates** all files in that repository to the latest version

**Important**: This only updates the files in `.ref/` - it does NOT automatically update your `.agents/` files. You need to manually review and sync changes.

## Quick Pull Commands

### If Using Symlinks (Central Location)

```bash
# Navigate to your central refs directory (adjust path as needed)
cd ../.ref/obsidian-dev  # or cd ~/Development/.ref/obsidian-dev

# Pull all repos at once
cd obsidian-api && git pull && cd ..
cd obsidian-sample-plugin && git pull && cd ..
cd obsidian-developer-docs && git pull && cd ..
cd obsidian-plugin-docs && git pull && cd ..
cd obsidian-sample-theme && git pull && cd ..
cd eslint-plugin && git pull && cd ..
```

Or use a simple loop (bash/zsh):

```bash
cd ../.ref/obsidian-dev  # or cd ~/Development/.ref/obsidian-dev
for repo in obsidian-api obsidian-sample-plugin obsidian-developer-docs obsidian-plugin-docs obsidian-sample-theme eslint-plugin; do
    echo "Pulling $repo..."
    cd "$repo" && git pull && cd ..
done
```

Or PowerShell (Windows):

```powershell
cd ..\.ref\obsidian-dev  # Adjust path as needed
foreach ($repo in @('obsidian-api', 'obsidian-sample-plugin', 'obsidian-developer-docs', 'obsidian-plugin-docs', 'obsidian-sample-theme', 'eslint-plugin')) {
    Write-Host "Pulling $repo..."
    cd $repo
    git pull
    cd ..
}
```

### If Using Local Clones (In Project)

```bash
# From your project root
cd .ref

# Pull each repo (always start from project root for each command)
cd obsidian-api && git pull && cd ../..
cd obsidian-sample-plugin && git pull && cd ../..
cd obsidian-developer-docs && git pull && cd ../..
cd obsidian-plugin-docs && git pull && cd ../..
cd obsidian-sample-theme && git pull && cd ../..
cd eslint-plugin && git pull && cd ../..
```

## Check What Changed

After pulling, see what's new:

```bash
# See recent commits in a repo
cd .ref/obsidian-sample-plugin
git log --oneline -10

# See what files changed in the last update
git diff HEAD~1 HEAD --name-only

# See detailed changes to a specific file (e.g., AGENTS.md)
git diff HEAD~1 HEAD -- AGENTS.md

# See changes since your last pull (if you know the commit)
git log --oneline --since="2 weeks ago"
```

## What to Look For

After pulling, check these key files for changes:

- **obsidian-sample-plugin/AGENTS.md** → Compare with your `.agents/` files
- **obsidian-sample-plugin/README.md** → Check for new setup instructions
- **obsidian-api/** → Look for new API documentation or breaking changes
- **obsidian-developer-docs/en/** → Check for updated official documentation
- **obsidian-plugin-docs/** → Review for new plugin guidance

## Next Steps

After pulling and reviewing changes:

1. **Compare** relevant files from `.ref/` with your `.agents/` files
2. **Update** `.agents/` files with new information
3. **Update** the "Last synced" date in file headers
4. **Commit** your changes

See [sync-procedure.md](sync-procedure.md) for the complete workflow.

## Example: Quick Check Workflow

```bash
# 1. Pull all repos (using symlinks - adjust path as needed)
cd ../.ref/obsidian-dev  # or cd ~/Development/.ref/obsidian-dev
for repo in obsidian-api obsidian-sample-plugin obsidian-developer-docs obsidian-plugin-docs obsidian-sample-theme eslint-plugin; do
    cd "$repo" && git pull && cd ..
done

# 2. Check if Sample Plugin's AGENTS.md changed
cd obsidian-sample-plugin
git log --oneline -5 -- AGENTS.md

# 3. If it changed, see the diff
git diff HEAD~1 HEAD -- AGENTS.md

# 4. Now you can manually update your .agents files based on what changed
```

**PowerShell version (Windows)**:

```powershell
# 1. Pull all repos (using symlinks - adjust path as needed)
cd ..\.ref\obsidian-dev
foreach ($repo in @('obsidian-api', 'obsidian-sample-plugin', 'obsidian-developer-docs', 'obsidian-plugin-docs', 'obsidian-sample-theme', 'eslint-plugin')) {
    cd $repo
    git pull
    cd ..
}

# 2-4. Same as above
```
