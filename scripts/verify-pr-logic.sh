#!/bin/bash

# Verification script for publish-pr logic
# This script is non-destructive and only prints what the workflow WOULD do.

echo "🔍 Starting PR Logic Verification (Safe Dry Run)..."

# 0. Prereqs
git remote prune origin > /dev/null 2>&1
CURRENT_BRANCH=$(git branch --show-current)
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || echo "main")

echo "------------------------------------------------"
echo "Current Branch: $CURRENT_BRANCH"
echo "Default Branch: $DEFAULT_BRANCH"
echo "------------------------------------------------"

# 1. Primary Guard
if [ "$CURRENT_BRANCH" = "$DEFAULT_BRANCH" ]; then
    echo "❌ GUARD: You are on the default branch ($DEFAULT_BRANCH)."
    echo "   The workflow WOULD STOP HERE for safety."
    echo "   (Simulation will continue for logic testing...)"
fi

# 2. Parent Selection Logic
# Priority:
# 1. Nearest local branch ahead of us (via show-branch)
# 2. Default branch (fallback)

# Try local-only show-branch first (cleaner)
PARENT_BRANCH=$(git show-branch 2>/dev/null | grep '\*' | grep -v "$CURRENT_BRANCH" | head -n1 | sed 's/.*\[\(.*\)\].*/\1/' | sed 's/[\^~].*//')

# If local check fails, try all branches (slower, noisier)
if [ -z "$PARENT_BRANCH" ] || ! git rev-parse --verify --quiet "$PARENT_BRANCH" > /dev/null; then
    PARENT_BRANCH=$(git show-branch -a 2>/dev/null | grep '\*' | grep -v "$CURRENT_BRANCH" | head -n1 | sed 's/.*\[\(.*\)\].*/\1/' | sed 's/[\^~].*//' | sed 's|origin/||')
fi

# Final Fallback to Default
if [ -z "$PARENT_BRANCH" ] || ! git rev-parse --verify --quiet "$PARENT_BRANCH" > /dev/null; then
    PARENT_BRANCH=$DEFAULT_BRANCH
    NOTE="(Final Fallback)"
fi

# Verify vs Current (Circular Check)
if [ "$PARENT_BRANCH" = "$CURRENT_BRANCH" ]; then
    PARENT_BRANCH=$DEFAULT_BRANCH
    NOTE="(Reset to Default to avoid circular ref)"
fi

echo "Selected Base:   $PARENT_BRANCH $NOTE"
echo "------------------------------------------------"

# 3. Decision Simulation
if [ "$CURRENT_BRANCH" = "$DEFAULT_BRANCH" ]; then
    echo "🏁 OUTCOME: Workflow WOULD EXIT (Safe Guard)."
elif [ "$CURRENT_BRANCH" = "$PARENT_BRANCH" ]; then
    echo "🏁 OUTCOME: Workflow WOULD EXIT (Circular Reference)."
else
    echo "✅ OUTCOME: Workflow WOULD PROCEED."
    echo ""
    echo "--- Planned Actions ---"
    echo "1. Create PR from [$CURRENT_BRANCH] into [$PARENT_BRANCH]"
    echo "2. After merge, checkout [$PARENT_BRANCH]"
    echo "3. Delete local branch [$CURRENT_BRANCH]"
fi

echo "------------------------------------------------"
echo "Verification Complete."
