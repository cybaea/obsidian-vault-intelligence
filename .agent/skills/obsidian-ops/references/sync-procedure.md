<!--
Source: Project-specific procedure
Last synced: 2026-02-08
Update frequency: Update as sync process evolves
Applicability: Both
-->

# Sync Procedure: Keeping .agents Up to Date

**Sync Tracking**: Keep track of sync dates manually in the documentation file headers to ensure traceability.

This document outlines the standard procedure for keeping the `.agents` directory content synchronized with the latest updates from the 6 core Obsidian repositories:
- [Obsidian API](https://github.com/obsidianmd/obsidian-api) - Official API documentation and type definitions
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin) - Template plugin with best practices
- [Obsidian Developer Docs](https://github.com/obsidianmd/obsidian-developer-docs) - Source vault for docs.obsidian.md
- [Obsidian Plugin Docs](https://github.com/obsidianmd/obsidian-plugin-docs) - Plugin-specific documentation
- [Obsidian Sample Theme](https://github.com/obsidianmd/obsidian-sample-theme) - Theme template (for reference patterns)
- [ESLint Plugin](https://github.com/obsidianmd/eslint-plugin) - ESLint rules for Obsidian plugins

## Prerequisites

1. **Set up reference repositories** (see [ref-instructions.md](../../obsidian-ref/references/ref-instructions.md)):
   - The 6 core Obsidian projects should be available in `.ref/` (either as symlinks to a central location or as local clones):
     - `obsidian-api/` - API documentation
     - `obsidian-sample-plugin/` - Sample plugin template
     - `obsidian-developer-docs/` - Developer documentation
     - `obsidian-plugin-docs/` - Plugin-specific docs
     - `obsidian-sample-theme/` - Theme template
     - `eslint-plugin/` - ESLint rules
   - **Important**: If using symlinks (recommended), they typically point to a central location like `..\.ref\obsidian-dev` (one level up from project root) or `~/Development/.ref/obsidian-dev`

## Sync Workflow

**Before starting**: Get the current date for tracking (always use actual date, never placeholder):
```powershell
$syncDate = Get-Date -Format "yyyy-MM-dd"
Write-Host "Sync date: $syncDate"
```

### Step 1: Determine Your .ref Setup

**CRITICAL**: Before updating repos, you need to determine whether `.ref` contains symlinks or actual repos. Git operations must be performed on the **actual target location**, not on symlinks.

#### Check if .ref Contains Symlinks

**Windows (PowerShell)**:
```powershell
# Check if a specific repo is a symlink
$item = Get-Item .ref/obsidian-api
if ($item.LinkType -eq "Junction" -or $item.LinkType -eq "SymbolicLink") {
    Write-Host "Symlink detected - target: $($item.Target)"
    # Navigate to the actual target location
    cd $item.Target
} else {
    Write-Host "Regular directory - can use .ref/obsidian-api directly"
    cd .ref/obsidian-api
}
```

**macOS/Linux**:
```bash
# Check if a specific repo is a symlink
if [ -L .ref/obsidian-api ]; then
    # Portable approach for macOS/BSD and Linux
    if command -v realpath >/dev/null 2>&1; then
        TARGET=$(realpath .ref/obsidian-api)
    else
        TARGET=$(readlink .ref/obsidian-api)
    fi
    echo "Symlink detected - target: $TARGET"
    # Navigate to the actual target location
    cd "$TARGET"
else
    echo "Regular directory - can use .ref/obsidian-api directly"
    cd .ref/obsidian-api
fi
```

**Quick Check**: If `.ref` contains symlinks, they typically point to `..\.ref\obsidian-dev` (one level up from project root) or a central location like `~/Development/.ref/obsidian-dev` or `C:\Users\YourName\Development\.ref\obsidian-dev`.

### Step 2: Update Reference Repositories

Once you know your setup, update the repos:

#### Option A: If Using Symlinks to Central Location

**Windows (PowerShell)**:
```powershell
# First, check where symlinks point (usually ..\.ref\obsidian-dev)
$target = (Get-Item .ref/obsidian-api).Target
Write-Host "Symlinks point to: $target"

# Navigate to central location and update all repos
cd ..\.ref\obsidian-dev  # Adjust path if your central .ref is elsewhere
cd obsidian-api; git pull; cd ..
cd obsidian-sample-plugin; git pull; cd ..
cd obsidian-developer-docs; git pull; cd ..
cd obsidian-plugin-docs; git pull; cd ..
cd obsidian-sample-theme; git pull; cd ..
cd eslint-plugin; git pull; cd ..
```

**macOS/Linux**:
```bash
# First, check where symlinks point (usually ../.ref/obsidian-dev)
if command -v realpath >/dev/null 2>&1; then
    TARGET_REPO=$(realpath .ref/obsidian-api)
else
    TARGET_REPO=$(readlink .ref/obsidian-api)
fi
TARGET=$(echo "$TARGET_REPO" | sed 's|/obsidian-api$||')
echo "Symlinks point to: $TARGET"

# Navigate to central location and update all repos
cd "$TARGET"  # or cd ../.ref/obsidian-dev if that's your central location
cd obsidian-api && git pull && cd ..
cd obsidian-sample-plugin && git pull && cd ..
cd obsidian-developer-docs && git pull && cd ..
cd obsidian-plugin-docs && git pull && cd ..
cd obsidian-sample-theme && git pull && cd ..
cd eslint-plugin && git pull && cd ..
```

#### Option B: If Using Local Clones (No Symlinks)

If `.ref` contains actual repos (not symlinks), update from project root:

**Windows (PowerShell)**:
```powershell
# Always start from project root for each command
cd C:\path\to\your\obsidian-project
cd .ref/obsidian-api; git pull
cd C:\path\to\your\obsidian-project
cd .ref/obsidian-sample-plugin; git pull
cd C:\path\to\your\obsidian-project
cd .ref/obsidian-developer-docs; git pull
cd C:\path\to\your\obsidian-project
cd .ref/obsidian-plugin-docs; git pull
cd C:\path\to\your\obsidian-project
cd .ref/obsidian-sample-theme; git pull
cd C:\path\to\your\obsidian-project
cd .ref/eslint-plugin; git pull
```

**macOS/Linux**:
```bash
# Always start from project root for each command
cd .ref/obsidian-api && git pull && cd ../..
cd .ref/obsidian-sample-plugin && git pull && cd ../..
cd .ref/obsidian-developer-docs && git pull && cd ../..
cd .ref/obsidian-plugin-docs && git pull && cd ../..
cd .ref/obsidian-sample-theme && git pull && cd ../..
cd .ref/eslint-plugin && git pull && cd ../..
```

**Important**: When using local clones, always navigate back to project root between commands to avoid path accumulation errors.

### Step 3: Review Changes

Check what's changed in the reference repos. **Remember**: If using symlinks, navigate to the actual target location (usually `..\.ref\obsidian-dev`), not the symlink.

**Windows (PowerShell)** - If using symlinks:
```powershell
# Navigate to central location first
cd ..\.ref\obsidian-dev  # Adjust if your central .ref is elsewhere

# Check recent commits in obsidian-api
cd obsidian-api
git log --oneline -10
cd ..

# Check recent commits in obsidian-sample-plugin
cd obsidian-sample-plugin
git log --oneline -10
git diff HEAD~1 HEAD -- AGENTS.md  # Check if AGENTS.md changed
cd ..

# Check developer docs changes
cd obsidian-developer-docs
git log --oneline -10
cd ..

# Check plugin docs changes
cd obsidian-plugin-docs
git log --oneline -10
cd ..
```

**Windows (PowerShell)** - If using local clones:
```powershell
# Always start from project root for each command
cd C:\path\to\your\obsidian-project
cd .ref\obsidian-api
git log --oneline -10
cd C:\path\to\your\obsidian-project
cd .ref\obsidian-sample-plugin
git log --oneline -10
git diff HEAD~1 HEAD -- AGENTS.md
```

**macOS/Linux** - If using symlinks:
```bash
# Navigate to central location first
cd ../.ref/obsidian-dev  # or cd ~/Development/.ref/obsidian-dev

# Check recent commits
cd obsidian-api && git log --oneline -10 && cd ..
cd obsidian-sample-plugin && git log --oneline -10 && git diff HEAD~1 HEAD -- AGENTS.md && cd ..
cd obsidian-developer-docs && git log --oneline -10 && cd ..
cd obsidian-plugin-docs && git log --oneline -10 && cd ..
```

### Step 4: Identify Files to Update

Based on the changes, identify which `.agents` files need updates:

- **Sample Plugin changes** → Check these files:
  - `environment.md` - Build tooling, npm scripts
  - `file-conventions.md` - File structure recommendations
  - `common-tasks.md` - Code examples
  - `testing.md` - Installation procedures
  - `versioning-releases.md` - Release workflow
  - `coding-conventions.md` - TypeScript patterns

- **API changes** → Check these files:
  - `project-overview.md` - API usage patterns
  - `commands-settings.md` - Command API changes
  - `common-tasks.md` - API usage examples
  - `references.md` - API documentation links

- **Developer Docs changes** → Check:
  - `security-privacy.md` - Policy updates
  - `manifest.md` - Manifest requirements
  - `ux-copy.md` - Style guide updates
  - `commands-settings.md` - Command documentation
  - `testing.md` - Testing procedures
  - `versioning-releases.md` - Release guidelines
  - Review `en/` directory for new or updated documentation

- **Plugin Docs changes** → Check:
  - `project-overview.md` - Plugin architecture
  - `common-tasks.md` - Plugin-specific patterns
  - `troubleshooting.md` - Common plugin issues
  - Any plugin-specific best practices

- **Sample Theme changes** (optional reference):
  - `file-conventions.md` - File organization patterns
  - `versioning-releases.md` - Release workflow similarities

### Step 5: Update .agents Files

For each file that needs updating:

1. **Read the source material**:
   - Compare `.ref/obsidian-sample-plugin/AGENTS.md` with current `.agents` files
   - Review `.ref/obsidian-api/` for API documentation changes
   - Review `.ref/obsidian-developer-docs/en/` for official documentation updates
   - Check `.ref/obsidian-plugin-docs/` for plugin-specific guidance
   - Optionally reference `.ref/obsidian-sample-theme/` for organizational patterns

2. **Update the content**:
   - Copy relevant sections from source
   - Adapt to match the topic-based structure
   - Preserve any project-specific additions

3. **Update the sync status**:
   
   **Easy way** (recommended): Use the helper script:
   ```bash
   node scripts/update-sync-status.mjs "Description of what was synced"
   ```
   
   **Manual way**: Edit `.agent/sync-status.json` directly:
   ```powershell
   # Get the current date
   $syncDate = Get-Date -Format "yyyy-MM-dd"

   # Update the central sync-status.json file
   # Edit .agent/sync-status.json and update:
   # - "lastFullSync" to the current date
   # - "lastSyncSource" to describe what was synced
   # - Update relevant source repo dates in "sourceRepos"
   ```
   
   **Important**: Always use the actual current date from `Get-Date -Format "yyyy-MM-dd"`, never use placeholder dates.

4. **Note**: Individual file headers have "Last synced" dates. When syncing, update these dates to reflect the actual sync time.

### Step 6: Verify and Test

- Review updated files for accuracy
- Ensure links still work
- Check that code examples are still valid
- Verify formatting is consistent

## Quick Sync Checklist

- [ ] **Determine setup**: Check if `.ref` contains symlinks or actual repos
- [ ] **If symlinks**: Identify central location (usually `..\.ref\obsidian-dev` or `~/Development/.ref/obsidian-dev`)
- [ ] **If local clones**: Note that you must navigate from project root for each command
- [ ] Pull latest from `obsidian-api` repo (from actual target location, not symlink)
- [ ] Pull latest from `obsidian-sample-plugin` repo
- [ ] Pull latest from `obsidian-developer-docs` repo
- [ ] Pull latest from `obsidian-plugin-docs` repo
- [ ] Pull latest from `obsidian-sample-theme` repo
- [ ] Pull latest from `eslint-plugin` repo
- [ ] Review `AGENTS.md` in sample plugin for changes
- [ ] Review API documentation for breaking changes
- [ ] Review developer docs for policy/guideline updates
- [ ] Review plugin docs for best practices
- [ ] Update relevant `.agent/skills/**/*.md` files
- [ ] **Update sync dates** in file headers
- [ ] Review and commit changes

## Troubleshooting

### "Cannot find path" errors when running git commands

**Problem**: You're trying to run git commands on a symlink, or paths are accumulating incorrectly.

**Solution**:
1. Check if `.ref` contains symlinks: `Get-Item .ref/obsidian-api | Select-Object LinkType, Target` (Windows) or `ls -la .ref/obsidian-api` (Unix)
2. If symlinks, navigate to the **actual target location** (usually `..\.ref\obsidian-dev`) before running git commands
3. If local clones, always start from project root for each command

### "Already up to date" but you want to verify

**Solution**: Use `git fetch` first to check for updates without merging:
```bash
git fetch
git log HEAD..origin/main --oneline  # Shows what's new
```

### Verify Your Setup (Symlinks vs. Local Clones)

**Windows**:
```powershell
Get-Item .ref/obsidian-api | Select-Object LinkType, Target
# If LinkType shows "Junction" or "SymbolicLink", you're using symlinks
# If LinkType is empty/null, it's a regular directory
```

**macOS/Linux**:
```bash
ls -la .ref/obsidian-api
# If it shows "->" with a path, it's a symlink
# If it shows "d" (directory) without "->", it's a regular directory
```

## Frequency Recommendations

- **Monthly**: Review for major updates
- **After Obsidian releases**: Check for API changes
- **When starting new features**: Verify current best practices
- **Before releases**: Ensure guidelines are current



## Updating Sync Status

After completing a sync, update the "Last synced" dates in the documentation file headers.

**Manual way**: Edit the file directly:
```powershell
# Get actual current date (CRITICAL: never use placeholder!)
$syncDate = Get-Date -Format "yyyy-MM-dd"

# Update the file header with the actual sync date
```

**Critical**: Always use the actual date from `Get-Date -Format "yyyy-MM-dd"`. Never use placeholder dates like "YYYY-MM-DD" or hardcoded dates.

## Notes

- Not all changes need to be synced immediately - focus on breaking changes and new best practices
- Some content may be project-specific and shouldn't be overwritten
- Always review changes before committing to ensure they make sense for your project
- **Always update sync dates** to reflect when the information was last verified
