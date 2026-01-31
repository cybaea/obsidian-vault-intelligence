# 4.3.0 — The Agentic Update

The Research Assistant has evolved. It is no longer just a passive observer—it can now actively help you organise your vault, create notes, and update files, all while keeping you in complete control with rigorous security checks. We are also breaking down language barriers with native multilingual support and breaking down barriers to entry with a new "What's New" experience.

## New Features

### Agentic file modification

The Researcher is no longer read-only! It can now create notes, update existing files, and organise folders upon request. Try asking it to "Create a summary of this chat in a new note" or "Update the project tracker with these new tasks".

### Human-in-the-loop security

Safety is our top priority. All write operations trigger a "Trust but Verify" confirmation modal, showing you _exactly_ what the agent wants to change—including diffs for updates—before any data is touched. You are always in the driver's seat.

### Granular write control

You decide when the agent can act. We have added a global "Enable agent write access" setting (default: off) plus a per-chat toggle, giving you precise control over when the agent is allowed to modify your vault.

### Language support

The Research Assistant now speaks your language! You can choose from a list of presets or enter any custom IETF BCP 47 language code (eg `fr-FR`). The system prompts automatically adapt to your choice, ensuring fluent responses in your preferred language.

### Transient model switching

Need a smarter model for just one question? You can now use the new dropdown in the Research Chat header to temporarily switch models for specific queries without changing your global settings.

### "What's New" walkthrough

We have added a new walkthrough modal that automatically displays release notes after a plugin update. It features a "Fetch or Fallback" system that retrieves rich content directly from GitHub, ensuring you are always up to speed with the latest capabilities.

## Improvements & Fixes

- **Integrated documentation**: Added direct links to the official VitePress documentation across all settings sections.
- **On-the-fly toggles**: Quickly enable or disable the computational solver for the current session.
- **Stable foundations**: Updated all default model IDs to use the newest aliases (ie `gemini-flash-latest`).
- **UI stability**: Fixed a race condition where "Thinking" messages could duplicate; the indicator is now instant and stable.
- **Session reset**: A new reset button in the chat header lets you quickly revert all temporary session settings to your global defaults.
- **Responsive design**: The Research Chat controls now wrap gracefully, making the plugin much more usable in narrow sidebars.
- **Sponsor button**: Added a prominent way to support the project directly from the release notes.
