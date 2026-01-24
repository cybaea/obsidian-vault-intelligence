# Settings Best Practices

These guidelines are based on official Obsidian developer documentation and the implementation patterns found in the Notebook Navigator plugin.

## UI Organization

### 1. Logical Grouping

- Use **headings** to separate distinct functional areas.
- Place general or high-level settings at the top without a heading.
- Group related settings into sections (e.g., "Basic", "Advanced").

### 2. Tabbed Interfaces

- Obsidian does not have a native tab component for `PluginSettingTab`.
- Use a custom implementation with a flex-box navigation bar and lazy-loaded content containers.
- **Lazy Loading**: Render tab content only when it's first activated to keep the settings modal responsive.
- Avoid deep nesting (tabs within tabs).

### 3. Conditional Settings (Sub-settings)

- Hide settings that are only relevant when another setting (like a toggle) is enabled.
- Use a container with a `hidden` class and toggle its visibility via the parent setting's `onChange` handler.

## Aesthetic Consistency

### 4. Typography and Casing

- Use **Sentence case** for all UI text (Names, Descriptions, Placeholders).
- Exceptions: Proper nouns, brand names, and acronyms.
- Avoid Title Case for setting names.

### 5. Standard Elements

- Use standard Obsidian components: `Setting`, `ButtonComponent`, `DropdownComponent`, `SliderComponent`.
- Use standard CSS variables for colors and spacing (e.g., `var(--size-4-4)`, `var(--text-muted)`).

## Performance and Reliability

### 6. Debouncing

- Use **debouncing** for text inputs and text areas to prevent saving settings on every keystroke.
- A delay of 500ms–1000ms is typical.

### 7. Version Compatibility

- Check `requireApiVersion()` for features like `SettingGroup` or setting icons (introduced in 1.11.0).
- Provide fallbacks for older versions where reasonable.

## Notebook Navigator Patterns

- **Context Object**: Pass a `SettingsTabContext` to sectional render functions to centralise common utilities.
- **Lazy Load Map**: Use a `Map<TabId, HTMLElement>` to cache rendered tab content.
- **CSS Hierarchy**: Use a root class (e.g., `.nn-settings-tab-root`) to scope custom settings styles and avoid interfering with other plugins.
