<!--
Source: Based on Obsidian Sample Plugin
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian Sample Plugin repo for updates
-->

# Common tasks

**Note**: The examples below are for plugin development (TypeScript).

**When to use this vs [code-patterns.md](code-patterns.md)**: 
- **common-tasks.md**: Quick snippets and basic patterns for common operations
- **code-patterns.md**: Complete, production-ready examples with full context and error handling

> **Note**: If user asks "what does the Obsidian API say about X?" or similar, check `.ref/obsidian-api/obsidian.d.ts` first. See [ref-instructions.md](ref-instructions.md) for when to check `.ref` setup.

## Organize code across multiple files

**main.ts** (minimal, lifecycle only):
```ts
import { Plugin } from "obsidian";
import { MySettings, DEFAULT_SETTINGS } from "./settings";
import { registerCommands } from "./commands";

export default class MyPlugin extends Plugin {
  settings: MySettings;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    registerCommands(this);
  }
}
```

**settings.ts**:
```ts
export interface MySettings {
  enabled: boolean;
  apiKey: string;
}

export const DEFAULT_SETTINGS: MySettings = {
  enabled: true,
  apiKey: "",
};
```

**commands/index.ts**:
```ts
import { Plugin } from "obsidian";
import { doSomething } from "./my-command";

export function registerCommands(plugin: Plugin) {
  plugin.addCommand({
    id: "do-something",
    name: "Do something",
    callback: () => doSomething(plugin),
  });
}
```

## Add a command

```ts
this.addCommand({
  id: "your-command-id",
  name: "Do the thing",
  callback: () => this.doTheThing(),
});
```

## Persist settings

```ts
interface MySettings { enabled: boolean }
const DEFAULT_SETTINGS: MySettings = { enabled: true };

async onload() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  await this.saveData(this.settings);
}
```

## Register listeners safely

```ts
this.registerEvent(this.app.workspace.on("file-open", f => { /* ... */ }));
this.registerDomEvent(window, "resize", () => { /* ... */ });
this.registerInterval(window.setInterval(() => { /* ... */ }, 1000));
```

## Settings Tab Implementation

**Source**: Based on `.ref/obsidian-sample-plugin/main.ts` and `.ref/obsidian-api/obsidian.d.ts` (API is authoritative for SettingGroup - available since 1.11.0)

Basic settings tab:

```ts
import { App, PluginSettingTab, Setting } from "obsidian";

class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Setting name")
      .setDesc("Setting description")
      .addText((text) =>
        text
          .setPlaceholder("Enter value")
          .setValue(this.plugin.settings.mySetting)
          .onChange(async (value) => {
            this.plugin.settings.mySetting = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

// In main plugin class:
this.addSettingTab(new MySettingTab(this.app, this));
```

**Note**: For settings groups (available since API 1.11.0), use `SettingGroup` from the API. Plugin docs may not yet document this feature - always check `.ref/obsidian-api/obsidian.d.ts` for the latest API.

**SettingGroup Methods** (available since 1.11.0):
- `setHeading(heading: string)` - Set the group heading
- `addSetting(cb: (setting: Setting) => void)` - Add a setting to the group
- `addSearch(cb: (component: SearchComponent) => any)` - Add a search input at the beginning of the group (useful for filtering)
- `addExtraButton(cb: (component: ExtraButtonComponent) => any)` - Add an extra button to the group

**Backward Compatibility**: To support users on both Obsidian 1.11.0+ and older versions, use a compatibility utility. See [code-patterns.md](code-patterns.md) for the complete implementation with `createSettingsGroup()` utility. Alternatively, you can force `minAppVersion: "1.11.0"` in `manifest.json` if you don't need to support older versions.

## Secret Storage

