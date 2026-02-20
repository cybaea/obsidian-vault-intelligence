---
description: Prepare the release notes and announcements
---

**Role**: Product Lead & Developer Advocate (Vault Intelligence)

**Context**: 

We are releasing a new version of Vault Intelligence.

**Important*(*: The `npm run release:prep` command has run, so `package.json` and `CHANGELOG.md` are up to date.

**Your Mission**:
 
Translate technical changes into compelling narratives. You are not just listing features; you are explaining *why* this update improves the user's life. 
Tone of voice: That of the developer sharing his project; avoid corporate speak and excessive superlatives.

**Global Constraints**:

1.  **NO EXECUTION**: Do not run git. Draft text files ONLY.
2.  **SOURCE TRUTH**: Base all claims strictly on `CHANGELOG.md`.

---

### Phase 1: Reasoning Strategy

*Before generating any files, analyze the `CHANGELOG.md`.*

1. **Identify the Pillars**: What are the 1-3 headline features? (e.g., "Agentic Writing" AND "Multilingual Support").
2. **The "Soul"**: How do these pillars connect? (e.g., "This release is about *autonomy* and *accessibility*").
3. **Categorize**: Separate the "Headline" features from the "Quality of Life" improvements.

---

### 📄 Task 1: GitHub Release Notes

**File**: `releases/release-{VERSION}.md`
**Audience**: Existing users. They want to know what they can do *now* that they couldn't do *yesterday*.

**Guidelines**:

* **Header**: `# {VERSION} — {Thematic Title}`
    * *Create a title that captures the Pillars. Compound titles are fine (e.g., "The Agentic & Polyglot Update").*
* **The Narrative**: Start with a paragraph that weaves the **Pillars** into a coherent story. Why do they belong in the same update?
* **Feature Deep Dives**:
    * Use headers for each Pillar feature.
    * Focus on *utility*. Don't say "Added X"; say "You can now do X, which lets you Y."
* **The Polish**: Group smaller fixes/improvements at the end.

---

### Task 2: Discord Announcement

**File**: `releases/announcement-{VERSION}.md`
**Channel**: Obsidian Community `#updates`
**Goal**: **Conversion**. Convince a scroller to stop, read, and click "Install".

**Guidelines**:

* **Header**: `# Vault Intelligence {VERSION}`
* **The Pitch**: One sentence that defines the plugin for a total stranger.
* **The Hook**: "This update brings..." (Summarize the Pillars)
* **The Highlights**: 3-4 bullet points covering the Pillars + 1 top "Delight" feature.
* **Call to Action**: "Install via BRAT: [Link]"

---

### Task 3: Mastodon Thread

**File**: `releases/mastodon-{VERSION}.md`
**Goal**: **Storytelling**. Share the "Developer's Journey" behind the update.

**Guidelines**:

* **Format**: 3-6 posts separated by `---`. Max 450 chars/post.
* **Tone**: Authentic, transparent, "Quiet Confidence". Avoid marketing hype words ("game-changer", "unleashed").

**Structure**:

**Post 1: The Context**
-   **Requirement**: First sentence MUST define what the plugin is (e.g., "Vault Intelligence brings AI to #Obsidian").
-   **The Hook**: Then transition to the frustration that motivated this update, linking it to the solution (pain-reliever or gain-creator) and the "Soul" of this release.
-   *Mandatory*: Link to repo. Include `@obsidian@mas.to`, and hashtags `#Obsidian #PKM` if not already used in main text.

1.  **Post 1 (The Friction)**: Start with the problem or frustration that motivated this update. Then summarise the soal of this release in that context.
    * Include at least some background to Vault Intelligence as context for readers who are not yet users.
    * *Mandatory*: Link to repo, `@obsidian@mas.to`, `#Obsidian #PKM`.
2.  **Posts 2-4 (The Pillars)**: Dedicate one post to each "Pillar" feature.
    * Explain the solution or the capability. Focus on the value to the user. If there is genuine technical innovation in how we've implemented it you MAY mention that.
    * *If risky* (e.g. write access): Explain safety guards.
    * *If complex*: Use a concrete example.
3.  **Post X (The Polish)**: Briefly mention the "Delight" features (speed, UI).
4.  **Final Post**: 
    - Gratitude: Pick ONE of {sponsors, users, testers, people who raised bug reports, people who submitted feature requests, people who starred our GitHub repository} and express gratitude. Keep it brief.
    - **Mandatory**: CTA to install via BRAT.
    - Optional: up to five additional hashtags if relevant. Zero is fine.

---

**Action**: 
1. Read `package.json` for the version.
2. Read `CHANGELOG.md`.
3. Apply your reasoning to find the Pillars.
4. Generate the three files.
5. Link the GitHub release notes in our VitePress documentation.