# Language Support and Prompt Management

-   **Version**: 4.2.0
-   **Status**: Active

## Overview

As of v4.2.0, Vault Intelligence supports multilingual interactions and managed system prompts. This document details the implementation strategy for developers.

## Language Injection

Language support is implemented via a simple string injection strategy at the prompt level, rather than maintaining separate prompt files for each language.

### Mechanism

1.  **Setting**: `agentLanguage` (string). Defaults to "English (US)".
2.  **Placeholder**: The system prompt template contains a `{{LANGUAGE}}` token.
3.  **Runtime Replacement**:
    -   Inside `AgentService` and `GardenerService`, the `{{LANGUAGE}}` token is replaced with the user's selected language setting before being sent to the LLM.
    -   If `agentLanguage` is strictly "English (US)" (the default), the instruction `Language: Respond in {{LANGUAGE}}` is stripped entirely to save tokens and reduce prompt noise, as models default to English.

### "Other" Language Support

The UI provides a hybrid dropdown/text selection:

-   Common presets are available in a dropdown.
-   Selecting "Other" switches the internal storage to "custom" and reveals a text input.
-   Validates against standard string availability but does not enforce strict BCP 47 format to allow for creative prompts (eg "Pirate").

## Prompt Management

We have moved from "Static Default" settings to "Nullable Managed" settings to allow for easier updates.

### Fallback Logic

-   **Old behavior**: Settings were initialized with the full text of the default prompt. Users never received updates to the persona because their settings were "custom" from day one.
-   **New behavior**:

    -   `systemInstruction` defaults to `null`.
    -   If `null`, the plugin uses `DEFAULT_SYSTEM_PROMPT` (const) at runtime.
    -   This allows us to update `DEFAULT_SYSTEM_PROMPT` in the codebase and immediately improve the experience for all users who haven't explicitly customized it.

### Migration Strategy

On plugin load (`main.ts`), a migration runs:

1.  It compares the current saved `systemInstruction` with valid _historical_ default prompts.
2.  If it matches a known old default, it resets the setting to `null`.
3.  This seamlessly opt-in users to the new managed system without overwriting actual custom personas.

## Architectural Implications

-   **AgentService**: Now accepts `agentLanguage` in its constructor/config.
-   **UI Components**: `ResearchChatView` and settings tabs now abstract the "Other" logic.