**Source**: Based on [SecretStorage and SecretComponent guide](https://docs.obsidian.md/plugins/guides/secret-storage) (available since Obsidian 1.11.4)

**Important**: Always use `SecretStorage` and `SecretComponent` for storing sensitive data like API keys, tokens, or passwords. Never store secrets directly in your plugin's `data.json` file.

### Using SecretComponent in Settings

Store only the secret *name* (ID) in your settings, not the actual secret value:

```ts
import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";

export interface MyPluginSettings {
  apiKeySecretId: string; // Store the secret name, not the value
}

export class MySettingTab extends PluginSettingTab {
  plugin: MyPlugin;

  constructor(app: App, plugin: MyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("API key")
      .setDesc("Select a secret from SecretStorage")
      .addComponent((el) =>
        new SecretComponent(this.app, el)
          .setValue(this.plugin.settings.apiKeySecretId)
          .onChange(async (value) => {
            this.plugin.settings.apiKeySecretId = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
```

**Note**: `SecretComponent` requires the `App` instance in its constructor, so it must be used with `Setting#addComponent()` rather than methods like `addText()`.

### Retrieving Secrets

When you need the actual secret value, retrieve it from `SecretStorage`:

```ts
// Get a secret by its ID (name)
const secret = this.app.secretStorage.getSecret(this.settings.apiKeySecretId);

if (secret) {
  // Use the secret value
  console.log("API key retrieved");
} else {
  // Secret not found - handle gracefully
  console.warn("API key secret not found");
}
```

### Managing Secrets Programmatically

You can also manage secrets programmatically (though typically users manage them through the UI):

```ts
// Set a secret
this.app.secretStorage.setSecret("my-api-key", "actual-secret-value");

// List all secrets
const allSecrets = this.app.secretStorage.listSecrets();
// Returns: ["my-api-key", "another-secret", ...]

// Get a secret
const value = this.app.secretStorage.getSecret("my-api-key");
// Returns: "actual-secret-value" or null if not found
```

**Important**: Secret IDs must be lowercase alphanumeric with optional dashes (e.g., `my-plugin-api-key`). Invalid IDs will throw an error.

See [security-privacy.md](security-privacy.md) for security best practices and [code-patterns.md](code-patterns.md) for comprehensive examples with error handling.

## Modal Patterns

**Source**: Based on `.ref/obsidian-sample-plugin/main.ts` and `.ref/obsidian-plugin-docs/docs/guides/modals.md`

Simple modal:

```ts
import { App, Modal } from "obsidian";

class MyModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.setText("Modal content");
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// Open modal:
new MyModal(this.app).open();
```

Modal with user input:

```ts
import { App, Modal, Setting } from "obsidian";

class InputModal extends Modal {
  result: string;
  onSubmit: (result: string) => void;

  constructor(app: App, onSubmit: (result: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h1", { text: "Enter value" });

    new Setting(contentEl)
      .setName("Name")
      .addText((text) =>
        text.onChange((value) => {
          this.result = value;
        })
      );

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Submit")
          .setCta()
          .onClick(() => {
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
```

## Custom Views

**Source**: Based on `.ref/obsidian-plugin-docs/docs/guides/custom-views.md`

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_MY_VIEW = "my-view";

export class MyView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_MY_VIEW;
  }

  getDisplayText() {
    return "My View";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl("h4", { text: "My View Content" });
  }

  async onClose() {
    // Clean up resources
  }
}

// In main plugin class:
async onload() {
  this.registerView(VIEW_TYPE_MY_VIEW, (leaf) => new MyView(leaf));
  
  // Activate view:
  await this.activateView();
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
```

**Warning**: Never store references to views. Use `getLeavesOfType()` to access view instances.

## Status Bar Items

**Source**: Based on `.ref/obsidian-sample-plugin/main.ts` and `.ref/obsidian-plugin-docs/docs/guides/status-bar.md`

```ts
// Add status bar item (not supported on mobile)
const statusBarItemEl = this.addStatusBarItem();
statusBarItemEl.setText("Status text");

// Or create custom elements:
const statusBarItemEl = this.addStatusBarItem();
statusBarItemEl.createEl("span", { text: "Status: " });
statusBarItemEl.createEl("span", { text: "Active" });
```

## Ribbon Icons

**Source**: Based on `.ref/obsidian-sample-plugin/main.ts` and `.ref/obsidian-plugin-docs/docs/guides/ribbon-actions.md`

```ts
const ribbonIconEl = this.addRibbonIcon("dice", "My Plugin", (evt: MouseEvent) => {
  new Notice("Ribbon clicked!");
});

// Add CSS class for styling:
ribbonIconEl.addClass("my-plugin-ribbon-class");
```

## Editor Commands

**Source**: Based on `.ref/obsidian-sample-plugin/main.ts`

```ts
this.addCommand({
  id: "editor-command",
  name: "Editor command",
  editorCallback: (editor: Editor, view: MarkdownView) => {
    const selection = editor.getSelection();
    editor.replaceSelection("Replaced text");
  },
});
```

## Complex Commands with Conditions

**Source**: Based on `.ref/obsidian-sample-plugin/main.ts`

```ts
this.addCommand({
  id: "conditional-command",
  name: "Conditional command",
  checkCallback: (checking: boolean) => {
    const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (markdownView) {
      if (!checking) {
        // Execute command
        this.doAction();
      }
      return true; // Command is available
    }
    return false; // Command is not available
  },
});
```

The `checkCallback` receives a `checking` boolean:
- When `true`: Only check if command can run (don't execute)
- When `false`: Actually execute the command


