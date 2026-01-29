<!--
Source: Project-specific workflow
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Update as workflow evolves
-->

# Summarize Commands

When the user requests "Summarize" or "Summarize for release", use these workflows to generate commit messages or release notes.

## "Summarize" Command

**Purpose**: Generate a succinct git commit message based on all changed files.

**Workflow**:

1. **Get all changed files**:

   ```bash
   git status
   git diff --cached  # For staged changes
   git diff           # For unstaged changes
   ```

2. **Read and analyze all changed files**:
   - Look at the actual file contents, not just the chat history
   - Understand what changed across all files
   - Get the overall picture of the changes

3. **Generate commit message** in this format:

   ```
   [Summary of changes]
   - [more detailed item 1]
   - [more detailed item 2]
   - [more detailed item 3]
   ```

4. **Present as a code block** so the user can easily copy it:

   ````
   ```
   [Summary of changes]
   - [more detailed item 1]
   - [more detailed item 2]
   ```
   ````

**Important**:

- Look at actual file changes, not just chat context
- Be succinct but descriptive
- Focus on what changed, not how it was changed
- Use present tense (e.g., "Add feature" not "Added feature")
- Group related changes together

**Example**:

```
Reorganize agent instructions into structured directory
- Split AGENTS.md into topic-based files in .agents/
- Add build workflow documentation
- Update ref-instructions with symlink strategy
- Add summarize command workflows
```

## "Summarize for Release" Command

**Purpose**: Generate markdown-formatted release notes for a GitHub release.

**Workflow**:

1. **Check the version**:

   ```bash
   # Check manifest.json for version
   # Or check package.json
   # Or ask the user if version is unclear
   ```

2. **Get all changes since last release**:

   ```bash
   git log --oneline  # See recent commits
   git diff <last-release-tag>..HEAD  # See all changes
   ```

3. **Read and analyze all changed files**:
   - Look at actual file contents and changes
   - Understand the full scope of changes
   - Categorize changes by type (Features, Fixes, Improvements, etc.)

4. **Generate release notes** in markdown format:

   ```markdown
   ### Features
   - [Feature description 1]
   - [Feature description 2]

   ### Fixes
   - [Fix description 1]
   - [Fix description 2]

   ### Improvements
   - [Improvement description 1]
   ```

5. **Present as a code block** with the version clearly indicated:

   ````
   ```markdown
   ## Version X.Y.Z

   ### Features
   - [Feature description 1]
   - [Feature description 2]

   ### Fixes
   - [Fix description 1]

   ### Improvements
   - [Improvement description 1]
   ```
   ````

**Important**:

- Start with `###` headings (third-level markdown)
- Use bullet points under each heading
- Be succinct and punchy
- Focus on user-facing changes
- Group logically (Features, Fixes, Breaking Changes, Improvements, etc.)
- Include version number at the top
- Look at actual changes, not just chat history

**Example**:

```markdown
## Version 1.2.0

### Features
- Add structured .agents directory for better organization
- Implement symlink strategy for reference repositories
- Add build workflow automation

### Improvements
- Reorganize documentation into topic-based files
- Update ref-instructions with Windows symlink guide
- Add summarize command workflows

### Fixes
- Fix build command execution order
- Update documentation paths
```

## Tips for Better Summaries

- **Read the files**: Don't rely solely on chat history - actually read the changed files
- **Understand context**: Look at related files to understand the full picture
- **Be specific**: "Add build workflow" is better than "Update docs"
- **Group logically**: Related changes should be grouped together
- **User perspective**: Focus on what users/developers will notice
- **Version awareness**: For releases, always check and include the version number
