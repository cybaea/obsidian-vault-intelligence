---
description: Prepare the release notes and announcements
---

**Role**: Product Marketing Manager (Vault Intelligence)

**Current Context**: We are preparing to release a new version of Vault Intelligence.
-   The `npm run release:prep` command has already run.
-   The `package.json` file contains the target version number.
-   The `CHANGELOG.md` file has been updated; the features for this release are listed under the header matching that version number (e.g., ## [4.3.0]).

**Your Goal**: Generate the official release marketing copy based strictly on the changes listed for the current version in CHANGELOG.md. Use the git history only if you need to understand how a feature works to describe it better.

**Safety Guardrails**:

-   NO EXECUTION: Do not run git commands that modify the repo (tag, push). Do not release.
-   SOURCE TRUTH: Use CHANGELOG.md as the primary list of features.
-   SCOPE: Only include changes for the current target version. Do not re-announce features from older versions.

----

# Task 1: GitHub Release Notes

Create a file for these notes with a path of the form: `releases/release-{VERSION}.md` 

**Target Audience**: Existing users updating the plugin. 
**Style**: Professional, exciting, clear.

Structure:

1.  First line is a markdown header: # {VERSION} - {Catchy Name}
    -   _Invent a name based on the biggest feature (e.g., "The Polyglot Update" for language support)._

2.  Intro: A 2-sentence summary of the update's theme.

3.  **New Features**:
    -   List user-facing features from the Changelog.
    -   Use bold headers and 1-2 sentences explaining the benefit.

4.  **Improvements & Fixes:**
    -   Group UI polish and bug fixes here.

5.   Exclusions:
    -   DO NOT include an "Under the Hood" or "Developer" section. Users don't need to know about refactoring or constants.

----

# Task 2: Discord Announcement

Create a file for these notes with a path of the form: `releases/announcement-{VERSION}.md` 

**Target Channel**: Obsidian community `#updates` channel on Discord.
**Target Audience**: People who may not use the plugin yet. 
**Goal**: Drive clicks and installs. Sell the value proposition.

Structure:

1.  Header: `# Vault Intelligence {VERSION}`

2.  The "Elevator Pitch" (Context):
    -   _Crucial Step_: Write 1 sentence explaining what this plugin _is_ for someone who has never heard of it.

3.  The Hook: "This update brings..." (Mention the #1 biggest feature / selling point).

4.  Highlights:
    -   Bullet points with **key features** only. Keep it short.

5.  Call to Action:
    1.  Install with BRAT from https://github.com/cybaea/obsidian-vault-intelligence


----

Action: Read `package.json` to find the version. Read `CHANGELOG.md` for that version's entry (it should be the latest other than 'Unreleased'). Generate the two files now.
