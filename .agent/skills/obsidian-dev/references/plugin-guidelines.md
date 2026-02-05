<!--
Source: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
Last synced: See sync-status.json for authoritative sync dates
Update frequency: Check Obsidian developer docs for updates
-->

# Plugin Guidelines

This is a summary of common review comments from the official Obsidian plugin guidelines. Following these helps ensure your plugin is accepted and maintainable.

## General

### Avoid using global app instance

Don't use the global `app` object (or `window.app`). Use the reference from your plugin instance instead.

```typescript
// Don't do this
const file = app.vault.getFileByPath(path);

// Do this instead
const file = this.app.vault.getFileByPath(path);
```

The global app object is for debugging and may be removed in the future.

### Avoid unnecessary console logging

The developer console should only show error messages by default. Remove or gate debug logging behind a setting.

### Rename placeholder class names

The sample plugin has placeholders like `MyPlugin`, `MyPluginSettings`, `SampleSettingTab`. Rename these to reflect your plugin name.

## Security

### Avoid innerHTML, outerHTML, insertAdjacentHTML

Building DOM from user input using these methods poses security risks (XSS).

```typescript
// DON'T do this - security risk
containerEl.innerHTML = `<div class="my-class">${userInput}</div>`;

// DO this instead - use DOM API or Obsidian helpers
const div = containerEl.createDiv({ cls: 'my-class' });
div.setText(userInput);

// Or use createEl, createSpan
const span = createSpan({ cls: 'highlight', text: userInput });
```

To clear element contents, use `el.empty()`.

## Resource Management

### Clean up resources when plugin unloads

Use `registerEvent()`, `addCommand()`, and other registration methods for automatic cleanup.

```typescript
export default class MyPlugin extends Plugin {
  onload() {
    // This is automatically cleaned up on unload
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        // handle file creation
      })
    );
  }
}
```

### Don't detach leaves in onunload

When users update your plugin, open leaves should reinitialize at their original position.

## Commands

### Avoid setting default hotkeys

Default hotkeys cause conflicts between plugins and may override user configurations. Let users set their own hotkeys.

### Use the appropriate callback type

```typescript
// Use 'callback' for unconditional commands
this.addCommand({
  id: 'my-command',
  name: 'My command',
  callback: () => { /* always runs */ }
});

// Use 'checkCallback' for conditional commands
this.addCommand({
  id: 'conditional-command',
  name: 'Conditional command',
  checkCallback: (checking) => {
    if (someCondition) {
      if (!checking) { /* execute */ }
      return true;
    }
    return false;
  }
});

// Use 'editorCallback' for commands requiring an active editor
this.addCommand({
  id: 'editor-command',
  name: 'Editor command',
  editorCallback: (editor, view) => { /* has editor context */ }
});
```

## Workspace

### Avoid accessing workspace.activeLeaf directly

Use `getActiveViewOfType()` instead:

```typescript
import { MarkdownView } from 'obsidian';

const view = this.app.workspace.getActiveViewOfType(MarkdownView);
if (view) {
  // Safe to use view
}
```

For the active editor:

```typescript
const editor = this.app.workspace.activeEditor?.editor;
if (editor) {
  // Safe to use editor
}
```

### Avoid managing references to custom views

```typescript
// DON'T do this - can cause memory leaks
this.registerView(MY_VIEW_TYPE, () => this.view = new MyCustomView());

// DO this instead
this.registerView(MY_VIEW_TYPE, (leaf) => new MyCustomView(leaf));

// Access views when needed
for (const leaf of this.app.workspace.getLeavesOfType(MY_VIEW_TYPE)) {
  if (leaf.view instanceof MyCustomView) {
    // use the view
  }
}
```

## Vault Operations

### Prefer Vault API over Adapter API

The Vault API (`app.vault`) has advantages over the Adapter API (`app.vault.adapter`):
- **Performance**: Caching layer speeds up reads for known files
- **Safety**: Serial file operations prevent race conditions

### Use Vault.process for background file modifications

```typescript
// DON'T do this for background edits
await this.app.vault.modify(file, newContent);

// DO this instead - atomic and conflict-safe
await this.app.vault.process(file, (content) => {
  return content.replace('old', 'new');
});
```

### Use FileManager.processFrontMatter for properties

Don't parse YAML manually. This method is atomic and ensures consistent formatting:

```typescript
await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
  frontmatter['my-property'] = 'value';
});
```

Note: Obsidian calls this "properties" in the UI, though the API method name uses "FrontMatter".

### Use normalizePath for user-defined paths

Always normalize paths from user input or constructed in code:

```typescript
import { normalizePath } from 'obsidian';

const path = normalizePath(userInput);
// Cleans up slashes, removes leading/trailing slashes,
// handles non-breaking spaces, normalizes unicode
```

### Don't iterate all files to find by path

```typescript
// DON'T do this - inefficient for large vaults
const file = this.app.vault.getFiles().find(f => f.path === filePath);

// DO this instead
const file = this.app.vault.getFileByPath(filePath);
const folder = this.app.vault.getFolderByPath(folderPath);
const abstractFile = this.app.vault.getAbstractFileByPath(path);
```

## Editor

### Prefer Editor API over Vault.modify for active files

When editing the active note, use the Editor interface to preserve cursor position, selection, and folded content:

```typescript
const view = this.app.workspace.getActiveViewOfType(MarkdownView);
if (view) {
  const editor = view.editor;
  editor.replaceRange('new text', { line: 0, ch: 0 });
}
```

## UI Text

### Use sentence case

Use [sentence case](https://en.wiktionary.org/wiki/sentence_case), not Title Case:

- "Template folder location" (correct)
- "Template Folder Location" (incorrect)

### Use setHeading for settings headings

Don't use HTML heading elements - they cause inconsistent styling:

```typescript
// DON'T do this
containerEl.createEl('h2', { text: 'My Section' });

// DO this instead
new Setting(containerEl).setName('My section').setHeading();
```

### Avoid "settings" in settings headings

Since everything in the settings tab is a setting, avoid redundancy:

- "Advanced" (correct)
- "Advanced settings" (redundant)

## Styling

### No hardcoded styling

```typescript
// DON'T do this - impossible for themes/snippets to override
el.style.color = 'white';
el.style.backgroundColor = 'red';

// DO this instead - use CSS classes
const el = containerEl.createDiv({ cls: 'my-plugin-warning' });
```

Then in `styles.css`:

```css
.my-plugin-warning {
  color: var(--text-normal);
  background-color: var(--background-modifier-error);
}
```

## TypeScript

### Prefer const and let over var

### Prefer async/await over Promise chains

```typescript
// Prefer this
async function fetchData(): Promise<string | null> {
  try {
    const res = await requestUrl('https://example.com');
    return res.text;
  } catch (e) {
    console.error(e);
    return null;
  }
}
```
