<!--
Source: Complete examples from obsidian-sample-plugin, obsidian-plugin-docs, and obsidian-api (API is authoritative)
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check reference repos for new patterns
-->

# Code Patterns

Comprehensive code patterns for common Obsidian plugin development tasks. **Always verify API details in `.ref/obsidian-api/obsidian.d.ts`** - it's the authoritative source and may have features not yet documented in plugin docs.

**When to use this vs [common-tasks.md](common-tasks.md)**:

- **code-patterns.md**: Complete, production-ready examples with full context, error handling, and best practices
- **common-tasks.md**: Quick snippets and basic patterns for simple operations

## Complete Settings Tab

**Source**: Based on `.ref/obsidian-sample-plugin/main.ts`, `.ref/obsidian-plugin-docs/docs/guides/settings.md`, and `.ref/obsidian-api/obsidian.d.ts`

**Note**: `SettingGroup` is available in the API since 1.11.0 but may not be documented in plugin docs yet. Always check the API first.

```ts
import { App, PluginSettingTab, Setting } from "obsidian";

interface MyPluginSettings {
  textSetting: string;
  toggleSetting: boolean;
  dropdownSetting: string;
  sliderValue: number;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  textSetting: "default",
  toggleSetting: true,
  dropdownSetting: "option1",
  sliderValue: 50,
};

class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Text input
    new Setting(containerEl)
      .setName("Text setting")
      .setDesc("Description of text setting")
      .addText((text) =>
        text
          .setPlaceholder("Enter text")
          .setValue(this.plugin.settings.textSetting)
          .onChange(async (value) => {
            this.plugin.settings.textSetting = value;
            await this.plugin.saveSettings();
          })
      );

    // Toggle
    new Setting(containerEl)
      .setName("Toggle setting")
      .setDesc("Enable or disable feature")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.toggleSetting)
          .onChange(async (value) => {
            this.plugin.settings.toggleSetting = value;
            await this.plugin.saveSettings();
            this.display(); // Re-render if toggle affects other settings
          })
      );

    // Dropdown
    new Setting(containerEl)
      .setName("Dropdown setting")
      .setDesc("Select an option")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("option1", "Option 1")
          .addOption("option2", "Option 2")
          .addOption("option3", "Option 3")
          .setValue(this.plugin.settings.dropdownSetting)
          .onChange(async (value) => {
            this.plugin.settings.dropdownSetting = value;
            await this.plugin.saveSettings();
          })
      );

    // Slider
    new Setting(containerEl)
      .setName("Slider setting")
      .setDesc(`Value: ${this.plugin.settings.sliderValue}`)
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 1)
          .setValue(this.plugin.settings.sliderValue)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.sliderValue = value;
            await this.plugin.saveSettings();
            this.display(); // Update description
          })
      );

    // Setting with extra button
    new Setting(containerEl)
      .setName("Setting with reset")
      .addText((text) =>
        text.setValue(this.plugin.settings.textSetting)
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("reset")
          .setTooltip("Reset to default")
          .onClick(async () => {
            this.plugin.settings.textSetting = DEFAULT_SETTINGS.textSetting;
            await this.plugin.saveSettings();
            this.display();
          })
      );
  }
}

// In main plugin class:
this.addSettingTab(new MySettingTab(this.app, this));
```

## Settings with Groups (Conditional / Backward Compatible)

**Source**: Based on `.ref/obsidian-api/obsidian.d.ts` (API is authoritative) - `SettingGroup` requires API 1.11.0+

**Use this when**: You want to use `SettingGroup` for users on Obsidian 1.11.0+ while still supporting older versions. This provides conditional settings groups that automatically use the modern API when available, with a fallback for older versions.

**Note**: Use the backward compatibility approach below to support both users on Obsidian 1.11.0+ and users on older versions. Alternatively, you can choose to:

- Continue using the compatibility utility (supports all versions)
- Force `minAppVersion: "1.11.0"` in `manifest.json` and use `SettingGroup` directly (simpler, but excludes older versions)

### Step 1: Create the Compatibility Utility

Create `src/utils/settings-compat.ts` (or wherever you keep utilities):

