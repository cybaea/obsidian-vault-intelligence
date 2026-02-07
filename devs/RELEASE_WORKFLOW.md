# Automated release workflow

This project uses a "Zero Memory" release workflow, automating version bumps, changelog generation (future), tagging, and GitHub Release creation.

## Overview

The process involves two key parts:

1.  **Local Preparation**: You run one command to prep, test, and push the release branch.
2.  **GitHub Automation**: Merging the PR triggers an auto-tagger, which recursively triggers the release build.

## Step-by-step guide

### 1. Preparation (local)

When you are ready to prepare a release (e.g., merging features into `main`), run:

```bash
npm run release:prep <patch|minor|major>
```

*Defaults to `patch` if no argument is provided._

**What this script does:**

1.  **Safety Checks**: Ensures your working directory is clean.
2.  **Sync**: Pulls the latest `main`.
3.  **Version Bump**:
    -   Runs `npm run lint` and `npm run build` (via `preversion`).
    -   Updates `package.json`, `manifest.json`, and `versions.json` (via `version` scripts).
    -   **Updates `CHANGELOG.md`**: Moves the `[Unreleased]` section to `[x.y.z]` and creates a new empty `[Unreleased]` section.
    -   **Does NOT** create a git tag locally (uses `--no-git-tag-version`).
4.  **Branch Creation**: Creates a branch named `release/x.y.z`.
5.  **Commit & Push**: Commits the version bump and pushes to GitHub.

### 2. Review and merge (GitHub)

The script provides a link to open a Pull Request.

1.  Open the PR.
2.  Review the changes (ensure version numbers is correct in all files, and `CHANGELOG.md` is updated).
3.  **Merge** the PR into `main`.

### 3. Automation (CI/CD)

Once merged:

1.  **Auto-Tag Workflow** (`auto-tag.yml`) wakes up.
    -   It detects the version change in `package.json`.
    -   It creates and pushes a git tag (e.g., `2.0.2`).
    -   **Crucial**: It uses a **PAT (Personal Access Token)**, not the default `GITHUB_TOKEN`.
2.  **Release Workflow** (`release.yml`) wakes up.
    -   Triggered by the new tag pushed by the PAT.
    -   Builds the plugin.
    -   Creates a draft GitHub Release with `main.js`, `manifest.json`, and `styles.css`.

## Troubleshooting

### "Working directory is not clean"

The script will abort if you have uncommitted changes. Please commit or stash them before running the release prep.

### The release action didn't run

If the tag was created but the Release Action didn't start:

-   Check `auto-tag.yml` logs. Did it use the default `GITHUB_TOKEN`? Pushes by the default token do **not** trigger downstream workflows.
-   Ensure the `PAT` secret is correctly configured in the repo settings.

### "Tag already exists"

If you merge a PR that doesn't bump the version (or if you re-run the job), the `auto-tag` workflow detects the existing tag and exits gracefully without error.
