# Developer guide: Documentation standards

## 1. Core Philosophy

Documentation is not a description of the software; it is a tool for the user. Every piece of content must exist to answer a specific user need at a specific moment in their journey.

We optimize for three key metrics:

    Time to Value (TTV): How fast can a new user get a reliable output? (Conversion)

    Task Success Rate: Can the user solve their specific problem without support? (Self-Service)

    Feature Depth: Does the user understand the underlying capabilities? (Retention)

## 2. The Four Quadrants (Structure)

All documentation pages must fall strictly into one of these four categories. Do not mix them.

### A. Tutorials (Learning-Oriented)

Goal: "I want to get started."

Format: A lesson. Step-by-step.

User State: The user is a beginner. They are anxious and lack context.

Rules:

    - No Choices: Do not offer configuration options. Pick the defaults that work.

    - Immediate Success: The tutorial must end with a tangible result (e.g., "You have successfully queried your vault").

    - Short: Max 10-15 minutes.

    - Example Title: "Your First Vault Intelligence Query."

### B. How-To Guides (Task-Oriented)

Goal: "I want to solve a specific problem."

Format: A recipe. A sequence of steps to achieve a goal.

User State: The user knows the basics but is stuck on a specific task.

Rules:

    - Context-Specific: Focus on one task (e.g., "How to exclude folders from indexing").

    - No Theory: Do not explain how the indexing algorithm works here. Just show how to exclude the folder.

    - Example Title: "How to customize the AI persona."

### C. Reference (Information-Oriented)

Goal: "I need to know what this setting does."

Format: A dictionary or map. Technical descriptions.

User State: The user is working and needs to verify a fact.

Rules:

    - Dry and Accurate: No "hello friends" intro. Just the facts.

    - Complete: Must list every command, every setting, every error code.

    - Machine-Readable Structure: Tables, lists, parameter types.

    - Example Title: "Configuration Options: config.json."

### D. Explanation (Understanding-Oriented)

Goal: "I want to understand how it works."

Format: An article or essay.

User State: The user is curious or needs to make architectural decisions.

Rules:

    - High Level: Discuss concepts (RAG, Vector Embeddings, Privacy).

    - No Code (mostly): Focus on diagrams and paragraphs.

    - Example Title: "Understanding how Vault Intelligence parses your notes."

## 3. The Onboarding Journey (The "Get Started" Fix)

The "Get Started" button must never lead to a README dump. It must lead to the Quick Start Tutorial.

The "5-Minute Magic" Rule: From the moment the user clicks "Get Started," they must reach a moment of "Magic" (a successful, impressive interaction with their own data) within 5 minutes.

The Onboarding Script:

    - Prerequisites: State clearly what is needed (e.g., "Obsidian v1.5+, API Key").

    - Installation: One-click method (BRAT or Community Plugins) first. Manual method second.

    - Zero-Config Launch: The plugin must work with default settings immediately.

    - The "Hello World" Action: Force the user to run one specific command to see the plugin work.

## 4. The Quality Assurance Checklist

Before publishing any document, run it through this checklist.

For the Editor:

    [ ] The Quadrant Check: Does this page know if it is a Tutorial, Guide, Reference, or Explanation? (If it tries to be two, split it.)

    [ ] The Skimmability Check: Can I understand the structure by reading only the headers?

    [ ] The Copy-Paste Check: Is every code block self-contained? (Can the user copy it and run it without adding previous blocks?)

    [ ] The "Result" Check: Does every step describe what the user should see next? (e.g., "You should see a green checkmark.")

For the AI Coding Agent:

    [ ] Context Window: Is the necessary context (imports, file paths) included in code snippets?

    [ ] Consistency: Do function names and UI labels match the actual code exactly?

    [ ] No Hallucination: Are we referencing features that actually exist in the current version?

    [ ] Document what screenshots we need to take and create an issues on GitHub to document them. (Remember: you have the `gh` command available to you.)

    [ ] Are we following our markdown standards (from `.agent/rules/Markdown.md`)?

## 5. Anti-Patterns (What to Avoid)

    The Wall of Text: No paragraph longer than 4 lines.

    The "Readme Dump": Never simply copy README.md to the documentation site. The Readme is for GitHub browsing; the Site is for User Success.

    Intermingled Configuration: Do not stop a "How-to" guide to explain every possible configuration parameter. Link to the Reference section instead.

    Assumed Knowledge: Never say "simply" or "obviously."

## 6. How to use this specification

**When writing for Conversion (Objective 1):**

Focus entirely on the Tutorial quadrant. New users do not care about architecture; they care about results. Your landing page should tease the result, and the first link they click should give them that result.

**When writing for Retention (Objective 2):**

Focus on How-To Guides and Explanation. Power users stay because they find new workflows and understand the system deeply. Write guides like "How to use Vault Intelligence for weekly reviews" and explanations like "How the Graph algorithm weights connections" to enable mastery.

**When writing for Self-Service (Objective 3):**

Focus on Reference and Error Handling. When a user gets an error, they will Google the error message. Your Reference docs must contain that error message and the solution.