```ts
/**
 * Compatibility utilities for settings
 * Provides backward compatibility for SettingGroup (requires API 1.11.0+)
 */
import { Setting, requireApiVersion } from 'obsidian';

/**
 * Type definition for SettingGroup constructor
 * Note: SettingGroup may exist at runtime in 1.11.0+ but may not be in TypeScript definitions
 * 
 * IMPORTANT: This type signature is inferred from usage patterns. When .ref/obsidian-api/obsidian.d.ts
 * is available, verify the actual signature there. The signature shown here matches the expected
 * behavior based on Obsidian's API design patterns.
 */
type SettingGroupConstructor = new (containerEl: HTMLElement) => {
  setHeading(heading: string): {
    addSetting(cb: (setting: Setting) => void): void;
  };
};

/**
 * Interface that works with both SettingGroup and fallback container
 */
export interface SettingsContainer {
  addSetting(cb: (setting: Setting) => void): void;
}

/**
 * Creates a settings container that uses SettingGroup if available (API 1.11.0+),
 * otherwise falls back to creating a heading and using the container directly.
 * 
 * Uses requireApiVersion('1.11.0') to check if SettingGroup is available.
 * This is the official Obsidian API method for version checking.
 * 
 * IMPORTANT: We use dynamic require() instead of direct import because SettingGroup
 * may not be in TypeScript type definitions even if it exists at runtime in 1.11.0+.
 * This avoids compile-time TypeScript errors while still working at runtime.
 * 
 * @param containerEl - The container element for settings
 * @param heading - The heading text for the settings group (optional)
 * @param manifestId - The plugin's manifest ID for CSS scoping (required for fallback mode)
 * @returns A container that can be used to add settings
 */
export function createSettingsGroup(
  containerEl: HTMLElement,
  heading?: string,
  manifestId?: string
): SettingsContainer {
  // Check if SettingGroup is available (API 1.11.0+)
  // requireApiVersion is the official Obsidian API method for version checking
  if (requireApiVersion('1.11.0')) {
    // Use dynamic require() to access SettingGroup at runtime
    // This avoids TypeScript errors when SettingGroup isn't in type definitions
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const obsidian = require('obsidian');
    const SettingGroup = obsidian.SettingGroup as SettingGroupConstructor;
    
    // Use SettingGroup - it's guaranteed to exist if requireApiVersion returns true
    const group = heading 
      ? new SettingGroup(containerEl).setHeading(heading)
      : new SettingGroup(containerEl);
    return {
      addSetting(cb: (setting: Setting) => void) {
        group.addSetting(cb);
      }
    };
  } else {
    // Fallback path (either API < 1.11.0 or SettingGroup not found)
    // Add scoping class to containerEl to scope CSS to only this plugin's settings
    if (manifestId) {
      containerEl.addClass(`${manifestId}-settings-compat`);
    }
    
    // Fallback: Create a heading manually and use container directly
    if (heading) {
      const headingEl = containerEl.createDiv('setting-group-heading');
      headingEl.createEl('h3', { text: heading });
    }
        
    return {
      addSetting(cb: (setting: Setting) => void) {
        const setting = new Setting(containerEl);
        cb(setting);
      }
    };
  }
}
```

**Note**: The dynamic `require()` approach is necessary because `SettingGroup` may not be in TypeScript type definitions even if it exists at runtime in Obsidian 1.11.0+. This avoids compile-time TypeScript errors while maintaining runtime compatibility.

### Step 2: Use in Settings Tab

Update your settings tab to use the compatibility utility:

```ts
import { App, PluginSettingTab, Setting } from "obsidian";
import { createSettingsGroup } from "./utils/settings-compat";

interface MyPluginSettings {
  generalEnabled: boolean;
  generalTimeout: number;
  advancedDebug: boolean;
  advancedLogLevel: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
  generalEnabled: true,
  generalTimeout: 5000,
  advancedDebug: false,
  advancedLogLevel: "info",
};

class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // General Settings Group
    const generalGroup = createSettingsGroup(containerEl, "General Settings", "my-plugin");
    
    generalGroup.addSetting((setting) => {
      setting
        .setName("Enable feature")
        .setDesc("Enable or disable the main feature")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.generalEnabled)
            .onChange(async (value) => {
              this.plugin.settings.generalEnabled = value;
              await this.plugin.saveSettings();
            });
        });
    });

    generalGroup.addSetting((setting) => {
      setting
        .setName("Timeout")
        .setDesc("Timeout in milliseconds")
        .addSlider((slider) => {
          slider
            .setLimits(1000, 10000, 500)
            .setValue(this.plugin.settings.generalTimeout)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.generalTimeout = value;
              await this.plugin.saveSettings();
            });
        });
    });

    // Advanced Settings Group
    const advancedGroup = createSettingsGroup(containerEl, "Advanced Settings", "my-plugin");
    
    advancedGroup.addSetting((setting) => {
      setting
        .setName("Debug mode")
        .setDesc("Enable debug logging")
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.advancedDebug)
            .onChange(async (value) => {
              this.plugin.settings.advancedDebug = value;
              await this.plugin.saveSettings();
            });
        });
    });

    advancedGroup.addSetting((setting) => {
      setting
        .setName("Log level")
        .setDesc("Set the logging level")
        .addDropdown((dropdown) => {
          dropdown
            .addOption("info", "Info")
            .addOption("warn", "Warning")
            .addOption("error", "Error")
            .setValue(this.plugin.settings.advancedLogLevel)
            .onChange(async (value) => {
              this.plugin.settings.advancedLogLevel = value;
              await this.plugin.saveSettings();
            });
        });
    });
  }
}

// In main plugin class:
this.addSettingTab(new MySettingTab(this.app, this));
```

