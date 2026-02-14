#!/bin/bash

# publish-pr.sh - Automate PR creation, verification, and merging.
# Usage: ./scripts/publish-pr.sh [--dry-run]

set -e

DRY_RUN=false
if [ "$1" == "--dry-run" ]; then
    DRY_RUN=true
    echo "🔍 Running in DRY RUN mode. No changes will be pushed or merged."
fi

# Cleanup trap to ensure we return to the original branch if interrupted
ORIGINAL_BRANCH=$(git branch --show-current)
cleanup() {
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
        echo "❌ Script failed or was interrupted. Returning to $ORIGINAL_BRANCH..."
        git checkout "$ORIGINAL_BRANCH" > /dev/null 2>&1
    fi
}
trap cleanup EXIT INT TERM

echo "🚀 Starting publish-pr workflow..."

# 0. Safety Guards
if ! git diff-index --quiet HEAD --; then
    echo "❌ Error: You have uncommitted changes. Please commit or stash them first."
    exit 1
fi

DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)
CURRENT_BRANCH=$(git branch --show-current)

if [ "$DEFAULT_BRANCH" = "$CURRENT_BRANCH" ]; then
    echo "❌ Error: You are on the default branch ($DEFAULT_BRANCH). Switch to a feature branch first."
    exit 1
fi

# 1. Push Branch
echo "📡 Pushing branch $CURRENT_BRANCH to origin..."
if [ "$DRY_RUN" = false ]; then
    git push -u origin HEAD
else
    echo "[DRY RUN] git push -u origin HEAD"
fi

# 2. Check for Existing PR
echo "🔍 Checking for existing pull request..."
if gh pr view --json url > /dev/null 2>&1; then
    echo "⚠️ PR already exists. Continuing with the existing PR..."
else
    echo "🆕 Creating new pull request into $DEFAULT_BRANCH..."
    if [ "$DRY_RUN" = false ]; then
        gh pr create --base "$DEFAULT_BRANCH" --fill
    else
        echo "[DRY RUN] gh pr create --base \"$DEFAULT_BRANCH\" --fill"
    fi
fi

# 3. Watch Checks
echo "⏳ Waiting for CI checks to pass..."
if [ "$DRY_RUN" = false ]; then
    gh pr checks --watch
else
    echo "[DRY RUN] gh pr checks --watch (Simulated success)"
fi

# 4. Merge
echo "🔀 Merging pull request..."
if [ "$DRY_RUN" = false ]; then
    gh pr merge --squash --delete-branch
else
    echo "[DRY RUN] gh pr merge --squash --delete-branch"
fi

# 5. Local Cleanup
echo "🧹 Cleaning up local branch..."
if [ "$DRY_RUN" = false ]; then
    git checkout "$DEFAULT_BRANCH"
    git pull origin "$DEFAULT_BRANCH"
    git branch -d "$CURRENT_BRANCH"
else
    echo "[DRY RUN] git checkout $DEFAULT_BRANCH"
    echo "[DRY RUN] git pull origin $DEFAULT_BRANCH"
    echo "[DRY RUN] git branch -d $CURRENT_BRANCH"
fi

echo "✅ Successfully published and merged $CURRENT_BRANCH into $DEFAULT_BRANCH!"
