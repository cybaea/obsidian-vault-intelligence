# Obsidian API: The Thematic Developer's Guide

This guide reorganizes the ~265+ API exports into functional domains. It maps the Obsidian API to standard software architecture patterns (MVC, DOM manipulation, IO) to help you find the right tool for the job.

---

## 1. The Core Application Architecture (System Level)

**Job:** Managing the lifecycle, global state, and event propagation.

### [App](https://docs.obsidian.md/Reference/TypeScript+API/App) (The Singleton "God Object")

In standard MVC (Model-View-Controller), `this.app` is your entry point to everything. It holds references to the Model ([Vault](https://docs.obsidian.md/Reference/TypeScript+API/Vault), [MetadataCache](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache)) and the View ([Workspace](https://docs.obsidian.md/Reference/TypeScript+API/Workspace)).

-   **Access:** `this.app` inside your plugin.
    
-   **Key Properties:** [vault](https://docs.obsidian.md/Reference/TypeScript+API/App/vault), [metadataCache](https://docs.obsidian.md/Reference/TypeScript+API/App/metadataCache), [workspace](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/App/workspace), [fileManager](https://docs.obsidian.md/Reference/TypeScript+API/App/fileManager), [keymap](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/App/keymap), [scope](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/App/scope).

### [Plugin](https://docs.obsidian.md/Reference/TypeScript+API/Plugin) & [Component](https://docs.obsidian.md/Reference/TypeScript+API/Component) (Lifecycle Management)

Obsidian uses a composite pattern for lifecycle management. Almost every UI element extends [Component](https://docs.obsidian.md/Reference/TypeScript+API/Component).

-   **[Component](https://docs.obsidian.md/Reference/TypeScript+API/Component)**: The base class for managing resources.
    
    -   [load()](https://docs.obsidian.md/Reference/TypeScript+API/Component/load) / [unload()](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/Component/unload): Life and death of the object.
    -   [addChild(component)](https://docs.obsidian.md/Reference/TypeScript+API/Component/addChild): Attaches a child's lifecycle to this component. **Crucial:** If you create a complex UI, adding it as a child ensures it gets cleaned up when the plugin unloads.
    -   [registerEvent()](https://docs.obsidian.md/Reference/TypeScript+API/Component/registerEvent): Auto-unregisters events on unload.
    -   [registerDomEvent()](https://docs.obsidian.md/Reference/TypeScript+API/Component/registerDomEvent): Auto-removes DOM listeners on unload.
    -   [registerInterval()](https://docs.obsidian.md/Reference/TypeScript+API/Component/registerInterval): Auto-clears `setInterval` timers.

---

## 2. The Model Layer: Files & Data

**Job:** Handling persistence. Obsidian has two layers for this: a high-level logical layer (Vault) and a low-level OS layer (Adapter).

### [Vault](https://docs.obsidian.md/Reference/TypeScript+API/Vault) (Logical File System)

Use this for 99% of file operations. It handles caching and synchronizing with Obsidian's internal state.

-   **Read/Write:** [read(file)](https://docs.obsidian.md/Reference/TypeScript+API/Vault/read), [modify(file, data)](https://docs.obsidian.md/Reference/TypeScript+API/Vault/modify), [append(file, data)](https://docs.obsidian.md/Reference/TypeScript+API/Vault/append).
-   **CRUD:** [create(path, data)](https://docs.obsidian.md/Reference/TypeScript+API/Vault/create), [delete(file)](https://docs.obsidian.md/Reference/TypeScript+API/Vault/delete), [trash(file, system)](https://docs.obsidian.md/Reference/TypeScript+API/Vault/trash), [rename(file, path)](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/Vault/rename).
-   **Atomicity:** [process(file, callback)](https://docs.obsidian.md/Reference/TypeScript+API/Vault/process) (Prevents race conditions by reading and writing in one atomic transaction).
-   **Retrieval:** [getAbstractFileByPath()](https://docs.obsidian.md/Reference/TypeScript+API/Vault/getAbstractFileByPath), [getMarkdownFiles()](https://docs.obsidian.md/Reference/TypeScript+API/Vault/getMarkdownFiles), [getRoot()](https://docs.obsidian.md/Reference/TypeScript+API/Vault/getRoot).

### [FileManager](https://docs.obsidian.md/Reference/TypeScript+API/FileManager) (Safe File Operations)

Use this when you need to perform file operations that might break links.

-   **[renameFile(file, newPath)](https://docs.obsidian.md/Reference/TypeScript+API/FileManager/renameFile)**: Unlike `vault.rename`, this **automatically updates internal links** pointing to that file across the entire vault.
-   **[getNewFileParent(sourcePath)](https://docs.obsidian.md/Reference/TypeScript+API/FileManager/getNewFileParent)**: Determines where a new file should be created based on the user's settings (e.g., "Same folder as current file").

### [TAbstractFile](https://docs.obsidian.md/Reference/TypeScript+API/TAbstractFile) Hierarchy

The abstract representation of files.

-   **[TFile](https://docs.obsidian.md/Reference/TypeScript+API/TFile)**: A specific file. Has properties like [basename](https://docs.obsidian.md/Reference/TypeScript+API/TFile/basename), [extension](https://docs.obsidian.md/Reference/TypeScript+API/TFile/extension), [stat](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/TFile/stat) (size, mtime).
-   **[TFolder](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/TFolder)**: A folder. Has [children](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/TFolder/children).

### [DataAdapter](https://docs.obsidian.md/Reference/TypeScript+API/DataAdapter) (Low-Level IO)

Accessed via [vault.adapter](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/Vault/adapter). This is close to Node's `fs` module.

-   **Classes:** [FileSystemAdapter](https://docs.obsidian.md/Reference/TypeScript+API/FileSystemAdapter) (Desktop), [CapacitorAdapter](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/CapacitorAdapter) (Mobile).
-   **Use Case:** Reading files inside `.obsidian`, accessing hidden dotfiles, or raw system paths.
-   **Warning:** Bypasses the cache. Slower for heavy read operations.

---

## 3. The Metadata Layer: Indexing & Querying

**Job:** Knowing _about_ files without reading their content.

### [MetadataCache](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache)

Obsidian maintains an in-memory database of the vault structure.

-   **[getFileCache(file)](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache/getFileCache)**: Returns [CachedMetadata](https://docs.obsidian.md/Reference/TypeScript+API/CachedMetadata).
-   **[resolvedLinks](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache/resolvedLinks)**: A massive object map of `{ sourcePath: { targetPath: count } }`. Used for graph view calculations.
-   **[unresolvedLinks](https://docs.obsidian.md/Reference/TypeScript+API/MetadataCache/unresolvedLinks)**: Links pointing to non-existent files.
-   **Events:** [on('changed')](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/MetadataCache/on) (Fires after metadata parsing is done), [on('resolve')](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/MetadataCache/on).

### [CachedMetadata](https://docs.obsidian.md/Reference/TypeScript+API/CachedMetadata) (The Data Structure)

The object returned by the cache.

-   **[frontmatter](https://docs.obsidian.md/Reference/TypeScript+API/CachedMetadata/frontmatter)**: YAML properties as a JS object.
-   **[tags](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/CachedMetadata/tags)**: Array of tag caches.
-   **[headings](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/CachedMetadata/headings)**: Array of heading caches (depth, text).
-   **[links](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/CachedMetadata/links)** / **[embeds](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/CachedMetadata/embeds)**: Outgoing wiki-links.

---

## 4. The View Layer: Workspace & Layouts

**Job:** Managing the windowing system, panes, and tabs.

### [Workspace](https://docs.obsidian.md/Reference/TypeScript+API/Workspace)

The manager of the UI tree.

-   **Layout:** [getLeaf()](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/Workspace/getLeaf), [splitActiveLeaf()](https://docs.obsidian.md/Reference/TypeScript+API/Workspace/splitActiveLeaf), [getRightLeaf()](https://docs.obsidian.md/Reference/TypeScript+API/Workspace/getRightLeaf).
-   **Traversal:** [iterateAllLeaves(cb)](https://docs.obsidian.md/Reference/TypeScript+API/Workspace/iterateAllLeaves), [getLeavesOfType(type)](https://docs.obsidian.md/Reference/TypeScript+API/Workspace/getLeavesOfType).
-   **Events:** [on('active-leaf-change')](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/Workspace/on), [on('file-open')](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/Workspace/on), [on('layout-change')](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/Workspace/on).

### [WorkspaceLeaf](https://docs.obsidian.md/Reference/TypeScript+API/WorkspaceLeaf)

A single tab container.

-   **[openFile(file)](https://docs.obsidian.md/Reference/TypeScript+API/WorkspaceLeaf/openFile)**: Opens a `TFile` in this leaf.
-   **[setViewState({ type: 'markdown' })](https://docs.obsidian.md/Reference/TypeScript+API/WorkspaceLeaf/setViewState)**: Changes the view type programmatically.
-   **[view](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/WorkspaceLeaf/view)**: Access the actual [View](https://docs.obsidian.md/Reference/TypeScript+API/View) instance inside the leaf.

### Critical Concept: Deferred Views

**Job:** Optimization. To speed up startup, Obsidian **does not load** your view until the user actually clicks that tab.

-   **The Trap:** When you call `getLeavesOfType('my-view')`, the `leaf.view` property might not be an instance of `MyView`. It might be a generic `DeferredView` placeholder.

-   **The Fix:**

    1.  **Check Instance:** Always check `if (leaf.view instanceof MyView)`.

    2.  **Reveal First:** If you need to manipulate the view, ensure it is loaded by calling `workspace.revealLeaf(leaf)`.

    3.  **Force Load (Rare):** Use `await leaf.loadIfDeferred()` if you absolutely need the view state without showing it (use sparingly for performance).

For more information, see <https://docs.obsidian.md/plugins/guides/defer-views>.

### [View](https://docs.obsidian.md/Reference/TypeScript+API/View) Hierarchy

-   **[View](https://docs.obsidian.md/Reference/TypeScript+API/View)**: Abstract base class.
-   **[ItemView](https://docs.obsidian.md/Reference/TypeScript+API/ItemView)**: Base for custom plugin views (Kanban, Calendar).
    -   _Implementation:_ You must implement [getViewType()](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/ItemView/getViewType), [getDisplayText()](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/ItemView/getDisplayText), [onOpen()](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/ItemView/onOpen), [onClose()](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/ItemView/onClose).
-   **[FileView](https://docs.obsidian.md/Reference/TypeScript+API/FileView)**: Base for views that represent a specific file.
    -   **[MarkdownView](https://docs.obsidian.md/Reference/TypeScript+API/MarkdownView)**: The core editor view. Exposes [editor](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/MarkdownView/editor) (CM6 wrapper) and [previewMode](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/MarkdownView/previewMode) (Reading view).

### The Layout Tree Classes

Classes representing the DOM structure of the workspace.

-   **[WorkspaceWindow](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/WorkspaceWindow)**: A pop-out window.
-   **[WorkspaceSplit](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/WorkspaceSplit)**: A column or row container.
-   **[WorkspaceTabs](https://docs.obsidian.md/Reference/TypeScript+API/WorkspaceTabs)**: A tab group container.
-   **[WorkspaceRibbon](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/WorkspaceRibbon)**: The left-hand sidebar strip.

## 5. The Component Library: Building UI

**Job:** Creating standardized UI elements without writing raw HTML. Obsidian exposes its internal UI toolkit.

### Input Components

These wrap HTML inputs and handle standard Obsidian styling/events.

-   **[ButtonComponent](https://docs.obsidian.md/Reference/TypeScript+API/ButtonComponent)** / **[ExtraButtonComponent](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/ExtraButtonComponent)**: Buttons and icon-only buttons.
-   **[TextComponent](https://docs.obsidian.md/Reference/TypeScript+API/TextComponent)** / **[TextAreaComponent](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/TextAreaComponent)**: Text inputs.
-   **[ToggleComponent](https://docs.obsidian.md/Reference/TypeScript+API/ToggleComponent)**: Checkbox switches.
-   **[DropdownComponent](https://docs.obsidian.md/Reference/TypeScript+API/DropdownComponent)**: Select menus.
-   **[SliderComponent](https://docs.obsidian.md/Reference/TypeScript+API/SliderComponent)**: Range sliders.
-   **[ColorComponent](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/ColorComponent)**: Color pickers.
-   **[SearchComponent](https://docs.obsidian.md/Reference/TypeScript+API/SearchComponent)**: The standard search box with the magnifying glass icon.
-   **[ProgressBarComponent](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/ProgressBarComponent)**: Loading indicators.

### Settings Builders

-   **[PluginSettingTab](https://docs.obsidian.md/Reference/TypeScript+API/PluginSettingTab)**: Abstract class for the main settings page.
-   **[Setting](https://docs.obsidian.md/Reference/TypeScript+API/Setting)**: A builder class for rows in the settings page.
    -   _Usage:_ `new Setting(el).`[setName](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/Setting/setName)`('Title').`[addText](https://docs.obsidian.md/Reference/TypeScript+API/Setting/addText)`(text =>...)`

---

## 6. Interaction Layer: Modals & Menus

**Job:** Capturing user intent via overlays.

### Modals

-   **[Modal](https://docs.obsidian.md/Reference/TypeScript+API/Modal)**: Base class for generic dialogs. You populate `this.contentEl`.
-   **[Notice](https://docs.obsidian.md/Reference/TypeScript+API/Notice)**: Transient toast notifications (`new Notice("Saved!")`).
-   **[FuzzySuggestModal](https://docs.obsidian.md/Reference/TypeScript+API/FuzzySuggestModal)**: The "Quick Switcher" UI. You provide items; it handles fuzzy search and keyboard nav.
-   **[SuggestModal](https://docs.obsidian.md/Reference/TypeScript+API/SuggestModal)**: Similar to Fuzzy, but allows custom matching logic.

### Menus

-   **[Menu](https://docs.obsidian.md/Reference/TypeScript+API/Menu)**: The right-click context menu.
-   **[MenuItem](https://docs.obsidian.md/Reference/TypeScript+API/MenuItem)**: An item in the menu.
-   **[MenuSeparator](https://docs.obsidian.md/Reference/TypeScript+API/MenuSeparator)**: Visual divider.
-   _Pattern:_ You typically don't instantiate `Menu` directly unless creating a custom UI button; instead, you hook into `workspace.on('file-menu')` to append items to existing menus.    

---

## 7. The Editor Engine 

Perhaps the most complex aspect of Obsidian development is interacting with the editor. Obsidian uses [CodeMirror](https://codemirror.net/) 6 (CM6), a complete rewrite of the previous engine. CM6 adopts a functional, state-driven architecture. 

**Job:** Manipulating text and the editing experience.

-   **[Editor](https://docs.obsidian.md/Reference/TypeScript+API/Editor)** (Interface): The stable abstraction layer.
    -   Methods: [getCursor](https://docs.obsidian.md/Reference/TypeScript+API/Editor/getCursor), [setSelection](https://docs.obsidian.md/Reference/TypeScript+API/Editor/setSelection), [replaceRange](https://docs.obsidian.md/Reference/TypeScript+API/Editor/replaceRange), [getLine](https://docs.obsidian.md/Reference/TypeScript+API/Editor/getLine), [lineCount](https://docs.obsidian.md/Reference/TypeScript+API/Editor/lineCount).
    -   _Best Practice:_ Use this for text manipulation to ensure compatibility with Mobile and different editor modes.
-   **[EditorSuggest](https://docs.obsidian.md/Reference/TypeScript+API/EditorSuggest)**: Base class for autocomplete popups (like typing `@` to trigger mentions).
-   **[MarkdownPostProcessor](https://www.google.com/search?q=https://docs.obsidian.md/Reference/TypeScript%2BAPI/MarkdownPostProcessor)**: A function signature for altering Reading View rendering.
-   **[MarkdownRenderChild](https://docs.obsidian.md/Reference/TypeScript+API/MarkdownRenderChild)**: A component lifecycle manager for elements rendered inside Reading View (essential for cleaning up interactive elements when the user scrolls them away).

---

## 8. The Bases API (Native Data Tables)

**Job:** Interacting with Obsidian's native database engine. "Bases" allow for dynamic, table/grid-like views of vault data, similar to the Dataview plugin but built into the core.

**Developer Guide:** [Build a Bases View](https://docs.obsidian.md/plugins/guides/bases-view)

### The Data Model (Rows & Cells)

These interfaces represent the actual data returned by a query.

-   **[BasesEntry](https://docs.obsidian.md/Reference/TypeScript+API/BasesEntry)**: Represents a single "row" or file in a Base. Implements `FormulaContext`.
-   **[BasesEntryGroup](https://docs.obsidian.md/Reference/TypeScript+API/BasesEntryGroup)**: A collection of entries grouped by a specific key (used when the user applies "Group By").
-   **[BasesQueryResult](https://docs.obsidian.md/Reference/TypeScript+API/BasesQueryResult)**: The complete result set of a query. Contains `data` (flat entries) and `groupedData` (entries organized into groups).
-   **[BasesProperty](https://docs.obsidian.md/Reference/TypeScript+API/BasesProperty)**: Definition of a column/property.
-   **[BasesPropertyId](https://docs.obsidian.md/Reference/TypeScript+API/BasesPropertyId)**: Unique identifier for a property.
-   **[BasesPropertyType](https://docs.obsidian.md/Reference/TypeScript+API/BasesPropertyType)**: Enum defining the data type (Text, Number, Date, etc.).

### Developer API: Bases schema configuration

These interfaces handle the structure of the `.base` file (or code block) itself—how the user has configured filters, sorts, and visible columns.

-   **[BasesConfigFile](https://docs.obsidian.md/Reference/TypeScript+API/BasesConfigFile)**: The serialized JSON structure of a `.base` file.
-   **[BasesConfigFileFilter](https://docs.obsidian.md/Reference/TypeScript+API/BasesConfigFileFilter)**: Definitions for active filters (e.g., "Tag includes #todo").
-   **[BasesConfigFileView](https://docs.obsidian.md/Reference/TypeScript+API/BasesConfigFileView)**: Configuration for a specific view _within_ a Base file (since one file can have multiple views like "Table", "Board").
-   **[BasesSortConfig](https://docs.obsidian.md/Reference/TypeScript+API/BasesSortConfig)**: Sorting rules (property and direction).
-   **[BasesViewConfig](https://docs.obsidian.md/Reference/TypeScript+API/BasesViewConfig)**: Runtime configuration options for the view.

### View Implementation (Rendering)

Classes used when creating _new_ types of views for Bases (e.g., if you wanted to build a custom "Timeline View" for Bases).

-   **[BasesView](https://docs.obsidian.md/Reference/TypeScript+API/BasesView)**: The abstract base class for a visual component that renders Base data.
    -   _Key Method:_ `onDataUpdated()` — Called when the query result changes so you can re-render.
-   **[BasesViewFactory](https://docs.obsidian.md/Reference/TypeScript+API/BasesViewFactory)**: Factory function to instantiate your custom view.
-   **[BasesViewRegistration](https://docs.obsidian.md/Reference/TypeScript+API/BasesViewRegistration)**: Object used to register your custom view type with Obsidian.

---

## Summary Comparison Table

| **Job**       | **Standard JS/Web**      | **Obsidian API**                                                                                 | **Why?**                              |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| **File Read** | `fs.readFile`            | [vault.read(tfile)](https://docs.obsidian.md/Reference/TypeScript+API/Vault/read)                | Caching, sync safety, mobile support. |
| **File Path** | `path.join`              | [normalizePath()](https://docs.obsidian.md/Reference/TypeScript+API/normalizePath)               | Cross-platform separator handling.    |
| **HTML UI**   | `document.createElement` | `el.createEl('div')`                                                                             | Fluent API, auto-cleaning.            |
| **Events**    | `addEventListener`       | [registerDomEvent](https://docs.obsidian.md/Reference/TypeScript+API/Component/registerDomEvent) | Auto-cleanup on plugin unload.        |
| **Settings**  | `<input>` tags           | `new Setting().`[addText()](https://docs.obsidian.md/Reference/TypeScript+API/Setting/addText)   | Standardization, built-in styling.    |
| **Timers**    | `setInterval`            | [registerInterval](https://docs.obsidian.md/Reference/TypeScript+API/Component/registerInterval) | Prevents "ghost" timers after unload. |