### Step 3: Add CSS Styling (Required for Older Obsidian Builds)

**Important**: When using the compatibility utility for older Obsidian builds (< 1.11.0), you must add CSS to prevent double divider lines. The fallback creates a heading with class `setting-group-heading`, and without proper CSS, you'll see a double divider (one from the heading's border-bottom and one from the first setting-item's border-top).

**CRITICAL**: The CSS **MUST** be scoped to your plugin's settings container using a manifest-ID-based class to avoid affecting other plugins' settings. Global CSS selectors will impact all settings in Obsidian, not just your plugin's settings.

Add this CSS to your `styles.css` file, replacing `{manifest-id}` with your plugin's manifest ID:

```css
/* Group settings compatibility styling for older Obsidian builds (< 1.11.0) */
/* Scoped to only this plugin's settings container to avoid affecting other plugins */
.{manifest-id}-settings-compat .setting-group-heading h3 {
    margin: 0 0 0.75rem;
    padding-bottom: 0.5rem;
    padding-top: 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    border-bottom: none !important;
}
```

**Example**: If your manifest ID is `sample-plugin`, use `.sample-plugin-settings-compat` as the scoping class.

**How it works**:

- The CSS uses the `:has()` selector to detect if a `.setting-item` immediately follows the heading
- If settings exist below the heading, no border-bottom is applied (avoiding double divider)
- If no settings follow, border-bottom is applied for visual separation
- The scoping class (`{manifest-id}-settings-compat`) ensures CSS only affects headings within this plugin's settings container
- This only affects older builds (< 1.11.0) where the compatibility fallback is used
- On Obsidian 1.11.0+, `SettingGroup` handles styling automatically, so this CSS has no effect

**Note**: The `:has()` selector is well-supported in modern Obsidian (Chromium-based). If you need to support very old browsers, see the alternative TypeScript-based approach in the Common Pitfalls section below.

### How It Works

- **On Obsidian 1.11.0+**: Uses `SettingGroup` with proper styling and grouping
- **On older versions**: Creates a manual heading (`<h3>`) and uses regular `Setting` objects
- **Same API**: Your code using `addSetting()` works identically in both cases

### Common Pitfalls

#### Pitfall 1: TypeScript Errors with SettingGroup Import

**Problem**: You may see this TypeScript error:

```ts
Module '"obsidian"' has no exported member 'SettingGroup'
```

**Cause**: `SettingGroup` may exist at runtime in Obsidian 1.11.0+ but may not be in the TypeScript type definitions, causing compile-time errors.

**Solution**: Use dynamic `require()` instead of direct import, as shown in the compatibility utility above. Do not import `SettingGroup` directly:

```ts
// ❌ WRONG - Causes TypeScript errors
import { SettingGroup } from 'obsidian';

// ✅ CORRECT - Use dynamic require()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const obsidian = require('obsidian');
const SettingGroup = obsidian.SettingGroup as SettingGroupConstructor;
```

#### Pitfall 2: Missing Closing Parentheses

**Problem**: Arrow functions with method chaining need proper closing parentheses and semicolons.

**Solution**: Always include the closing parenthesis and semicolon:

```ts
// ❌ WRONG - Missing closing parenthesis
generalGroup.addSetting((setting) =>
  setting
    .setName("Enable feature")
    .addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.enabled)
    )
// Missing closing parenthesis here!

// ✅ CORRECT - Proper closing
generalGroup.addSetting((setting) =>
  setting
    .setName("Enable feature")
    .addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.enabled)
    )
); // Closing parenthesis and semicolon required
```

#### Pitfall 3: Storing Setting References

**Problem**: If you need to reference a `Setting` object later (e.g., for visibility toggling), you must use block syntax `{ }` instead of expression syntax.

**Solution**: Use block syntax when you need to store references:

```ts
// ❌ WRONG - Can't store reference with expression syntax
let mySetting: Setting;
generalGroup.addSetting((setting) =>
  setting.setName("My Setting")
  // Can't assign: mySetting = setting; (syntax error)
);

// ✅ CORRECT - Use block syntax to store reference
let mySetting: Setting;
generalGroup.addSetting((setting) => {
  mySetting = setting; // Now we can store the reference
  setting
    .setName("My Setting")
    .addToggle((toggle) =>
      toggle.setValue(this.plugin.settings.enabled)
    );
});

// Later, you can use mySetting to toggle visibility:
mySetting.settingEl.style.display = this.plugin.settings.enabled ? "" : "none";
```

### Alternative: Force Minimum Version

If you don't need to support versions before 1.11.0, you can skip the compatibility utility:

1. Set `minAppVersion: "1.11.0"` in your `manifest.json`
2. Use `SettingGroup` directly:

```ts
import { Setting, SettingGroup } from "obsidian";

// In settings tab:
const group = new SettingGroup(containerEl).setHeading("My Settings");
group.addSetting((setting) => {
  // ... configure setting
});
```

**Note**: Even with `minAppVersion: "1.11.0"`, you may still encounter TypeScript errors if `SettingGroup` isn't in the type definitions. In that case, you can still use the compatibility utility approach (it will always use `SettingGroup` when `requireApiVersion('1.11.0')` returns true), or use dynamic `require()` as shown in the compatibility utility.

This approach is simpler but excludes users on older Obsidian versions. The compatibility utility still works and is recommended for maximum flexibility.

## Modal with Form Input

**Source**: Based on `.ref/obsidian-plugin-docs/docs/guides/modals.md`

```ts
import { App, Modal, Notice, Setting } from "obsidian";

interface FormData {
  name: string;
  email: string;
}

class FormModal extends Modal {
  result: FormData;
  onSubmit: (result: FormData) => void;

  constructor(app: App, onSubmit: (result: FormData) => void) {
    super(app);
    this.onSubmit = onSubmit;
    this.result = { name: "", email: "" };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Enter Information" });

    new Setting(contentEl)
      .setName("Name")
      .addText((text) =>
        text.onChange((value) => {
          this.result.name = value;
        })
      );

    new Setting(contentEl)
      .setName("Email")
      .addText((text) =>
        text
          .setPlaceholder("email@example.com")
          .onChange((value) => {
            this.result.email = value;
          })
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Submit")
          .setCta()
          .onClick(() => {
            if (!this.result.name || !this.result.email) {
              new Notice("Please fill in all fields");
              return;
            }
            this.close();
            this.onSubmit(this.result);
          })
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// Usage:
new FormModal(this.app, (result) => {
  new Notice(`Submitted: ${result.name} (${result.email})`);
}).open();
```

## SuggestModal Implementation

**Source**: Based on `.ref/obsidian-plugin-docs/docs/guides/modals.md`

```ts
import { App, Notice, SuggestModal } from "obsidian";

interface Item {
  title: string;
  description: string;
}

const ALL_ITEMS: Item[] = [
  { title: "Item 1", description: "Description 1" },
  { title: "Item 2", description: "Description 2" },
];

class ItemSuggestModal extends SuggestModal<Item> {
  onChoose: (item: Item) => void;

  constructor(app: App, onChoose: (item: Item) => void) {
    super(app);
    this.onChoose = onChoose;
  }

  getSuggestions(query: string): Item[] {
    return ALL_ITEMS.filter((item) =>
      item.title.toLowerCase().includes(query.toLowerCase())
    );
  }

  renderSuggestion(item: Item, el: HTMLElement) {
    el.createEl("div", { text: item.title });
    el.createEl("small", { text: item.description });
  }

  onChooseSuggestion(item: Item, evt: MouseEvent | KeyboardEvent) {
    this.onChoose(item);
  }
}

// Usage:
new ItemSuggestModal(this.app, (item) => {
  new Notice(`Selected: ${item.title}`);
}).open();
```

## Custom View with Registration

**Source**: Based on `.ref/obsidian-plugin-docs/docs/guides/custom-views.md`

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_MY_VIEW = "my-view";

export class MyView extends ItemView {
  private content: string;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.content = "Initial content";
  }

  getViewType(): string {
    return VIEW_TYPE_MY_VIEW;
  }

  getDisplayText(): string {
    return "My Custom View";
  }

  getIcon(): string {
    return "document"; // Icon name
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    
    container.createEl("h2", { text: "My View" });
    
    const contentEl = container.createEl("div", { cls: "my-view-content" });
    contentEl.setText(this.content);
    
    // Add interactive elements
    const button = container.createEl("button", { text: "Update" });
    button.addEventListener("click", () => {
      this.updateContent();
    });
  }

  async onClose() {
    // Clean up resources
  }

  private updateContent() {
    const container = this.containerEl.children[1];
    const contentEl = container.querySelector(".my-view-content");
    if (contentEl) {
      this.content = "Updated content";
      contentEl.setText(this.content);
    }
  }
}

// In main plugin class:
export default class MyPlugin extends Plugin {
  async onload() {
    // Register view
    this.registerView(VIEW_TYPE_MY_VIEW, (leaf) => new MyView(leaf));

    // Add command to open view
    this.addCommand({
      id: "open-my-view",
      name: "Open My View",
      callback: () => {
        this.activateView();
      },
    });
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(VIEW_TYPE_MY_VIEW)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_MY_VIEW, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MY_VIEW);
  }
}
```

## File Operations

**Source**: Based on `.ref/obsidian-api/obsidian.d.ts` (API is authoritative)

```ts
// Read a file
async readFile(file: TFile): Promise<string> {
  return await this.app.vault.read(file);
}

// Write to a file
async writeFile(file: TFile, content: string): Promise<void> {
  await this.app.vault.modify(file, content);
}

// Create a new file
async createFile(path: string, content: string): Promise<TFile> {
  return await this.app.vault.create(path, content);
}

// Delete a file (respects user's trash preference)
async deleteFile(file: TFile): Promise<void> {
  await this.app.fileManager.trashFile(file);
}

// Check if file exists
fileExists(path: string): boolean {
  return this.app.vault.getAbstractFileByPath(path) !== null;
}

// Get all markdown files
getAllMarkdownFiles(): TFile[] {
  return this.app.vault.getMarkdownFiles();
}
```

## Workspace Events

**Source**: Based on `.ref/obsidian-api/obsidian.d.ts` and `.ref/obsidian-sample-plugin/main.ts`

```ts
// File opened event
this.registerEvent(
  this.app.workspace.on("file-open", (file) => {
    if (file) {
      console.log("File opened:", file.path);
    }
  })
);

// Active leaf changed
this.registerEvent(
  this.app.workspace.on("active-leaf-change", (leaf) => {
    if (leaf?.view instanceof MarkdownView) {
      console.log("Active markdown view:", leaf.view.file?.path);
    }
  })
);

// Layout changed
this.registerEvent(
  this.app.workspace.on("layout-change", () => {
    console.log("Workspace layout changed");
  })
);

// Editor change (in markdown view)
this.registerEvent(
  this.app.workspace.on("editor-change", (editor, info) => {
    console.log("Editor changed:", info);
  })
);
```

## Status Bar with Updates

**Source**: Based on `.ref/obsidian-sample-plugin/main.ts` and `.ref/obsidian-plugin-docs/docs/guides/status-bar.md`

```ts
export default class MyPlugin extends Plugin {
  private statusBarItem: HTMLElement;

  async onload() {
    // Create status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar("Ready");

    // Update status bar periodically
    this.registerInterval(
      window.setInterval(() => {
        this.updateStatusBar(`Time: ${new Date().toLocaleTimeString()}`);
      }, 1000)
    );

    // Update on file open
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (file) {
          this.updateStatusBar(`Open: ${file.name}`);
        }
      })
    );
  }

  private updateStatusBar(text: string) {
    this.statusBarItem.empty();
    this.statusBarItem.createEl("span", { text });
  }
}
```

## Editor Interactions

**Source**: Based on `.ref/obsidian-sample-plugin/main.ts` and `.ref/obsidian-api/obsidian.d.ts`

```ts
// Get active editor
getActiveEditor(): Editor | null {
  const view = this.app.workspace.getActiveViewOfType(MarkdownView);
  return view?.editor ?? null;
}

// Get selected text
getSelection(): string {
  const editor = this.getActiveEditor();
  return editor?.getSelection() ?? "";
}

// Replace selection
replaceSelection(text: string) {
  const editor = this.getActiveEditor();
  if (editor) {
    editor.replaceSelection(text);
  }
}

// Insert at cursor
insertAtCursor(text: string) {
  const editor = this.getActiveEditor();
  if (editor) {
    const cursor = editor.getCursor();
    editor.replaceRange(text, cursor);
  }
}

// Get current line
getCurrentLine(): string {
  const editor = this.getActiveEditor();
  if (editor) {
    const line = editor.getCursor().line;
    return editor.getLine(line);
  }
  return "";
}
```
